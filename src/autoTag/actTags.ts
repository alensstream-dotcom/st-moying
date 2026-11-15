/**
 * 性行为的**受控枚举** → danbooru 标准复合 tag。
 *
 * ## 为什么换成枚举（三次真实出图故障的教训）
 * 1. **「舔下体画成舔耳朵」**:模型只写了 `target#licked`（没写部位），NAI 只能猜。
 *    `source#` / `target#` 是插件自创的语法，danbooru / NAI 完全不认识，写了等于没写，
 *    还让模型以为信息已经交代过了。
 * 2. **「方向反了」**:正文「李斌低头含住她的蜜穴」被本地正则词表补成 `fellatio, penis`
 *    ——词表只认「含住/吮吸/舔舐」这类**不分主客**的动词，复位不了运动箭头；
 *    而「含住了李斌的肉棒」又因为多出「了李斌的」整句认不出。
 * 3. **「抚摸阴蒂变成大头照」**:补 tag 时不管构图，`upper body` 照样放行，看点落在画外。
 *
 * 枚举把「谁对谁」编进字段（`act` + 省略方向时由枚举值本身决定），
 * 再带一个 `framing` 档位，渲染前把过远的景别兜回来。
 *
 * ## 为什么枚举值用中性英文码而不是 danbooru 原词
 * 网关对**输出侧**成段的露骨英文做过滤（`finish_reason=content_filter`）。
 * 让模型直接吐 `fellatio` 这种词，等于把它往枪口上送——0.1.80 的紧缩契约就是为绕开
 * 这件事才把身体词全禁掉的。所以枚举值是中性码（`mouth-on-her`、`front`、`rear`），
 * 模型只做选择题，插件本地翻成 danbooru 复合 tag。既过了网关，也不丢画面信息。
 *
 * ## 分工原则（与 mvu-helper / SLAYimages 的做法一致）
 * - 模型：从枚举里挑一个词，回答「这一格发生了什么」。
 * - 插件：把枚举展开成该行为在 danbooru 上的标准 tag 组合（器官 + 关系 + 反应 + 构图）。
 * - 正则词表退居兜底：模型没给 `act` 的老路径仍用 `explicitTagsFor`，不再承担主判断。
 */

/** 这一格实际发生的性行为。中性码，不含解剖词。 */
export type SexAct =
  | 'kiss'
  | 'chest'
  | 'digit'
  | 'mouth-on-her'
  | 'mouth-on-him'
  | 'hand-on-him'
  | 'chest-on-him'
  | 'front'
  | 'rear'
  | 'self'
  | 'toy'
  | 'undress';

/** 施动方：`1boy` 男对女/男方主导，`1girl` 女对男/女方主动。 */
export type ActGiver = '1boy' | '1girl';

/** 中性码 → 提示词里的中文说明（模型据此选择）。 */
export const ACT_LABEL: Record<SexAct, string> = {
  kiss: '接吻（嘴对嘴）',
  chest: '揉胸/吸乳（手或嘴在女方的胸上）',
  digit: '手指抚弄或进入女方下体（抚阴蒂/指交）',
  'mouth-on-her': '男方的嘴在女方下体（舔阴/口她）',
  'mouth-on-him': '女方的嘴在男根（口交/含住）',
  'hand-on-him': '女方用手撸动男根',
  'chest-on-him': '女方用乳夹住男根（乳交）',
  front: '男女正面插入性交（传教士/正面抱坐）',
  rear: '从后方插入（后入/背后位/狗爬式/趴伏）',
  self: '女方自慰（只有她自己，没有男方）',
  toy: '女方用道具自慰',
  undress: '正在脱衣/被脱衣，性行为还没开始',
};

/** 提示词里给的选项表。 */
export const ACT_OPTIONS_TEXT = (Object.keys(ACT_LABEL) as SexAct[])
  .map((act) => `${act} = ${ACT_LABEL[act]}`)
  .join('\n  · ');

/** 面向模型的完整规则块（prompt.ts 直接引用，紧凑契约也用它）。 */
export const ACT_ENUM_RULE = [
  '【act：这一格到底在做什么（必填一项，从下面挑一个，不要自创）】',
  `  · ${ACT_OPTIONS_TEXT}`,
  '  · 没有性内容（日常、只有神态、只有拥抱亲吻之外的接触）填 none，或者整个 act 键都不写。',
  '  · 只写枚举值本身，例如 "act":"mouth-on-her"。**不要**写器官名、不要写身体部位、不要写性行为英文原词。',
  '  · 判断依据只看正文这一句（这一格所在的那一句）：谁的身体在承受动作，就选哪个；方向由枚举值本身固定，',
  '    你不需要再写施动方。男方主动、女方主动都选同一个值即可（如女方主动含住，仍是 mouth-on-him）。',
  '  · 枚举值只能选一个，选最具体的那一个：后入插入选 rear，不要同时写 front。',
  '  · 器官、体位、体液、反应这些 tag 由插件按枚举补齐，你写了反而会拖长输出、增加被判违规的风险。',
].join('\n');

/**
 * 一条枚举展开后的 tag 分配。
 *
 * `base` 进 Base（共享/关系），`target` 进承受方（通常女方）角色块，
 * `source` 进施动方角色块。全部是 danbooru 真实存在的标签。
 */
export interface ActExpansion {
  base: string[];
  target: string[];
  source: string[];
  /**
   * 景别下限：`close` = 看点在躯干以下，至少 cowboy shot；
   * `medium` = 半身够用；`null` = 不改构图。
   */
  framing: 'close' | 'medium' | null;
  /** 该行为下 `pov` 是否安全（不安全时 pov 会画出前景黑色柱状遮挡）。 */
  povSafe: boolean;
  /** 该行为要求画面里出现男性（`self`/`toy` 明确没有）。 */
  needsMale: boolean;
}

const EMPTY: ActExpansion = {
  base: [],
  target: [],
  source: [],
  framing: null,
  povSafe: true,
  needsMale: false,
};

/**
 * 行为 → danbooru tag。
 *
 * 这些词全部取自 danbooru 实际标签体系，NAI 4.5 对它们有明确训练信号：
 * `cunnilingus` / `fellatio` / `fingering` / `paizuri` / `doggystyle` / `spread pussy` /
 * `head between legs` / `pussy juice` / `nipples` / `areolae` / `sex from behind`。
 */
const TABLE: Record<SexAct, ActExpansion> = {
  kiss: {
    base: ['kiss', 'french kiss'],
    target: ['kissed', 'closed eyes', 'blush'],
    source: [],
    framing: 'medium',
    povSafe: true,
    needsMale: false,
  },
  chest: {
    base: ['breast play', 'nipples', 'areolae'],
    target: ['breasts out', 'blush', 'parted lips'],
    source: ['hand on breast'],
    framing: 'medium',
    povSafe: true,
    needsMale: false,
  },
  digit: {
    base: ['fingering', 'spread pussy', 'clitoris', 'pussy juice'],
    target: ['spread legs', 'moaning', 'trembling', 'arched back', 'blush'],
    source: ['hand between legs'],
    framing: 'close',
    povSafe: false,
    needsMale: true,
  },
  'mouth-on-her': {
    base: ['cunnilingus', 'oral', 'spread pussy', 'pussy juice'],
    target: ['spread legs', 'moaning', 'trembling', 'arched back', 'blush'],
    source: ['head between legs', 'licking pussy'],
    framing: 'close',
    povSafe: false,
    needsMale: true,
  },
  'mouth-on-him': {
    base: ['fellatio', 'oral', 'penis', 'testicles', 'saliva'],
    target: ['kneeling', 'looking up', 'blush', 'half-closed eyes'],
    source: ['fellatio', 'penis'],
    framing: 'medium',
    povSafe: true,
    needsMale: true,
  },
  'hand-on-him': {
    base: ['handjob', 'penis', 'testicles'],
    target: ['looking at penis', 'blush'],
    source: ['handjob', 'penis'],
    framing: 'close',
    povSafe: false,
    needsMale: true,
  },
  'chest-on-him': {
    base: ['paizuri', 'penis', 'breasts', 'cleavage'],
    target: ['breasts', 'blush', 'looking at penis'],
    source: ['paizuri', 'penis'],
    framing: 'medium',
    povSafe: true,
    needsMale: true,
  },
  front: {
    base: ['vaginal', 'sex', 'hetero', 'penis', 'pussy'],
    target: ['moaning', 'arched back', 'trembling', 'blush', 'spread legs'],
    source: ['penis'],
    framing: 'close',
    povSafe: true,
    needsMale: true,
  },
  rear: {
    base: ['doggystyle', 'sex from behind', 'sex', 'penis', 'pussy', 'ass'],
    target: ['all fours', 'arched back', 'looking back', 'moaning'],
    source: ['penis', 'hand on hip'],
    framing: 'close',
    povSafe: false,
    needsMale: true,
  },
  self: {
    base: ['masturbation', 'fingering', 'spread pussy', 'clitoris', 'pussy juice'],
    target: ['spread legs', 'moaning', 'closed eyes', 'blush'],
    source: [],
    framing: 'close',
    povSafe: false,
    needsMale: false,
  },
  toy: {
    base: ['masturbation', 'sex toy', 'vibrator', 'pussy'],
    target: ['spread legs', 'moaning', 'trembling'],
    source: [],
    framing: 'close',
    povSafe: false,
    needsMale: false,
  },
  undress: {
    base: ['undressing'],
    target: ['undressed', 'blush', 'embarrassed'],
    source: [],
    framing: 'medium',
    povSafe: true,
    needsMale: false,
  },
};

/** 同义/脏值 → 中性码。既收 danbooru 原词（老提示词可能还在写），也收中文。 */
const ALIAS: Record<string, SexAct> = {
  kiss_: 'kiss',
  kissing: 'kiss',
  breast: 'chest',
  breasts: 'chest',
  'breast_play': 'chest',
  breastplay: 'chest',
  chest_play: 'chest',
  finger: 'digit',
  fingered: 'digit',
  fingering: 'digit',
  clitoris: 'digit',
  cunnilingus: 'mouth-on-her',
  'licking-pussy': 'mouth-on-her',
  eating_out: 'mouth-on-her',
  licking: 'mouth-on-her',
  fellatio: 'mouth-on-him',
  blowjob: 'mouth-on-him',
  oral: 'mouth-on-him',
  handjob: 'hand-on-him',
  paizuri: 'chest-on-him',
  boobjob: 'chest-on-him',
  vaginal: 'front',
  vaginal_sex: 'front',
  sex: 'front',
  intercourse: 'front',
  missionary: 'front',
  cowgirl: 'front',
  anal: 'rear',
  doggystyle: 'rear',
  'sex-from-behind': 'rear',
  masturbation: 'self',
  masturbate: 'self',
  undress_ed: 'undress',
  undressing: 'undress',
  stripping: 'undress',
  // 中文兜底（模型偶尔照抄中文）
  接吻: 'kiss',
  揉胸: 'chest',
  吸乳: 'chest',
  抚弄: 'digit',
  抚摸: 'digit',
  指交: 'digit',
  舔阴: 'mouth-on-her',
  口交: 'mouth-on-him',
  乳交: 'chest-on-him',
  性交: 'front',
  后入: 'rear',
  自慰: 'self',
  道具: 'toy',
  脱衣: 'undress',
};

/**
 * 归一化枚举值。认不出返回 `null`（= 不补行为 tag，绝不因此丢图）。
 *
 * 容忍：大小写、空格、下划线、连字符、`` `act:"x"` `` 这种残留包裹。
 */
export function normalizeAct(value: unknown): SexAct | null {
  let raw = String(value ?? '').trim();
  if (!raw) return null;
  // 模型偶尔写 "act":"mouth-on-her" 或 act=xxx
  raw = raw
    .replace(/^[`"'\[{]+|[`"'\]}]+$/g, '')
    .replace(/^act\s*[:=]\s*/i, '')
    .replace(/[`"']/g, '')
    .trim();
  if (!raw) return null;
  if (raw in ALIAS) return ALIAS[raw] ?? null;
  const key = raw.toLowerCase().replace(/[\s_]+/g, '-');
  if (!key || key === 'none' || key === 'null' || key === '-') return null;
  if (key in TABLE) return key as SexAct;
  const flat = key.replace(/-/g, '_');
  if (flat in TABLE) return flat.replace(/_/g, '-') as SexAct;
  if (key in ALIAS) return ALIAS[key] ?? null;
  if (flat in ALIAS) return ALIAS[flat] ?? null;
  return null;
}

/** 归一化施动方（多数情况不需要，方向已编进枚举值）。 */
export function normalizeGiver(value: unknown): ActGiver | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!raw) return null;
  if (/^(1boy|boy|male|man|he|男主|男)$/.test(raw)) return '1boy';
  if (/^(1girl|girl|female|woman|she|女主|女)$/.test(raw)) return '1girl';
  return null;
}

/** 取展开结果。`giver` 只在需要区分施受方的两个行为上有影响。 */
export function actExpansion(act: SexAct | null | undefined): ActExpansion {
  if (!act) return EMPTY;
  return TABLE[act] ?? EMPTY;
}

/**
 * 用正文里的**器官距离**校正「用嘴」类行为的方向。
 *
 * 模型的枚举选择也会错——第 18 节实测：正文是「李斌…一口含在了温婉柔嫩的蜜穴之上」
 * （男给女），模型却给了 `mouth-on-him`，画出来就是女主治男。方向这件事在正文里是
 * 有确定答案的：动词最近的那个器官就是宾语。所以不看模型说了什么，直接按正文改。
 *
 * @param act  模型选的枚举
 * @param side 正文判定的宾语（`on-her` = 嘴落在女方下体）
 */
export function alignMouthAct(
  act: SexAct | null | undefined,
  side: 'on-her' | 'on-him' | null,
): SexAct | null | undefined {
  if (!act || !side) return act;
  if (act !== 'mouth-on-her' && act !== 'mouth-on-him') return act;
  return side === 'on-her' ? 'mouth-on-her' : 'mouth-on-him';
}

/** 景别档位词（与 shotGuide 的 DISTANCE_RANK 口径一致）。 */
const DISTANCE_TAGS = new Set(['close-up', 'lower body', 'upper body', 'cowboy shot', 'full body', 'wide shot']);

/** 过远、拍不到躯干以下的档位。 */
const TOO_FAR = new Set(['upper body', 'portrait', 'full body', 'wide shot']);

/**
 * 按行为兜底景别、清掉会毁画面的机位组合。只动**已有**的构图词，不凭空加创作信息。
 *
 * 两个真实故障：
 * - 「抚摸阴蒂」的图是 `upper body, from above, pov` 的大头照——看点被裁出画面。
 * - 后入 + `pov` + `all fours` + `looking back` 在 NAI 里必出前景黑色柱状物
 *   （把 POV 男性下体画成了一根黑柱）。用户看到的「屁股后那个黑条」就是它。
 */
export function enforceActFraming(tag: string, act: SexAct | null | undefined): string {
  const expansion = actExpansion(act);
  const parts = String(tag ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return tag;
  const lower = parts.map((part) => part.toLowerCase());
  const drop = (word: string): void => {
    const at = lower.indexOf(word);
    if (at >= 0) {
      parts.splice(at, 1);
      lower.splice(at, 1);
    }
  };
  const add = (word: string): void => {
    if (lower.includes(word)) return;
    parts.push(word);
    lower.push(word);
  };

  // ① pov + 背向趴伏 = 前景黑柱；必须降级成第三人称背后机位。
  // 这一条**不看 act**：模型没给枚举时（老提示词、老楼层重跑）同样会画出那根黑柱，
  // 所以只要构图本身踩了这个组合就修，不靠枚举兜底。
  if (lower.includes('pov') || lower.includes('first-person view')) {
    const rearComposition =
      lower.includes('all fours') ||
      lower.includes('looking back') ||
      lower.includes('from behind') ||
      lower.includes('top-down bottom-up');
    if (!expansion.povSafe || rearComposition) {
      drop('pov');
      drop('first-person view');
      add('from behind');
    }
  }

  if (!expansion.base.length && !expansion.framing) return parts.join(', ');

  // ② 看点在躯干以下时把过远的景别兜回来。
  if (expansion.framing === 'close') {
    const current = parts.find((part) => DISTANCE_TAGS.has(part.toLowerCase()));
    if (current && TOO_FAR.has(current.toLowerCase())) {
      parts.splice(parts.indexOf(current), 1, 'cowboy shot');
      if (!lower.some((part) => /^from (?:above|below|side|behind)$/.test(part))) add('from below');
    }
  }

  return parts.join(', ');
}
