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
 * 各厂商池的「同一代」兜底模型 —— 被拦/输出不稳时退到这一级。
 *
 * 为什么按厂商分表:网关按前缀(`agy-` / `pg-`)路由到完全不同的上游账号池,
 * 两边的可用模型与过滤口径都不一样。
 *
 * 为什么**不再**退到老一代(`2.5-flash` / `3.5-flash-lite`):
 * 那两个名字早期确实是「过滤口径最松、通过率最高」的一档,但它们的智力不足以完成
 * 本插件的任务 —— 认识不到景别/机位要求、分不清角色档案与剧情、建档字段乱填。
 * 用户明确要求「不要用 3.8 之前的模型」(m11627)。现在过滤问题改由
 * `autoTag/compactContract.ts` 的紧缩契约解决(实测 3.8-flash 8/8、4-argon 7/8),
 * 不需要再靠降智换通过率。
 *
 * 所以每一级都保持在同一代:
 *   agy 池:`抗截断-<原名>` → `抗截断-agy-gemini-4-argon-high`(?同代更强)
 *   pg 池 :`抗截断-<原名>` → `抗截断-pg-gemini-4-hydrogen`
 * 表里的名字来自实测,换网关后可能不存在 —— 调用方会按「模型不存在」自动跳过该级。
 */
const VENDOR_FALLBACK: Record<string, string[]> = {
  agy: ['抗截断-agy-gemini-4-argon-high'],
  pg: ['抗截断-pg-gemini-4-hydrogen'],
};

/**
 * 失败后的模型降级梯队(按尝试顺序)。
 *
 * 只给出「名字」,不预检可用性:预检要多花一次请求,而这里每一步本来就是在
 * 失败之后走的。调用方拿 `looksLikeMissingModel` 判断名字不存在并跳过该级。
 *
 * 梯队构成(全部来自实测,不猜):
 *   1. `抗截断-<原名>` —— 同一模型换网关路径。
 *   2. `VENDOR_FALLBACK[厂商]` —— 该池里实测最稳的那一个。
 *
 * 注意顺序:第一级**不预置**抗截断前缀,先让用户选的裸模型跑。实测两个模型的偏好正相反:
 *   裸 agy-gemini-3.8-flash-high          → 24/30 (80%)
 *   抗截断-agy-gemini-3.8-flash-high      →  4/12 (33%)
 *   裸 agy-gemini-4-argon-high            →  6/15 (40%)
 *   抗截断-agy-gemini-4-argon-high        → 12/15 (80%)
 * 所以「先裸后抗截断」对 3.8 正确,对 4-argon 也能靠第二级补上;反过来先在 3.8 上
 * 用抗截断会白丢两次请求。(以上都是配紧缩契约后的数据 —— 旧契约下抗截断更好。)
 *
 * 两个池的失败模式不同,所以第 2 级不能共用同一个名字(见上表注释)。
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

  // 顺序按实测最优排,不按「先加前缀」这种直觉排:
  // 抗截断前缀对 3.8-flash 反而是**降级**(裸 80% → 抗截断 33%),对 4-argon 才是升级
  // (裸 40% → 抗截断 80%)。所以先退到该池实测最稳的那一级,再试「给自己加前缀」。
  // 用户选的就是 4-argon 时,这两级会重合,由 push 去重成一个。
  const vendor = /^([a-z]+)-/i.exec(base)?.[1]?.toLowerCase() ?? '';
  for (const candidate of VENDOR_FALLBACK[vendor] ?? []) push(candidate);
  push(`${ANTI_TRUNCATION_PREFIX}${base}`);
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

/**
 * 「模型没按协议吐 JSON」的形态。
 *
 * 为什么它也要进梯队:pg 池实测**不做内容过滤**,失败模式全在这里 ——
 * 同一份第 1 楼真实请求,裸模型 `pg-gemini-3.6-flash` / `3.5-flash-lite` /
 * `3-flash-preview` 各 4/4 全 BADJSON,而同名的 `抗截断-` 变体 4/4 给出合法计划。
 * 也就是说对这个池子,「换个模型」比「重发同一份」有效得多。
 *
 * 只认**语法/结构**层面的失败(解析不出对象、缺 images、一张都落不了位)。
 * 刻意不把「景别过远」「画面事实不符」这类语义校验算进来:那是内容问题,
 * 换个模型照样会犯,只会白花一次请求。
 */
const BAD_JSON_RE =
  /(?:AI 没有返回可解析的 JSON|AI 返回的 JSON 缺少\s*images|都没有可落地的位置|Unexpected end of JSON|Unexpected token|is not valid JSON)/i;

export function looksLikeBadSchema(message: string): boolean {
  const text = message ?? '';
  if (!text) return false;
  // 拦截/截断/模型不存在各有各的处理路径,不要在这里抢。
  if (/content_filter|sensitive|moderation|被渠道内容过滤|输出被截断/i.test(text)) return false;
  if (looksLikeMissingModel(text)) return false;
  return BAD_JSON_RE.test(text);
}
