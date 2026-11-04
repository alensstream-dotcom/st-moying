/**
 * 景别远近的**内容判据**:正文这一句的「看点」落在身体的哪一层,决定该收多近。
 *
 * 为什么需要这个模块(用户原话):「有的剧情重点细节描写了乳房、阴蒂怎么怎么样,
 * 插件选中了,都不用放大图/特写一下吗,还是全身的远景」。
 *
 * 现存的构图校验(shotCheck)只检查「有没有写景别」,判据是「情绪离身体多近」这类
 * 抽象话;而 prompt 里唯一的硬约束是「景别必须完整容纳核心接触点」——那是**下限**
 * (怕裁掉接触点),没有**上限**(该收就收)。于是模型的默认答案「中景全身平视」
 * 永远能过关:它容纳得下一切接触点,又一点都不近。
 *
 * 这里补上上限:正文点到具体部位时,给出该收多近、用什么词,并让 shotCheck 在
 * 「景别明显过远」时变成一次重试理由。判据只从正文句子读,不做画面想象——
 * 这样模型反驳不了(「正文给的是 X」),也不会凭空加戏。
 *
 * 分词口径:与 clean.ts 的句子级分段一致,每次只看**这一句**。
 */

/** 该收多近。close < upper < mid < far,数值越小越近。 */
export type ShotDistance = 'close' | 'upper' | 'mid' | 'far';

export interface ShotAdvice {
  /** 建议距离。 */
  distance: ShotDistance;
  /** 建议的景别词(直接可用)。 */
  tags: string;
  /** 建议机位(可为空)。 */
  angle: string;
  /** 命中的正文部位词,重试提示里原样引用。 */
  points: string[];
  /** 一句话理由。 */
  reason: string;
  /** 是否仅由伴随神态/手部描写触发(无强解剖焦点且无同句中远景动作)。 */
  softOnly?: boolean;
}

interface PointRule {
  distance: ShotDistance;
  tags: string;
  angle: string;
  reason: string;
  pattern: RegExp;
  /**
   * 伴随描写标记:
   * - false/未设(强焦点):解剖部位或亲密接触(如阴蒂/乳首/乳房/吻/瞳孔),任何时候都优先锁近景;
   * - true(伴随焦点):日常高频神态/手部词(眼神/视线/嘴角/脸颊/泪/手指/握住)。
   *   当句中只有它时仍建议特写;但若同句已出现全身/中景大动作或空间调度词(如站在/走进/对峙/跪/掀裙),
   *   则它是大动作下的伴随细节,不强行把全景/中景压成大头特写。
   */
  soft?: boolean;
}

/**
 * 判据表,从近到远优先匹配,先命中者生效。
 *
 * 每一行都是「正文写到这个部位时,远景一定看不清」的硬情况。
 * 只认正文里真会出现的具体名词,不认「亲密」「暧昧」这种形容。
 */
const POINT_RULES: readonly PointRule[] = [
  {
    distance: 'close',
    tags: 'lower body',
    angle: 'from below',
    reason: '正文写到下体/插入点,远景只剩一个点',
    // 阴蒂、蜜穴、私处、穴口、内裤被拨开、插入处、交合处、精液
    pattern: /阴蒂|阴核|阴唇|蜜穴|小穴|穴口|私处|下体|股间|胯间|内裤被|被拨开|插入|抽送|交合|结合处|精液|爱液|淫水|潮吹/,
  },
  {
    distance: 'close',
    tags: 'close-up',
    angle: 'from above',
    reason: '正文写到乳头/乳首,远景看不清',
    pattern: /乳头|乳首|乳尖|含住|吸吮|舔弄|咬住|舌尖/,
  },
  {
    distance: 'upper',
    tags: 'upper body',
    angle: 'from front',
    reason: '正文的看点是胸口/乳沟,该用上半身景别',
    pattern: /乳房|胸部|胸脯|乳沟|双乳|乳肉|胸口|衣领|锁骨/,
  },
  {
    distance: 'close',
    tags: 'close-up',
    angle: '',
    reason: '正文的看点是唇齿/耳畔/瞳孔微距细节,该用特写',
    pattern: /瞳孔|睫毛|吻|亲吻|舔唇|咬唇|耳垂|耳廓/,
  },
  {
    distance: 'close',
    tags: 'close-up',
    angle: '',
    reason: '正文的看点是表情/眼神/唇,该用特写',
    pattern: /眼神|视线|嘴角|唇|脸颊|脸红|泪/,
    soft: true,
  },
  {
    distance: 'close',
    tags: 'close-up',
    angle: '',
    reason: '正文的看点是手部接触,该把接触点框成特写',
    pattern: /手指|指尖|指腹|握住|抓住手腕|抚摸|摩挲|十指|掌心|手背/,
    soft: true,
  },
  {
    distance: 'mid',
    tags: 'cowboy shot',
    angle: '',
    reason: '正文的看点在腰胯/大腿,该用腰以上景别',
    pattern: /腰肢|腰线|纤腰|臀|翘臀|大腿|腿根|膝盖|跪|跨坐|掀裙|裙摆/,
  },
  {
    distance: 'far',
    tags: 'full body',
    angle: '',
    reason: '正文的看点是整体姿态或两人的位置关系',
    pattern: /站起|站在|伫立|走进|奔跑|转身|退后|扑倒|摔倒|全身|身影|背影|并肩|挡在|对峙|隔着|房间里|走廊|庭院|大厅|街头|城门|人群/,
  },
];

/** 距离排序,用于比较「实际景别够不够近」。 */
const DISTANCE_RANK: Record<ShotDistance, number> = { close: 0, upper: 1, mid: 2, far: 3 };

/** 画面实际使用的景别 → 距离档(识别不出返回 null)。 */
const TAG_DISTANCE: ReadonlyArray<[RegExp, ShotDistance]> = [
  [/(?:extreme[-_ ]?close[-_ ]?up|close[-_ ]?up|\bportrait\b|lower[-_ ]?body)/i, 'close'],
  [/(?:upper[-_ ]?body|from[-_ ]?chest[-_ ]?up|head[-_ ]?out[-_ ]?of[-_ ]?frame|half[-_ ]?body)/i, 'upper'],
  [/(?:cowboy[-_ ]?shot|medium[-_ ]?shot|from[-_ ]?waist[-_ ]?up)/i, 'mid'],
  [/(?:full[-_ ]?body|wide[-_ ]?shot|very[-_ ]?wide|feet[-_ ]?out[-_ ]?of[-_ ]?frame)/i, 'far'],
];

/** 一张图实际用的景别档;没写景别词返回 null(那是 shotCheck 的另一条事)。 */
export function tagDistance(
  tag: string,
  characterTags: readonly string[] = [],
): ShotDistance | null {
  const hay = [tag ?? '', ...characterTags].join(', ');
  for (const [pattern, distance] of TAG_DISTANCE) {
    if (pattern.test(hay)) return distance;
  }
  return null;
}

/**
 * 从**这一句正文**读出该收多近。
 *
 * - 若命中强焦点规则(解剖部位/亲密接触/中远景主体动作),优先在强焦点规则中取最近一档;
 *   但当句中存在强近景/上半身焦点(close/upper)时,直接锁定该近景焦点;
 *   当句中无强近景焦点、只有中远景大动作(mid/far)与伴随神态/手部词(soft)共存时,
 *   以中远景主体动作为准,避免「握住剑柄站在城门前对峙」被「握住/眼神」误压成大头特写。
 * - 若只命中伴随描写词(soft),则该神态/手部即本句唯一看点,照常建议 close-up。
 */
export function recommendShot(text: string): ShotAdvice | null {
  const body = (text ?? '').trim();
  if (!body) return null;
  const matched: Array<{ rule: PointRule; word: string }> = [];
  for (const rule of POINT_RULES) {
    const match = body.match(rule.pattern);
    if (!match) continue;
    matched.push({ rule, word: match[0] });
  }
  if (!matched.length) return null;

  const hardMatches = matched.filter(m => !m.rule.soft);
  const pool = hardMatches.length > 0 ? hardMatches : matched;
  let best = pool[0].rule;
  for (const { rule } of pool) {
    if (DISTANCE_RANK[rule.distance] < DISTANCE_RANK[best.distance]) {
      best = rule;
    }
  }

  const orderedPoints = [
    ...pool.map(m => m.word),
    ...matched.filter(m => !pool.includes(m)).map(m => m.word),
  ];

  return {
    distance: best.distance,
    tags: best.tags,
    angle: best.angle,
    points: [...new Set(orderedPoints)].slice(0, 3),
    reason: best.reason,
    softOnly: hardMatches.length === 0,
  };
}

export interface DistanceGap {
  /** 正文点名了哪些部位。 */
  points: string[];
  /** 建议景别词。 */
  suggest: string;
  /** 建议机位(可空)。 */
  angle: string;
  reason: string;
  /** 实际用的景别词(没识别出时为空)。 */
  actual: string;
}

/**
 * 这一张的景别是不是「明显过远」。
 *
 * 只在**已知该近**且**实际更远**时报警,方向单一(只收紧,不催着放宽):
 * 放宽会裁掉接触点,收紧最多让画面局部一点,风险低得多。
 *
 * 留一档余量:建议 upper 而实际 cowboy shot 不算错——很多胸前的动作确实需要
 * 露出腰胯才能交代清楚;但建议 upper 而实际 full body 就一定是远景废片。
 *
 * 跨句视野补偿(prevText):规则 3 要求选在「画面所需事实刚刚完整成立的句子 P(k)」,
 * 若 P(k) 只写了伴随神态(softOnly,如「她眼眶泛红」),而前一句 P(k-1) 刚建立了中远景动作
 * (如「两人并肩站在漫天风雪的庭院中央」),则允许沿用前一句的中远景跨度,不误判为景别过远。
 */
export function diagnoseDistance(
  text: string,
  tag: string,
  characterTags: readonly string[] = [],
  prevText = '',
): DistanceGap | null {
  const advice = recommendShot(text);
  if (!advice) return null;
  const actual = tagDistance(tag, characterTags);
  if (!actual) return null;

  let allowedRank = DISTANCE_RANK[advice.distance] + 1;
  if (advice.softOnly && prevText.trim()) {
    const prevAdvice = recommendShot(prevText);
    if (prevAdvice && !prevAdvice.softOnly && DISTANCE_RANK[prevAdvice.distance] >= DISTANCE_RANK.mid) {
      allowedRank = Math.max(allowedRank, DISTANCE_RANK[prevAdvice.distance] + 1);
    }
  }

  if (DISTANCE_RANK[actual] <= allowedRank) return null;
  return {
    points: advice.points,
    suggest: advice.tags,
    angle: advice.angle,
    reason: advice.reason,
    actual,
  };
}

/** 一句中文的景别档名,拼重试提示用。 */
export function distanceLabel(distance: ShotDistance): string {
  return distance === 'close'
    ? '局部特写'
    : distance === 'upper'
      ? '上半身景别'
      : distance === 'mid'
        ? '腰以上景别'
        : '全景';
}

/**
 * 「景别明显过远」时追加给模型的补救指令。
 *
 * 逐条列出「这句正文写了什么、该用哪个词」——只说「再近一点」模型会顺手写个
 * upper body 了事,把真正点到部位的句子照样画成远景。
 */
export function distanceRetryNote(gaps: Array<{ position: string } & DistanceGap>): string {
  const lines = gaps.map(
    gap =>
      `- ${gap.position}:正文点名了「${gap.points.join('、')}」(${gap.reason}),这张应当用 ${gap.suggest}${gap.angle ? ` + ${gap.angle}` : ''},你写的是 ${gap.actual}`,
  );
  return `<shot_distance_retry>
上一版有几张图的景别太远:正文已经把看点写在具体部位上了,画面却拍成远景,放大也看不清。
${lines.join('\n')}
改法:只改景别与机位,画面内容、人物、服装、情节位置一律不动。
- 局部特写就把身体 tag 也收到画面内可见的范围,别再写鞋袜、全身姿态。
- 若同时写入了脸和部位,用 from above + looking up 这类机位让两者同框,不要为了近而把头切掉。
- 其余没列出的图保持原样。
直接从 <thinking> 开始,不要解释。
</shot_distance_retry>`;
}
