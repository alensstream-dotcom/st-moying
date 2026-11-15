/**
 * 本地露骨 tag 补齐。
 *
 * 为什么需要它(来自真实故障):
 * Gemini 的 Playground 通道(`pg-` 前缀)在**输出侧**做过滤,而且只对「连续成段的露骨
 * 描写」触发——单个词单独出现全部放行,露骨输入 + 要求不复述也能过,反倒是含蓄输入 +
 * 要求直写性行为 tag 会被拒。失败形态是 `finish_reason=content_filter` 的流式截断,
 * 或者 `PROHIBITED_CONTENT`,不是拒答。
 *
 * 于是 gemini 破限档换了个做法:让模型只写「镜头能拍到的东西」(人数/景别/机位/姿态/
 * 接触方位/服装状态/表情/光线),把器官、行为、体液这些英文 tag 交给插件补。
 * 这份模块就是那个「本地词典」——按目标正文原文判断这一格实际发生了什么,再翻译成
 * danbooru 认识的短词。少写不会丢画面,多写会让整份 JSON 被网关掐掉。
 *
 * 写作口径(每一条都是踩过的坑):
 * - **只看这一句**。目标正文是按句切好的,图就落在某一句上;取「前后 100 字窗口」会把
 *   邻句的动作算进来——上游实测就出现过「他走过来把风衣脱下来」被补成 kiss。
 * - 只认**动词短语**,不认孤立名词:正文出现「乳房」不代表被摸,出现「肉棒」不代表入画。
 * - 每条规则可带 `requires`(必须同时命中)与 `without`(命中即否决)。前者压「她看着
 *   他的肉棒」这种只提不做,后者压「隔着衬衫揉」这种隔衣动作。
 * - 输出一律 danbooru 短词,空格不用下划线;与模型已写的 tag 去重后才返回。
 * - 上限 6 条:再多只会稀释主体,还会把女主的姿势词挤掉。
 */

import { group } from './sexVocab';
import type { SexAct } from './actTags';

/** 一条中文写法 → danbooru 短词的映射规则。 */
interface ExplicitRule {
  /** 命中判据(中文动作短语)。 */
  re: RegExp;
  /** 要补的 tag。与 {@link tagsOf} 二选一。 */
  tags?: string[];
  /**
   * 需要看上下文才能定 tag 时用这个。返回空数组 = 这条规则不适用。
   *
   * 为什么需要它:真实正文写「纤细玉手…按着震动棒，在小穴内反复来回抽送」——同一批动词
   * (`抽送`/`插`)既是性交也是用道具自慰。旧的固定 `tags: ['vaginal sex','penis','pussy']`
   * 会在这里补出 `penis`,于是画面里女主面前凭空多出一根。这件事不能靠 `without` 兜:
   * 句子同时提到道具与器官时,该出的是 `masturbation` + `vibrator`,不是整条作废。
   */
  tagsOf?: (body: string) => string[];
  /** 附加条件:必须同时命中才算数(可选)。 */
  requires?: RegExp;
  /** 否定语境:命中即整条作废(可选)。 */
  without?: RegExp;
  /**
   * 已经给了 `act` 枚举时跳过本条(可选)。
   *
   * 枚举展开出来的 tag 更准(它带方向、带构图兜底),正则这条只是老路径的兜底。
   * 两条同时生效时会出现「枚举说是舔阴、正则说是口交」这种自相矛盾，
   * 所以凡是枚举已覆盖的行为,正则就闭嘴。
   */
  coveredByAct?: SexAct[];
}

/** 下半身语境:手指相关规则必须踩到,否则「手指插进头发里」会被补成 fingering。 */
const LOWER_BODY = /(下面|下身|腿间|双腿|私处|花(?:唇|穴|心)|穴|体内|深处|阴|内裤|裙子|裙摆|大腿内侧|两腿之间)/;

/** 衣物被隔开的语境。 */
const THROUGH_CLOTHES = /(隔着(?:衬衫|衣服|衣物|布料|内衣|毛衣|睡裙|裙子|裤子|衣料)|没有脱|还穿着|衣着完整)/;

/** 道具在场:这类句子里的「抽送/插入」是自慰,不是性交。 */
const TOY = new RegExp(group('toy'));

/** 男根在场(含龟头这类只有男性才有的部位)。 */
const HAS_PENIS = new RegExp(`${group('penis')}|${group('glans')}`);

/** 画面里还有一个男人:有它才可能是性交。 */
const HAS_MALE = /(他|男人|男主|少年|对方|两根?手指?以外的另一只)/;

/**
 * 胸部在句中的位置(名词在动词前也算):
 * 「手指肆意揉搓…柔软乳球」是「动词…名词」语序,旧的「动词 + 6 字内 + 胸」漏掉,
 * 而这正是网文最常用的写法。这里两种语序都认。
 */
/** 胸部名词的替代串。**必须包一层 `(?:…)`** —— `group()` 只返回裸的 `a|b|c`,
 * 直接拼进更大的正则会让整个模式被 `|` 切散(实测导致 `breast play` 永远补不出来)。 */
const BREAST_NOUN = `(?:${group('breast')})`;
const BREAST_VERB = /(?:揉|搓|掐|捏|抚|摸|拨|捻|夹|含|吮|舔|咬|蹂躏|拉扯|把玩|玩弄|覆上|握住|捧)/;
const BREAST_VERB_SRC = `(?:${BREAST_VERB.source})`;

/** 乳头的委婉写法:只在已经进入情色语境时才算(单写「樱桃」可能真的是水果)。 */
const NIPPLE_EUPH = /(?:樱桃|花蕾|蕾珠|蕊珠)/;

/**
 * 嘴部动作的动词核。
 *
 * **不再区分口交/舔阴**——同一个「含」在两句真文里方向完全相反:
 * - 「李斌…一口含在了温婉柔嫩的蜜穴之上」→ 男给女舔;
 * - 「温婉…一口含住了李斌的肉棒」→ 女给男含。
 * 旧表把「吸吮/含弄/舔弄/舔舐」全塞进 `oral` 组,只要命中就补 `fellatio, penis`,
 * 于是第一种被画成了女主治男(第 18 节实测)。这里只认「嘴在动」,方向交给
 * {@link mouthSide} 按句子里的器官位置判断。
 */
const MOUTH_VERB =
  /(含|舔|吮|吸吮|吸弄|吸住|亲吻|吻上|吻住|吻了|吞进|吞下|吞吐|吮吸|啃咬|啮咬|咬住)/;

/** 抚摸/按压类动词。 */
const TOUCH_VERB = /(抚|揉|按|压|扣|拨|捻|摩|挑|弄|掐|搓|夹|抵|蹭|磨|挠|刮|玩)/;

/** 阴蒂(及其常见写法)。 */
const CLITORIS = /(?:阴蒂|阴核|花核|蕊珠|clit)/;

/** 器官与动词之间允许的最大间隔(字)。超过就不算这句在写它——压「呼吸」误撞「蜜穴」。 */
const MAX_ORGAN_SPAN = 24;

/** `re` 在 text 里所有匹配的起止位置。 */
function spans(re: RegExp, text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const flags = re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`);
  for (const m of text.matchAll(flags)) {
    const at = m.index ?? 0;
    out.push([at, at + m[0].length]);
  }
  return out;
}

/** 某个位置到 `re` 任意匹配的最短距离(间距字数)。没有匹配返回 `null`。 */
function nearestSpan(re: RegExp, text: string, at: number): number | null {
  let best: number | null = null;
  for (const [start, end] of spans(re, text)) {
    const distance = at < start ? start - at : Math.max(0, at - end);
    if (best === null || distance < best) best = distance;
  }
  return best;
}

/**
 * 判断这一句里「嘴是谁对着谁」。
 *
 * 只看**距离**:离动作最近的那个器官就是宾语。都超出 {@link MAX_ORGAN_SPAN} 就返回
 * `null` —— 宁可少补一个 tag(画面缺点细节),也不要把方向补反(画面完全错)。
 */
export function mouthSide(body: string): 'on-her' | 'on-him' | null {
  const verb = body.match(MOUTH_VERB);
  if (!verb) return null;
  const at = (verb.index ?? 0) + verb[0].length;
  const her = nearestSpan(new RegExp(`(?:${group('vulva')})`), body, at);
  const him = nearestSpan(new RegExp(`(?:${group('penis')}|${group('glans')})`), body, at);
  const herOk = her !== null && her <= MAX_ORGAN_SPAN;
  const himOk = him !== null && him <= MAX_ORGAN_SPAN;
  if (!herOk && !himOk) return null;
  if (herOk && !himOk) return 'on-her';
  if (himOk && !herOk) return 'on-him';
  return (her as number) <= (him as number) ? 'on-her' : 'on-him';
}

/**
 * 规则表。顺序即优先级——越靠前越具体的动作先占名额。
 */
const RULES: ExplicitRule[] = [
  // —— 嘴对下体：方向由 organs 的距离决定 ——
  {
    // 旧版这里是一条无方向的 `oral` 规则 + 一条几乎永不命中的舔阴规则，结果
    // 「一口含在了…蜜穴之上」既没补 cunnilingus（舔阴规则要「脸埋进腿间」这种句型），
    // 又被口交规则认成 fellatio。现在统一成一条：先认「嘴在动」，再看宾语是谁。
    re: MOUTH_VERB,
    tagsOf: (body) => {
      const side = mouthSide(body);
      if (side === 'on-her') return ['cunnilingus', 'licking pussy', 'spread pussy', 'pussy juice'];
      if (side === 'on-him') return ['fellatio', 'licking penis', 'penis'];
      // 方向不明（只写「含住」没说部位）→ 什么都不补，交给 act 枚举或模型自己写。
      return [];
    },
    without: THROUGH_CLOTHES,
    coveredByAct: ['mouth-on-her', 'mouth-on-him'],
  },
  {
    re: /(顶到(?:了)?喉咙|喉咙(?:口)?被顶|深喉|几乎顶进喉咙|顶进喉咙)/,
    tags: ['deepthroat'],
    coveredByAct: ['mouth-on-him'],
  },
  {
    re: new RegExp(`(${group('released')}(?:她)?(?:的)?(?:嘴|口)里|咽了下去|吞了下去)`),
    tags: ['cum in mouth'],
    coveredByAct: ['mouth-on-him'],
  },
  {
    // 「脸/头埋进两腿之间」这类**明确**是男给女口的句型，即使没写器官也认。
    re: /((?:脸|头|嘴|脑袋)埋进(?:她)?(?:的)?(?:两腿|双腿|腿间|腿心)|舔阴|口(?:她|舔))/,
    tags: ['cunnilingus', 'licking pussy', 'spread pussy'],
    without: THROUGH_CLOTHES,
    coveredByAct: ['mouth-on-her'],
  },
  // —— 手指(必须踩到下半身语境) ——
  {
    re: /(手指(?:插|探|伸)进|两指(?:并拢)?(?:插|探)|指奸|指入)/,
    tags: ['fingering', 'pussy'],
    requires: LOWER_BODY,
    without: THROUGH_CLOTHES,
    coveredByAct: ['digit', 'self', 'toy'],
  },
  {
    // 「拇指轻轻的扣住温婉犹如阴蒂一般的…轻柔的抚弄」→ 第 17 节实测整条漏补。
    // 抚弄 + 阴蒂/花核这种**明确点名**的器官，只要动词在附近就该出 fingering + spread pussy。
    re: new RegExp(`(${CLITORIS.source}|${group('vulva')})`),
    tagsOf: (body) => {
      const organ = body.match(new RegExp(`(${CLITORIS.source}|${group('vulva')})`));
      const at = organ?.index ?? 0;
      const near = nearestSpan(TOUCH_VERB, body, at);
      if (near === null || near > MAX_ORGAN_SPAN) return [];
      // 只点名器官没有动词不算（「她的阴蒂很敏感」这种感受句）。
      return CLITORIS.test(body)
        ? ['fingering', 'spread pussy', 'clitoris', 'pussy juice']
        : ['spread pussy', 'pussy juice'];
    },
    requires: new RegExp(`(?:${group('fingertip')}|手|指)`),
    without: THROUGH_CLOTHES,
    coveredByAct: ['digit', 'self', 'toy'],
  },
  // —— 插入 / 性交：先看是道具还是真家伙 ——
  {
    re: new RegExp(
      `(${group('penetrate')}|整根没入|整根抽出|${group('thrust')}|扶(?:着)?${group('penis')}|${group('penis')}(?:抵|顶|插)|${group('sex')})`,
    ),
    // 三种语境分开判,不再一律补 penis:
    // ① 句子里有男根/龟头 → 真的性交;
    // ② 句子里有道具、没有男根 → 用震动棒自慰(这是用户那本书开篇的真实情形);
    // ③ 两者都没有、也没有男人 → 只剩「手指」之类,交给 fingering/自慰那几条,不补器官。
    tagsOf: (body) => {
      if (HAS_PENIS.test(body)) return ['vaginal sex', 'penis', 'pussy'];
      if (TOY.test(body)) return ['masturbation', 'vibrator', 'pussy'];
      if (HAS_MALE.test(body)) return ['vaginal sex', 'pussy'];
      return ['masturbation', 'pussy'];
    },
    coveredByAct: ['front', 'rear', 'digit', 'self', 'toy'],
  },
  {
    re: /(从后面(?:插|进|进入)|后入|背后位|狗爬式)/,
    tags: ['doggystyle'],
    coveredByAct: ['rear'],
  },
  {
    re: /(骑(?:乘|在|上)|跨坐|坐在(?:他|身上))/,
    tags: ['girl on top', 'straddling'],
    requires: /(腰|臀|插|动|上下|磨|摇)/,
  },
  // —— 内射 / 体液 ——
  {
    re: new RegExp(`(${group('released')}(?:了)?(?:最)?(?:里|里面|体内|深处)|${group('inside')}|射满了|全灌在)`),
    tags: ['creampie', 'cum in pussy'],
  },
  {
    re: new RegExp(`(${group('released')}(?:外面|背上|肚子|胸口|脸上|身上)|颜射)`),
    tags: ['cum on body'],
  },
  // —— 胸:两种语序都要认 ——
  {
    // 「手指肆意揉搓…乳球」:名词在动词后面 ≥8 字,旧规则的 6 字窗口接不住。
    // 窗口给到 24 字:网文常写成「柔软乳球被埋入得近乎消失的手指肆意揉搓」——
    // 名词在动词前,中间隔着 13 个字的修饰语,8 字窗口接不住。
    re: new RegExp(
      `${BREAST_VERB_SRC}[^。！？]{0,24}${BREAST_NOUN}|${BREAST_NOUN}[^。！？]{0,24}${BREAST_VERB_SRC}`,
    ),
    tags: ['breast play', 'nipples'],
    without: THROUGH_CLOTHES,
    coveredByAct: ['chest', 'chest-on-him'],
  },
  {
    // 「樱桃被双指夹住拨弄」:乳头的委婉写法,单独出现不算。
    re: new RegExp(`(?:${NIPPLE_EUPH.source})[^。！？]{0,10}${BREAST_VERB_SRC}|${BREAST_VERB_SRC}[^。！？]{0,8}(?:${NIPPLE_EUPH.source})`),
    tags: ['nipples'],
    requires: new RegExp(`${group('breast')}|乳|胸|裸|上身`),
    without: THROUGH_CLOTHES,
    coveredByAct: ['chest'],
  },
  {
    re: new RegExp(`((?:${group('breast')})(?:露|弹)出|胸口完全露在外面|(?:乳尖|乳头)(?:立|红|硬)了|breasts out)`),
    tags: ['breasts out', 'nipples'],
  },
  // —— 泛接触 ——
  {
    re: /(低头吻(?:她|他)|舌尖(?:探进|交缠)|深吻|吻了下去|吻住|吻上)/,
    tags: ['kiss'],
    coveredByAct: ['kiss'],
  },
  {
    // 道具自慰:只提到道具 + 泛动作时也要能被认出来(否则整句只出 masturbation 没有道具)。
    re: new RegExp(`${group('toy')}`),
    tagsOf: (body) => (HAS_PENIS.test(body) ? ['sex toy'] : ['masturbation', 'vibrator']),
    requires: /(抽送|插|按|抵|塞|磨|转|震动|嗡嗡|弄|玩|进出|抽插)/,
    coveredByAct: ['toy', 'self'],
  },
  {
    re: new RegExp(`(${group('masturbate')}|抚慰自己|自己来)`),
    tags: ['masturbation'],
    coveredByAct: ['self', 'toy'],
  },
];

/** 上限:再多只会稀释主体,还会把女主的姿势词挤掉。 */
const MAX_ADDED = 6;

/** 句子边界(与 clean.ts 的 SENTENCE_STOPS 口径一致,含引号收尾)。 */
const SENTENCE_EDGE = /[。！？!?…；;\n]/;

/** tag 串拆成小写词表,用于去重判断(下划线与空格等价)。 */
function normalizeTagList(tags: string): Set<string> {
  return new Set(
    String(tags ?? '')
      .split(',')
      .map((part) => part.trim().toLowerCase().replace(/_/g, ' '))
      .filter(Boolean),
  );
}

/**
 * 按正文判断这一格实际发生的露骨内容,返回**尚未出现在 tags 里**的补充 tag。
 *
 * @param text 这一格对应的正文窗口。调用方应当只传**这一句**(见 {@link explicitSentence}),
 *             传整段会把邻句的动作算进来。
 * @param tags 模型已写出的 tag 串,用于去重
 * @param act  模型给出的 act 枚举。给了它,正则就不再重复推断同一件事
 *             (枚举展开的 tag 带方向与构图,比正则准;两条同时补会互相打架)。
 */
export function explicitTagsFor(text: string, tags = '', act?: SexAct | null): string[] {
  const body = String(text ?? '');
  if (!body.trim()) return [];
  const have = normalizeTagList(tags);
  const added: string[] = [];
  const push = (tag: string): void => {
    const key = tag.toLowerCase().replace(/_/g, ' ');
    if (have.has(key)) return;
    if (added.some((item) => item.toLowerCase().replace(/_/g, ' ') === key)) return;
    added.push(tag);
  };

  for (const rule of RULES) {
    if (added.length >= MAX_ADDED) break;
    if (act && rule.coveredByAct?.includes(act)) continue;
    if (!rule.re.test(body)) continue;
    if (rule.requires && !rule.requires.test(body)) continue;
    if (rule.without && rule.without.test(body)) continue;
    const resolved = rule.tagsOf ? rule.tagsOf(body) : (rule.tags ?? []);
    for (const tag of resolved) {
      if (added.length >= MAX_ADDED) break;
      push(tag);
    }
  }
  return added;
}

/**
 * 把补齐的 tag 并进现有 tag 串。追加在末尾而不是插在前面:
 * 人数/景别/姿势这些「主体词」必须留在最前,否则模型会把画面重心给到动作细节。
 */
export function appendExplicitTags(tags: string, extra: readonly string[]): string {
  if (!extra.length) return tags;
  const base = String(tags ?? '').trim().replace(/,\s*$/, '');
  return base ? `${base}, ${extra.join(', ')}` : extra.join(', ');
}

/** 图片位置 → 正文全局偏移。sourceLine 是行号,charOffset 是**行内**偏移,不能直接比。 */
export function storyOffset(story: string, sourceLine: number, charOffset: number): number {
  const lines = String(story ?? '').split('\n');
  const line = Math.max(0, Math.min(lines.length - 1, sourceLine));
  let at = 0;
  for (let i = 0; i < line; i += 1) at += (lines[i] ?? '').length + 1;
  return Math.max(0, Math.min(story.length, at + Math.max(0, charOffset)));
}

/**
 * 取「这一格所在的那一句」。
 *
 * 目标正文在 clean.ts 里已经按句切好(每段就是一个句子),图落在这句的句尾。所以这里只
 * 往回找最近的一个句子边界、往后找最近的一个句子边界,绝不跨句。
 *
 * 早先用「前后各 120 字」的窗口,结果把邻句的「低头吻她」算到了「他走过来把风衣脱下来」
 * 那一格上——上游实测过这个误判,所以这里收紧到单句。
 */
export function explicitSentence(story: string, sourceLine: number, charOffset: number): string {
  const body = String(story ?? '');
  if (!body) return '';
  const at = storyOffset(body, sourceLine, charOffset);
  // 句尾偏移可能正落在边界字符上,先退一格回到句内
  let end = Math.min(body.length, Math.max(0, at));
  while (end > 0 && SENTENCE_EDGE.test(body[end - 1] ?? '')) end -= 1;
  let start = end;
  while (start > 0 && !SENTENCE_EDGE.test(body[start - 1] ?? '')) start -= 1;
  let stop = end;
  while (stop < body.length && !SENTENCE_EDGE.test(body[stop] ?? '')) stop += 1;
  if (stop < body.length) stop += 1;
  return body.slice(start, stop).trim();
}

/** 兼容旧名:窗口只有一句(留作调用处平滑过渡)。 */
export function explicitWindow(story: string, sourceLine: number, charOffset: number): string {
  return explicitSentence(story, sourceLine, charOffset);
}
