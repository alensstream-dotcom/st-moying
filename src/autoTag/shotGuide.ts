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
}

interface PointRule {
  distance: ShotDistance;
  tags: string;
  angle: string;
  reason: string;
  pattern: RegExp;
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
    reason: '正文的看点是表情/眼神/唇,该用特写',
    pattern: /眼神|视线|瞳孔|睫毛|嘴角|唇|吻|舔唇|咬唇|耳垂|耳廓|脸颊|脸红|泪/,
  },
  {
    distance: 'close',
    tags: 'close-up',
    angle: '',
    reason: '正文的看点是手部接触,该把接触点框成特写',
    pattern: /手指|指尖|指腹|握住|抓住手腕|抚摸|摩挲|十指|掌心|手背/,
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
    pattern: /站起|走进|转身|退后|扑倒|摔倒|全身|身影|挡在|对峙|隔着|房间里|走廊|人群/,
  },
];

/** 距离排序,用于比较「实际景别够不够近」。 */
const DISTANCE_RANK: Record<ShotDistance, number> = { close: 0, upper: 1, mid: 2, far: 3 };

/** 画面实际使用的景别 → 距离档(识别不出返回 null)。 */
const TAG_DISTANCE: ReadonlyArray<[RegExp, ShotDistance]> = [
  [/(?:extreme[-_ ]?close[-_ ]?up|close[-_ ]?up)/i, 'close'],
  [/(?:upper[-_ ]?body|from[-_ ]?chest[-_ ]?up|head[-_ ]?out[-_ ]?of[-_ ]?frame|half[-_ ]?body)/i, 'upper'],
  [/(?:cowboy[-_ ]?shot|medium[-_ ]?shot|from[-_ ]?waist[-_ ]?up)/i, 'mid'],
  [/(?:full[-_ ]?body|wide[-_ ]?shot|very[-_ ]?wide|feet[-_ ]?out[-_ ]?of[-_ ]?frame)/i, 'far'],
];

/** 一张图实际用的景别档;没写景别词返回 null(那是 shotCheck 的另一条事)。 */
export function tagDistance(tag: string): ShotDistance | null {
  const hay = tag ?? '';
  for (const [pattern, distance] of TAG_DISTANCE) {
    if (pattern.test(hay)) return distance;
  }
  return null;
}

/**
 * 从**这一句正文**读出该收多近。
 *
 * 有多条规则同时命中时取最近的那一档:一句里既写胸又写腰,看点在胸。
 * 一句都没命中返回 null(说明这句只有动作/对白,景别交给模型)。
 */
export function recommendShot(text: string): ShotAdvice | null {
  const body = (text ?? '').trim();
  if (!body) return null;
  const points: string[] = [];
  let best: PointRule | null = null;
  for (const rule of POINT_RULES) {
    const match = body.match(rule.pattern);
    if (!match) continue;
    points.push(match[0]);
    if (!best || DISTANCE_RANK[rule.distance] < DISTANCE_RANK[best.distance]) best = rule;
  }
  if (!best) return null;
  return {
    distance: best.distance,
    tags: best.tags,
    angle: best.angle,
    points: [...new Set(points)].slice(0, 3),
    reason: best.reason,
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
 */
export function diagnoseDistance(text: string, tag: string): DistanceGap | null {
  const advice = recommendShot(text);
  if (!advice) return null;
  const actual = tagDistance(tag);
  if (!actual) return null;
  if (DISTANCE_RANK[actual] <= DISTANCE_RANK[advice.distance] + 1) return null;
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
