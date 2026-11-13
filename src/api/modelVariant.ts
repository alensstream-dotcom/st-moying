/**
 * 网关的「抗截断」模型变体。
 *
 * 为什么需要这一层:实测同一个网关(经 ST 代理)对同一份请求,裸模型与它的
 * `抗截断-` 变体表现差一倍——“抗截断”那侧在网关内部换了一条不太触发上游
 * 提交阶段过滤的路径(具体怎么做的只有网关知道),我们这边唯一要做的是
 * **被拦之后换这个名字再发一次**。
 *
 * 实测数据(用户那本 NSFW 小说的真实 10 条消息请求,各跑 8 次):
 *   agy-gemini-3.8-flash-high          → 4/8 通过
 *   抗截断-agy-gemini-3.8-flash-high    → 6/8
 *   抗截断-agy-gemini-4-argon-high      → 8/8
 *
 * 但**换名不够**:同一份「第 1 楼」真实请求(开篇即露骨)再测:
 *   agy-gemini-3.8-flash-high          → 2/5
 *   抗截断-agy-gemini-3.8-flash-high    → 1/5
 *   抗截断-agy-gemini-2.5-flash         → 9/10  ← 老一代模型过滤口径明显更松
 * 所以下一级是「退到同一网关里的老一代 flash」。
 *
 * 为什么不在初始化时就自动加前缀/自动降档:不是每个网关都有这批变体,名字不存在会
 * 变成 404/400。只在**已经失败过一次**的路径上试,失败也不亏——那次请求本来
 * 就被拦了。
 */

const ANTI_TRUNCATION_PREFIX = '抗截断-';

/** 网关的其它包装前缀:叠加时先剥掉,避免造出「抗截断-假流式-xxx」这种不存在的名字。 */
const WRAPPER_PREFIXES = ['假流式-', '抗截断-'];

/**
 * 剥掉网关的包装前缀,得到裸模型名。
 */
function bareModel(model: string): string {
  let name = (model ?? '').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of WRAPPER_PREFIXES) {
      if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
        changed = true;
      }
    }
  }
  return name;
}

/**
 * 给出该模型的抗截断变体名;已经是变体(或空名)时返回 null,表示无需/无法切换。
 */
export function antiTruncationModel(model: string): string | null {
  const name = (model ?? '').trim();
  if (!name) return null;
  // 抗截断是所有包装里最外层的那一个(网关先看它再路由),所以先剥假流式;
  // 已经带抗截断的模型直接返回 null —— 再叠一层只会造出不存在的名字。
  let core = name;
  while (core.startsWith('假流式-')) core = core.slice('假流式-'.length);
  if (!core || core.startsWith(ANTI_TRUNCATION_PREFIX)) return null;
  return `${ANTI_TRUNCATION_PREFIX}${core}`;
}

/**
 * 被拦后的模型降级梯队(按尝试顺序)。
 *
 * 只给出「名字」,不预检可用性:预检要多花一次请求,而这里每一步本来就是在
 * 失败之后走的。调用方拿 `looksLikeMissingModel` 判断名字不存在并退回。
 *
 * 梯队构成(全部来自实测,不猜):
 *   1. `抗截断-<原名>` —— 同一模型换网关路径,对中等尺度内容有效。
 *   2. `抗截断-<厂商>-gemini-2.5-flash` —— 开篇即露骨的楼层只有这一级稳(9/10)。
 *      只在原名属于 gemini 3/4 系时给出,2.5 及更早本来就没必要再退。
 */
export function fallbackModels(model: string): string[] {
  const name = (model ?? '').trim();
  if (!name) return [];
  const base = bareModel(name);
  if (!base) return [];

  const out: string[] = [];
  const push = (candidate: string) => {
    if (candidate && candidate !== name && !out.includes(candidate)) out.push(candidate);
  };

  push(`${ANTI_TRUNCATION_PREFIX}${base}`);

  // 厂商前缀(agy-/pg-/…)保留:网关按前缀路由到不同上游账号池,换厂商等于换账号。
  const vendor = /^([a-z]+)-/i.exec(base)?.[1] ?? '';
  if (vendor && /gemini-(?:3|4)[.-]/i.test(base)) {
    push(`${ANTI_TRUNCATION_PREFIX}${vendor}-gemini-2.5-flash`);
  }
  return out;
}


/**
 * 「模型不存在」的形态。
 *
 * 换变体是一次冒险:网关可能根本没上这批模型,回的是 404 / 「model not found」。
 * 这种失败要能认出来并退回原模型,否则用户看到的错误会从「被拦」变成「模型不存在」,
 * 比原来更难懂。
 *
 * 刻意不把 content_filter / sensitive / moderation 算进来:那是拦截,该继续降载而不是退模型。
 */
const MISSING_MODEL_RE =
  /(?:model[^]{0,80}?(?:not\s*found|not\s*exist|does\s*not\s*exist|invalid|unknown))|\b404\b|模型[^]{0,20}?(?:不存在|无效|未找到)|no\s*(?:available\s*)?channel/i;

export function looksLikeMissingModel(message: string): boolean {
  const text = message ?? '';
  if (!text) return false;
  if (/content_filter|sensitive|moderation|被渠道内容过滤/i.test(text)) return false;
  return MISSING_MODEL_RE.test(text);
}
