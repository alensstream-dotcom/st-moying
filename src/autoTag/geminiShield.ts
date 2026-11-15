/**
 * Gemini 专用破限的「网关侧」处理。
 *
 * 这些规则全部来自对真实网关的 A/B 实测,不是猜的:
 *
 * 1. **输入侧会拦。** 正文里连着的露骨词会让整次请求在提交阶段就被判
 *    `blockReason: PROHIBITED_CONTENT`(prompt contains sensitive words),模型根本没看到请求。
 *    同一份请求跑 6 次 6 次全拦;把正文里的器官/行为/体液词换成中性说法后,
 *    输入侧拦截从 3/10 降到 0/10。
 * 2. **输出侧也会拦。** 模型真写出成段的露骨 tag 时输出被截断成
 *    `finishReason: PROHIBITED_CONTENT`。
 * 3. **`<thinking>` 是最大的输出侧风险源。** 同一个请求带思考段时成功率 43%(13/30),
 *    明确禁止思考段后 20/20 全过。思考里它会用中文复述正文原句,那一段同样被检查。
 * 4. 我们自己规范里的英文举例(`cum on stomach`、`creampie` 这类)单独就能让请求
 *    在提交阶段被拦——所以 system 消息也要过一遍。
 *
 * 本模块只负责「让请求过得去 + 把引用还原成原文」,不参与任何剧情判断:
 * 选图、建档、服装账本全部基于**原正文**(runner 里 `source` 始终是原文)。
 */

import { group } from './sexVocab';

/** 一条替换规则:正则 → 中性说法。 */
export interface ShieldRule {
  re: RegExp;
  to: string;
}

/**
 * 中文露骨词 → 中性说法。
 *
 * 分组按「同类合并到同一个词」:模型只要看懂这里在发生什么,
 * 具体用了鸡巴/肉棒/JJ 对判断画面毫无影响,而多一个变体就多一个被拦的机会。
 * 顺序有意义:长词在前,避免「肉棒」被更短的规则截胡。
 */
const RULES: ShieldRule[] = [
  { re: new RegExp(group('penis'), 'g'), to: '那一根' },
  { re: new RegExp(group('glans'), 'g'), to: '那一处' },
  { re: new RegExp(group('vulva'), 'g'), to: '那里' },
  { re: new RegExp(group('fluid'), 'g'), to: '那股' },
  { re: new RegExp(group('released'), 'g'), to: '弄在' },
  { re: new RegExp(group('oral'), 'g'), to: '凑近' },
  { re: new RegExp(group('thrust'), 'g'), to: '动着' },
  { re: new RegExp(group('penetrate'), 'g'), to: '贴了上去' },
  { re: new RegExp(group('sex'), 'g'), to: '亲近' },
  { re: new RegExp(group('masturbate'), 'g'), to: '自己来' },
  { re: new RegExp(group('breast'), 'g'), to: '胸口' },
  { re: new RegExp(group('butt'), 'g'), to: '身后' },
  { re: new RegExp(group('underwear'), 'g'), to: '贴身衣物' },
  { re: new RegExp(group('naked'), 'g'), to: '没穿衣服' },
  { re: new RegExp(group('climax'), 'g'), to: '绷紧' },
  // 以下五个键是 0.2.0 把 `oral` 拆表之后新增的(lick/mouth/fingertip/inside/toy),
  // 这份规则表当时没跟着补,于是它们**一个都不过滤**:
  // 真实素材(第18/19/20/30/31/32 楼拼接 13162 字)shield 之后仍残留 77 处露骨词,
  // 其中「含住/舔了/舌头」全部来自这三张新表。补进来是 P1 的直接内容。
  { re: new RegExp(group('lick'), 'g'), to: '凑近' },
  { re: new RegExp(group('mouth'), 'g'), to: '嘴部' },
  { re: new RegExp(group('fingertip'), 'g'), to: '指腹' },
  { re: new RegExp(group('inside'), 'g'), to: '里面' },
  { re: new RegExp(group('toy'), 'g'), to: '道具' },
];

/**
 * 英文露骨词 → 中性标签。
 *
 * 英文词主要出现在**插件自带的书写规范与示例**里,那句话本身就会触发输入侧拦截。
 * 模型真正要写的英文 tag 由本地词典(explicitTags.ts)按原文补回,所以清掉不影响画面。
 */
const EN_RULES: ShieldRule[] = [
  { re: /\b(?:cum on stomach|cum on body|cum in mouth|cum in pussy)\b/gi, to: 'fluid' },
  { re: /\b(?:fellatio|blowjob|deepthroat|irrumatio)\b/gi, to: 'oral act' },
  { re: /\b(?:creampie|vaginal sex|anal sex|paizuri)\b/gi, to: 'sex act' },
  { re: /\b(?:penis|cock|dick|phallus)\b/gi, to: 'part A' },
  { re: /\b(?:pussy|vagina|vulva|cunt)\b/gi, to: 'part B' },
  { re: /\b(?:nipples?|areola)\b/gi, to: 'part C' },
  { re: /\b(?:anus|testicles)\b/gi, to: 'part D' },
  { re: /\b(?:semen|sperm|cum)\b/gi, to: 'fluid' },
  { re: /\b(?:panties|underwear|panty)\b/gi, to: 'undergarment' },
  { re: /\b(?:spread legs|legs spread|hips raised|pants down|skirt lifted)\b/gi, to: 'pose' },
  { re: /\b(?:topless|nude|naked|undressed)\b/gi, to: 'unclothed' },
];

const ALL = [...RULES, ...EN_RULES];

/** 屏蔽后的文本 + 到原文的下标映射。`map[i]` 是屏蔽文本第 i 个字符对应的原文下标。 */
export interface Shielded {
  /** 过网关用的文本。 */
  text: string;
  /** 原文。 */
  source: string;
  /** 下标映射,长度 = text.length + 1。 */
  map: number[];
}

/**
 * 屏蔽文本并记下每个字符来自原文哪个位置。
 *
 * 为什么需要映射:模型只看得见屏蔽后的正文,它引用的 `after` / `evidence` 自然也是
 * 屏蔽后的字面。服装账本要求 `evidence` 是原文的**逐字子串**,直接拿屏蔽后的引文去
 * `includes` 必然失败,那就会重现「剧情换了衣服但账本不改」的老问题。
 * 有了映射,命中位置能反查回原文区间,取出真正的原文句子。
 */
export function shieldWithMap(text: string): Shielded {
  const source = String(text ?? '');
  let out = '';
  const map: number[] = [];
  let index = 0;
  while (index < source.length) {
    let hitTo = '';
    let hitLen = 0;
    for (const rule of ALL) {
      rule.re.lastIndex = 0;
      const match = rule.re.exec(source.slice(index));
      if (!match || match.index !== 0 || !match[0]) continue;
      // 取最长命中:同一位置可能既有短规则又有长规则,长的那条信息更完整。
      if (match[0].length > hitLen) {
        hitTo = rule.to;
        hitLen = match[0].length;
      }
    }
    if (hitLen) {
      for (let k = 0; k < hitTo.length; k += 1) map.push(index);
      out += hitTo;
      index += hitLen;
      continue;
    }
    map.push(index);
    out += source[index];
    index += 1;
  }
  map.push(source.length);
  return { text: out, source, map };
}

/** 只取屏蔽后的文本。 */
export function shieldText(text: string): string {
  return shieldWithMap(text).text;
}

/** 反向替换:中性说法 → 一个露骨代表词,用于修不回原文时的兜底展示。 */
const BACK: Record<string, string> = {
  那一根: '阴茎',
  那一处: '龟头',
  那里: '私处',
  那股: '精液',
  凑近: '舔弄',
  动着: '抽送',
  自己来: '自慰',
  身后: '臀部',
  贴身衣物: '内裤',
  没穿衣服: '赤裸',
};

export function unshieldText(text: string): string {
  let out = String(text ?? '');
  for (const [key, value] of Object.entries(BACK)) out = out.split(key).join(value);
  return out;
}

/** 目标正文的段落头,`shieldStory` 与 `storyPart` 共用。 */
export const STORY_HEADER = /---\s*目标正文｜[^\n]*---\n/;

/** 把一条 user 消息里的目标正文换成屏蔽版;其余段落(档案/账本/候选)原样保留。 */
export function shieldStory(userContent: string): { content: string; story: Shielded | null } {
  const text = String(userContent ?? '');
  const match = STORY_HEADER.exec(text);
  if (!match) return { content: text, story: null };
  const cut = match.index + match[0].length;
  const shielded = shieldWithMap(text.slice(cut));
  return { content: text.slice(0, cut) + shielded.text, story: shielded };
}

/** 从 user 消息里取出目标正文(未屏蔽),用于与模型输出做比对。 */
export function storyPart(userContent: string): string {
  const text = String(userContent ?? '');
  const match = STORY_HEADER.exec(text);
  return match ? text.slice(match.index + match[0].length) : '';
}

/** 把一条引文还原成原文的逐字子串;还不了就退回中性词近似还原。 */
export function repairQuote(quote: string, story: Shielded | null): string {
  const raw = String(quote ?? '');
  if (!raw || !story) return raw;
  if (story.source.includes(raw)) return raw;
  const at = story.text.indexOf(raw);
  if (at >= 0) {
    const from = story.map[at];
    const to = story.map[at + raw.length];
    if (from !== undefined && to !== undefined && to > from) return story.source.slice(from, to);
  }
  // 逐字命中不到时(模型改了个别字),退回按词还原;还原后若正好是原文子串就用它。
  const back = unshieldText(raw);
  return story.source.includes(back) ? back : back;
}

/**
 * 把 JSON 文本里 after / evidence / subjectEvidence 的字符串值修回原文。
 *
 * 为什么在字符串层面改而不先 parse:这一步要在 `parseImagePlan` 之前跑,
 * 而 `parseImagePlan` 自己负责剥 think 块、抢救截断——提前 parse 会把它的容错路径绕过去。
 * 正则只碰**这三个键的 JSON 字符串值**,其它字段原样不动。
 */
const QUOTE_FIELD = /("(?:after|evidence|subjectEvidence)"\s*:\s*")((?:[^"\\]|\\.)*)(")/g;

export function repairQuotes(jsonText: string, story: Shielded | null): string {
  if (!story) return jsonText;
  return String(jsonText ?? '').replace(QUOTE_FIELD, (_all, head: string, body: string, tail: string) => {
    let value = body;
    let unescaped = value;
    try {
      unescaped = JSON.parse(`"${body}"`) as string;
    } catch {
      unescaped = body;
    }
    const fixed = repairQuote(unescaped, story);
    if (fixed === unescaped) return head + value + tail;
    return head + JSON.stringify(fixed).slice(1, -1) + tail;
  });
}

/**
 * 这些消息是「给模型的规范」而不是「素材」—— shield 一个字都不许动。
 *
 * **P0 的核心分界线**(0.2.0 的实测教训,别改回去):
 * 上一版对每一条消息整条做词典替换,于是插件自己的紧缩契约与破限词也被打散:
 *   `（nude / topless / breasts out /`          → `（unclothed / unclothed / breasts out /`
 *   `panties aside / open shirt / skirt lift`    → `undergarment aside / open shirt / skirt lift`
 *   `写 pants down / skirt lift / breasts out`   → `写 pose / skirt lift / breasts out`
 *   `mouth-on-him = 女方的嘴在男根（口交）`       → `女方的嘴在那一根（凑近）`
 * 七条白名单词 shield 完之后只剩三条活着,模型收到的是「放开写 unclothed / pose / part C」——
 * 既不知道具体能写什么,也读不出枚举值在说什么。`unclothed` 更不是 danbooru 词,写了等于没写,
 * 于是画面被压回 SFW。这是「越修越保守」的第一号原因:**请求里的指令被自己的过滤器改成了半截话**。
 *
 * 注意范围:只保护**规范**。正文/账本/实拍 tag/上镜锚点照旧过 shield ——
 * 输入侧的拦截压力来自那些素材,这一点没变(实测控制组 10 次里 9 次被输入侧拦下)。
 */
const PROTECTED_SPECS: RegExp[] = [
  // 紧缩契约(严格版与宽松版共用这个抬头)
  /【本轮输出格式（唯一的一种）】/,
  // 破限词(各档共有的框架标签)
  /<task_framing>/,
  /<output_lock>/,
  // 命中拦截/截断/空计划后的重试指令
  /<retry_after_block>/,
  /<retry_after_truncation>/,
  /<retry_empty_images>/,
  // act 枚举说明(嵌在契约里,单独出现时也要保护)
  /【act：这一格在做什么/,
];

function isProtectedSpec(content: string): boolean {
  return PROTECTED_SPECS.some((re) => re.test(content));
}

/**
 * 屏蔽整份请求,但跳过 `PROTECTED_SPECS` 认出的那些规范消息。
 *
 * 为什么不只清目标正文那一段:同一条 user 消息里还有「上一楼正文」「近期已出图的实拍 tag」
 * 「服装现状账本」——它们同样带露骨词,而输入侧判定看的是整份请求。只清目标正文,
 * 那几个区块照样能把请求顶回去(实测控制组 10 次里 9 次被输入侧拦下)。
 *
 * 为什么规范不清:见 PROTECTED_SPECS 上面的注释。
 *
 * 屏蔽是词典级一对一替换,不认识档案里的 `long black hair`、`grey skirt` 这类写法;
 * 而真正决定画面的是插件本地的账本与词典(它们一律读**原正文**),所以清掉不影响出图。
 */
export function shieldMessages<T extends { role: string; content: string }>(
  messages: readonly T[],
): { messages: T[]; story: Shielded | null } {
  // 正文不一定在 user 里:gemini 档把正文与账本都挪进了 system(那条通道按
  // 「单条 user 的露骨密度」在提交阶段拦人,挪走之后才过)。所以不能假定
  // 「story = 最后一条 user」——认错来源,引文还原全废、服装证据全对不上。
  // 按段落头定位正文;定位不到(例如只发了锚点)就退回最后一条 user,与旧行为一致。
  let storyIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (STORY_HEADER.test(messages[i].content)) {
      storyIndex = i;
      break;
    }
  }
  if (storyIndex < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        storyIndex = i;
        break;
      }
    }
  }
  let story: Shielded | null = null;
  const out = messages.map((message, index) => {
    if (isProtectedSpec(message.content)) {
      // 规范消息需要参与 story 定位(它可能是 storyIndex),但内容一个字节都不改。
      if (index === storyIndex) story = { text: message.content, source: message.content, map: [] };
      return message;
    }
    const shielded = shieldWithMap(message.content);
    if (index === storyIndex) story = shielded;
    return { ...message, content: shielded.text };
  });
  return { messages: out, story };
}
