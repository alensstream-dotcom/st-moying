/**
 * 网关的「抗截断」模型变体 + 失败后的模型梯队。
 *
 * 为什么需要这一层:同一个网关(经 ST 代理)对同一份请求,不同模型名/变体名的
 * 通过率差得很远 —— 「抗截断-」前缀在网关内部换了一条不太触发上游过滤的路径,
 * 「厂商兜底名」则是换到该账号池里另一个上游模型。我们这边唯一要做的是
 * **失败之后换下一个名字再发一次**。
 *
 * 实测数据(用户那本 NSFW 小说的真实楼层请求,配紧缩契约):
 *   agy 池(第 1/2/3 楼各 10 次):
 *     裸 agy-gemini-3.8-flash-high        → 24/30 (80%)
 *     抗截断-agy-gemini-3.8-flash-high    →  4/12 (33%)  ← 前缀对它是降级
 *     裸 agy-gemini-4-argon-high          →  6/15 (40%)
 *     抗截断-agy-gemini-4-argon-high      → 12/15 (80%)  ← 前缀对它是升级
 *   旧契约下裸模型只有 33%~50%,所以**真正的解不是换名字**,
 *   而是 `autoTag/compactContract.ts` 的紧缩契约(把 nl/identities/outfitChanges
 *   这些长字段从模型输出里拿掉)。换名字只是最后的保险。
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
 *   agy 池:`抗截断-agy-gemini-4-argon-high` → `抗截断-<用户选的那个>`
 *   pg 池 :`抗截断-pg-gemini-4-hydrogen`    → `抗截断-<用户选的那个>`
 * 表里的名字来自实测,换网关后可能不存在 —— 调用方会按「模型不存在」自动跳过该级。
 */
const VENDOR_FALLBACK: Record<string, string[]> = {
  agy: ['抗截断-agy-gemini-4-argon-high'],
  pg: ['抗截断-pg-gemini-4-hydrogen'],
};

/**
 * 「换不了名字就只能换同族兄弟」的兜底规则。
 *
 * 为什么需要:上面那张表是按网关的**厂商前缀**(agy- / pg-)路由的,但用户自己接的
 * 中转站(如 odyfree 那种)模型名可能长成 `gemini-4-hydrogen-high-原生1M支持工具` ——
 * 没有厂商前缀,表里查不到,于是只生成一个 `抗截断-gemini-4-hydrogen-high-…`,
 * 而那个站根本没有「抗截断-」变体 → 404 → 被 `looksLikeMissingModel` 跳过 → 梯队耗尽。
 * 用户看到的就是「换了模型也救不回来」。
 *
 * 所以这里补一层**同族挑选**:从渠道 /v1/models 拉到的清单里,挑名字最接近、且
 * 已被实测确认「能承载本插件长请求」的那些。挑不出就不给(不让调用方白试一次 404)。
 *
 * 排序理由(全部来自真实 6.5 万字符请求的回放实测,同一渠道):
 *   gemini-4-hydrogen-原生1M防外审注入不支持工具  → 6/6 通过,42~44s  ← 首选
 *   gemini-4-hydrogen-防外审注入单u100k不支持工具 → 5/6 通过,124s
 *   gemini-4-hydrogen-high/medium/low/xhigh-原生1M → 全部 upstream_timeout 或 content_filter
 *   gemini-4-hydrogen-单u300k支持工具             → 3/3 但全是 "I cannot fulfill this request"
 * 也就是说带上「防外审」字样的是唯一稳的一档,「high/medium/low」这些档位词反而是坑。
 */
function sameFamilyCandidates(base: string, catalog: string[]): string[] {
  const lower = base.toLowerCase();
  // 取模型族:去掉档位词与中文后缀,如 gemini-4-hydrogen-high-原生1M支持工具 → gemini-4-hydrogen
  const family = /^([a-z]+-\d+(?:[.-]\d+)?-[a-z]+)/i.exec(lower)?.[1] ?? '';
  if (!family) return [];

  const scored: Array<{ name: string; score: number }> = [];
  for (const raw of catalog) {
    const name = raw.trim();
    if (!name || name === base) continue;
    const low = name.toLowerCase();
    if (!low.startsWith(family)) continue;
    let score = 0;
    // 去掉包装前缀(抗截断-/假流式-):那类变体在中转站上通常不存在,试了也是 404。
    if (/^(?:抗截断-|假流式-)/.test(name)) score -= 100;
    // 「防外审」是实测唯一稳的一档。
    if (/防外审/.test(name)) score += 50;
    // 档位词是坑:同一个站上 high/medium/low 全部超时。
    if (/(?:^|-)(?:high|medium|low|xhigh)(?:-|$)/i.test(low.replace(family, ''))) score -= 30;
    // 「不支持工具」比「支持工具」更稳(插件本来就传 tool_choice:'none')。
    if (/不支持工具/.test(name)) score += 10;
    // 上下文越具体越好:1M > 300k > 100k(本插件请求 3.3 万 token,100k 够用但更慢)。
    if (/1M/i.test(name)) score += 8;
    else if (/300k/i.test(name)) score += 4;
    // 名字越短越接近用户原本选的形态(避免挑到一堆无关后缀的)。
    score -= name.length * 0.05;
    scored.push({ name, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > 0).map((x) => x.name);
}

/**
 * 失败后的模型降级梯队(按尝试顺序)。
 *
 * 只给出「名字」,不预检可用性:预检要多花一次请求,而这里每一步本来就是在
 * 失败之后走的。调用方拿 `looksLikeMissingModel` 判断名字不存在并跳过该级。
 *
 * 梯队构成(全部来自实测,不猜):
 *   1. `VENDOR_FALLBACK[厂商]` —— 该池里实测最稳的那一个(同代更强)。
 *   2. `抗截断-<原名>` —— 同一模型换网关路径。
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
/**
 * 失败后的模型降级梯队(按尝试顺序)。
 *
 * @param model    用户在这个渠道里选中的模型名
 * @param catalog  该渠道 /v1/models 拉到的清单(可选)。给了就能在同族里挑备用名;
 *                 不给就只按厂商表 + 加前缀这两条老路走。
 *
 * 顺序按实测最优排,不按「先加前缀」这种直觉排:
 * 抗截断前缀对 3.8-flash 反而是**降级**(裸 80% → 抗截断 33%),对 4-argon 才是升级
 * (裸 40% → 抗截断 80%)。所以先退到该池实测最稳的那一级,再试「给自己加前缀」。
 * 用户选的就是 4-argon 时,这两级会重合,由 push 去重成一个。
 *
 * 没有厂商前缀(自己接的中转站,模型名如 gemini-4-hydrogen-high-原生1M支持工具)→
 * 走 sameFamilyCandidates 从清单里挑同族最稳的那个。这一条修的是「换了模型也救不回来」:
 * 旧逻辑会硬造一个该站根本不存在的 抗截断-xxx,404 之后梯队就空了。
 */
export function fallbackModels(model: string, catalog: string[] = []): string[] {
  const name = (model ?? '').trim();
  if (!name) return [];
  const base = bareModel(name);
  if (!base) return [];

  const out: string[] = [];
  const push = (candidate: string) => {
    if (candidate && candidate !== name && !out.includes(candidate)) out.push(candidate);
  };

  const vendor = /^([a-z]+)-/i.exec(base)?.[1]?.toLowerCase() ?? '';
  const vendorList = VENDOR_FALLBACK[vendor] ?? [];
  for (const candidate of vendorList) push(candidate);

  // 厂商表没命中 → 按清单挑同族兄弟。放在「加前缀」之前:
  // 前缀名在自建站上几乎必然 404,先试真实存在的名字更划算。
  if (!vendorList.length) {
    for (const candidate of sameFamilyCandidates(base, catalog)) push(candidate);
  }

  // `抗截断-` 前缀只在**厂商表认识这个渠道**时才加。
  //
  // 0.2.0 的事故(odyfree 自建站):这一行无条件 push,于是梯队末位永远挂着
  // `抗截断-gemini-4-hydrogen-原生1M防外审注入不支持工具` —— 那个站根本没有这个名字,
  // 每轮到末位都是 `400 Bad Request`,而 `Bad Request` 又不属于「模型不存在」的判据,
  // 于是不被跳过、白花一次请求,用户看到的就是「换了两级模型还是失败」。
  // 自建站的模型名是站主自己起的,加前缀猜中率的期望接近零,不该进梯队。
  if (vendorList.length) push(`${ANTI_TRUNCATION_PREFIX}${base}`);
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
/**
 * 「这次失败其实是内容拦截」的共享判据。
 *
 * 三个 `looksLike*` 都要先把它排除掉:拦截该走「降载 + 换模型」,不该被误判成
 * 「模型不存在」(那会去换一个不存在的名字)或「输出不合规」(那会白花一次请求)。
 * \`PROHIBITED_CONTENT\` 是 Gemini 系回执里的常见写法,写成「上游内容拦截」的中文
 * 包装也一起认——实测 odyfree 自建站就是把它包在 error.message 里透传回来的。
 */
const BLOCK_TEXT_RE = /content_filter|sensitive|moderation|被渠道内容过滤|prohibited_content|上游内容拦截|prohibited use policy|content filter/i;

const MISSING_MODEL_RE =
  /(?:model[^]{0,80}?(?:not\s*found|not\s*exist|does\s*not\s*exist|invalid|unknown))|\b404\b|模型[^]{0,20}?(?:不存在|无效|未找到)|no\s*(?:available\s*)?channel/i;

export function looksLikeMissingModel(message: string): boolean {
  const text = message ?? '';
  if (!text) return false;
  if (BLOCK_TEXT_RE.test(text)) return false;
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
  /(?:AI 没有返回可解析的 JSON|AI 返回的 JSON 缺少\s*images|都没有可落地的位置|Unexpected token|is not valid JSON)/i;

/**
 * 「这个名字在这家站上不存在」的形态 —— 除了 404 还有 `400 Bad Request`。
 *
 * 为什么单列:`400 Bad Request` 是自建站对「没上过这个模型名」的**最常见回执**
 * (实测 odyfree:`抗截断-gemini-4-hydrogen-…` 回 200 + body `Bad Request`)。
 * 旧判据只认 404 / `model not found`,于是这种「名字根本不存在」的失败既不像模型缺失
 * (不跳过该级),也不像协议问题、也不像超时(不换级),整条换模型链路原地空转,
 * 一次 400 就白花掉一次重试额度。归到「模型不存在」这一类,行为是**跳过该级继续下一个**,
 * 这正是它该有的处理。
 */
const BAD_REQUEST_RE = /(?:\b400\b|Bad Request|invalid\s*request)/i;

/**
 * 「上游自己抽了一下」的形态:**不换模型**,原样重试同一个。
 *
 * 实测(odyfree 第 5/6/7 楼):`副 API 请求失败 (502): {"error":{"message":"Unexpected end of JSON input"}}`
 * —— 这是中转站解析它自己的上游时炸了,同一份请求**立刻重跑就能过**(探针矩阵里连跑
 * 5 次,失败的那两次重发都成功)。旧代码把它当 `looksLikeBadSchema`(「模型不守协议」),
 * 于是走「换下一级模型」:把用户手选的、最好的那个模型换掉,换成更差的一级,
 * 还多花一次请求。方向错了 —— 该做的是同一级重试。
 *
 * 2026-11 补两类「HTTP 200 里包着的上游故障」:
 * - `network_error` / `upstream_error` / `上游连接不稳定，请重试`:中转站自己连不上它的
 *   上游,用 SSE 的 error 帧回执(实测 odyfree 整站 16 个模型全这样)。对插件来说这既不是
 *   模型不存在、也不是内容被拦 —— 原样重发才有意义。
 * - `429` / `Too Many Requests` / `rate limit`:渠道限流,退避后重发同一级。
 *   旧判据不含它,于是限流被当成「未知失败」直接失败掉,用户看到的就是「点就失败」。
 */
const UPSTREAM_JITTER_RE =
  /(?:\b50[234]\b|Bad Gateway|Unexpected end of JSON|Service Unavailable|网关|network_error|upstream_error|上游连接不稳定|Too Many Requests|\b429\b|rate.?limit|Premature close|ERR_STREAM_PREMATURE_CLOSE|socket hang up|ECONNRESET|other side closed|\bterminated\b|fetch failed)/i;

/**
 * 「这条渠道的上游号池没有可用凭据」—— 一次就停,不要重发、不要换级。
 *
 * 实测(agy / gcli.ggchan.dev,2026-11):`GET /v1/models` 回 200,但 body 只有一条
 * `{"id":"当前无可用模型"}`;`POST /v1/chat/completions` 对每个模型名一律回
 *   429 {"error":{"message":"no valid AGY credential available",
 *        "type":"access_terminated","code":"agy_credential_missing"}}
 * 同站的 stream / 非流式都一样。这是**账号侧**的事实,同一份请求重发再多次也不会变,
 * 换模型名(哪怕换到别的厂商前缀)也一样 —— 起作用的只有换渠道。
 *
 * 所以它必须从「抖动」里摘出来:`429` 在 UPSTREAM_JITTER_RE 里,不摘出来就会被
 * 当成限流原样重发,白耗 5 次重试、每次几十秒,用户看到的是「卡很久然后全失败」,
 * 而真正该看到的是「这条渠道没有可用凭据」。
 */
const CREDENTIAL_FAILURE_RE =
  /(?:agy_credential_missing|no\s*valid\s+[\w-]*\s*credential|credential[^]{0,40}?(?:missing|invalid|expired|revoked)|access_terminated|当前无可用模型|无可用(?:凭据|账号|额度)|账号[^]{0,10}?(?:失效|过期|封禁)|insufficient[_\s]?(?:quota|balance)|prepayment\s*credits\s*are\s*depleted)/i;

export function looksLikeCredentialFailure(message: string): boolean {
  const text = message ?? '';
  if (!text) return false;
  if (/已取消|aborted|AbortError/i.test(text)) return false;
  return CREDENTIAL_FAILURE_RE.test(text);
}

/** 这次失败是不是「上游抖动」——同一级重试即可,不要升级/降级模型。 */
export function looksLikeUpstreamJitter(message: string): boolean {
  const text = message ?? '';
  if (!text) return false;
  if (/已取消|aborted|AbortError/i.test(text)) return false;
  // 拦截与截断各有更精确的路径(它们也可能带 5xx 字样),不在这里抢。
  if (BLOCK_TEXT_RE.test(text) || /输出被截断/i.test(text)) return false;
  // 凭据失效不是抖动:重发一百次也还是同一句「没有可用凭据」。
  // 实测 agy 整站号池空掉时,每次请求都回 429 + agy_credential_missing,而
  // 429 本来在抖动判据里 —— 于是插件把它当抖动白耗掉 5 次重试(每次约 30 秒),
  // 用户看到的就是「卡了很久然后全失败」。这条必须先排除。
  if (looksLikeCredentialFailure(text)) return false;
  return UPSTREAM_JITTER_RE.test(text);
}

/** 这次失败是不是「这个名字这家站上没有」——跳过该级,继续下一个。 */
export function looksLikeBadRequest(message: string): boolean {
  const text = message ?? '';
  if (!text) return false;
  if (BLOCK_TEXT_RE.test(text)) return false;
  return BAD_REQUEST_RE.test(text);
}

/**
 * 「这次请求根本没拿到答复」的形态:上游超时 / 渠道限流。
 *
 * 为什么它也该换模型(而不是原样重发):实测用户自建站上的
 * `gemini-4-hydrogen-high-原生1M支持工具` 对着插件真实那份 6.5 万字符请求
 * **每次都**回 `upstream_timeout`(连发 6 次 0 成功),而同站另一个变体 6/6 全过。
 * 也就是说这不是「偶发抖动」,是「这个模型名承载不了这种请求」。
 * 原样重发的代价是再等一个完整超时(180s),用户视角就是「卡住不动、最后失败」。
 *
 * 刻意不把「副 API 请求超时」以外的加进来:那是本地 abort(用户取消/切换聊天),
 * 换模型毫无意义。
 */
const TIMEOUT_RE = /(?:upstream_timeout|上游响应超时|响应超时|请求超时|rate_limit_exceeded|额度|quota)/i;

/**
 * 缓存:同一个渠道(按 url + key 认)的模型清单只拉一次。
 *
 * 为什么放这里而不是持久化进配置:清单是**渠道侧**的事实,存进 settings 会被柏宝书的
 * 「逐字段重建」抹掉(见 ApiChannel.reasoningEffort 的跨插件警告),而且用户换 key 就过期。
 * 一次会话拉一次的代价(实测 307ms)远小于把它存成另一个同步问题。
 */
const CATALOG_CACHE = new Map<string, string[]>();

/**
 * 取该渠道的模型清单(失败返回空数组,永不抛)。
 *
 * 调用点只在「梯队真的要用」时:正常一次成功的楼不会为它多花任何请求。
 */
export async function channelCatalog(
  channel: { url?: string; key?: string },
  fetcher: (channel: { url?: string; key?: string }) => Promise<string[]>,
): Promise<string[]> {
  const cacheKey = `${channel.url ?? ''}|${channel.key ?? ''}`;
  const cached = CATALOG_CACHE.get(cacheKey);
  if (cached) return cached;
  try {
    const list = await fetcher(channel);
    CATALOG_CACHE.set(cacheKey, list);
    return list;
  } catch {
    // 拉不到就当没有:梯队退回「厂商表 + 加前缀」两条老路。
    CATALOG_CACHE.set(cacheKey, []);
    return [];
  }
}

/** 测试用:清掉清单缓存。 */
/**
 * 这个模型名要不要靠渠道清单来挑备用名(而不是靠 VENDOR_FALLBACK 表)。
 *
 * 判据:名字里的厂商段不在 VENDOR_FALLBACK 里。注意不能写成「算出来梯队为空」——
 * `fallbackModels` 永远会追加一条「加抗截断前缀」的兜底,所以它几乎不会返回空数组,
 * 用它判空等于这条分支永远不走(第一版就是这么写错的:自建站根本进不了清单挑选)。
 */
export function needsCatalog(model: string): boolean {
  const base = bareModel((model ?? '').trim());
  if (!base) return false;
  const vendor = /^([a-z]+)-/i.exec(base)?.[1]?.toLowerCase() ?? '';
  return !(VENDOR_FALLBACK[vendor]?.length);
}

export function looksLikeTimeout(message: string): boolean {
  const text = message ?? '';
  if (!text) return false;
  if (/已取消|aborted|AbortError/i.test(text)) return false;
  // 凭据失效常和限流一起来(`rate_limit_exceeded`),但它不是「这次没等到答复」,
  // 而是「这个账号没有可用凭据」—— 提示语完全不同,不能混。
  if (looksLikeCredentialFailure(text)) return false;
  return TIMEOUT_RE.test(text);
}

export function looksLikeBadSchema(message: string): boolean {
  const text = message ?? '';
  if (!text) return false;
  // 拦截/截断/模型不存在各有各的处理路径,不要在这里抢。
  if (BLOCK_TEXT_RE.test(text) || /输出被截断/i.test(text)) return false;
  if (looksLikeMissingModel(text)) return false;
  // 上游抖动不是「模型不守协议」:那个模型本身没问题,换掉它只会更差。
  if (looksLikeUpstreamJitter(text)) return false;
  return BAD_JSON_RE.test(text);
}
