/**
 * 构图缺项检查：一张图有没有交代「景别」和「机位」。
 *
 * 为什么要代码兜底：NAI 在 tag 里找不到景别词时,会退回它自己的默认取景
 * （通常是中景全身、平视正面）,结果就是用户说的「构图不理想」——
 * 提示词里讲得再细,模型也可能漏写,漏写了没人管,画面就塌成一张证件照。
 * 这里只在**还有重试次数**时把它变成一次重试理由（见 runner）,
 * 没次数了就放行:宁可交一张平一点的图,也不能因为构图词缺失而交白卷。
 *
 * 词表按 danbooru 写法,空格与下划线都算（NAI 两种都吃）;
 * 不用 \b 边界,因为 pov_hands、first_person_view 这类连写才是常见形态。
 */

/** 景别/取景范围。只认 danbooru 常见写法,自造词不算。 */
const SHOT_PATTERN =
  /(?:extreme[-_ ]?close[-_ ]?up|close[-_ ]?up|upper[-_ ]?body|cowboy[-_ ]?shot|full[-_ ]?body|wide[-_ ]?shot|very[-_ ]?wide|portrait|lower[-_ ]?body|head[-_ ]?out[-_ ]?of[-_ ]?frame|feet[-_ ]?out[-_ ]?of[-_ ]?frame|half[-_ ]?body|medium[-_ ]?shot|from[-_ ]?waist[-_ ]?up|from[-_ ]?chest[-_ ]?up|back[-_ ]?view|dutch[-_ ]?angle)/i;

/** 机位/视角。pov 与 first-person view 都算——它们决定「谁的眼睛在看」。 */
const ANGLE_PATTERN =
  /(?:from[-_ ]?above|from[-_ ]?below|from[-_ ]?side|from[-_ ]?behind|from[-_ ]?front|straight[-_ ]?on|over[-_ ]?(?:the[-_ ]?)?shoulder|pov|point[-_ ]?of[-_ ]?view|first[-_ ]?person(?:[-_ ]?view)?|three[-_ ]?quarter[-_ ]?view|side[-_ ]?view|profile|looking[-_ ]?up|looking[-_ ]?down|angled|tilted|worm'?s[-_ ]?eye[-_ ]?view|bird'?s[-_ ]?eye[-_ ]?view)/i;

/** 光线/氛围。不参与硬校验（很多好图没有光词）,只用来提示模型补足。 */
const LIGHT_PATTERN =
  /(?:rim[-_ ]?light(?:ing)?|back[-_ ]?light(?:ing)?|soft[-_ ]?light(?:ing)?|dim[-_ ]?light(?:ing)?|hard[-_ ]?light(?:ing)?|dappled[-_ ]?(?:sun)?light|window[-_ ]?light|silhouette|chiaroscuro|neon|warm[-_ ]?light(?:ing)?|cool[-_ ]?light(?:ing)?|cinematic[-_ ]?light(?:ing)?|glow(?:ing)?|shadow|volumetric[-_ ]?light(?:ing)?|moonlight|sunlight)/i;

export interface ShotDiag {
  /** 缺哪几项（中文,直接拼进重试提示与错误信息）。 */
  missing: string[];
  /** 只有光线缺失时为 true:这类不算错,只是画面会平。 */
  softOnly: boolean;
}

/**
 * 检查一张图（Base tag + 所有角色 tag 合起来看）。
 *
 * 合起来而不是只看 Base:V5 的角色 tag 里常写 from_above / pov,
 * 只看 Base 会误判成缺机位。
 */
export function diagnoseShot(tag: string, characterTags: string[] = []): ShotDiag {
  const hay = [tag ?? '', ...characterTags].join(', ');
  const missing: string[] = [];
  if (!SHOT_PATTERN.test(hay)) missing.push('景别');
  if (!ANGLE_PATTERN.test(hay)) missing.push('机位');
  if (!missing.length && !LIGHT_PATTERN.test(hay)) {
    return { missing: ['光线'], softOnly: true };
  }
  return { missing, softOnly: false };
}

/**
 * 「缺景别/机位」时追加给模型的补救指令。
 *
 * 只重发提示词不补话,模型会原样再写一遍——它并不觉得自己错了。
 */
export function shotRetryNote(missing: string[]): string {
  const what = missing.join(' 与 ');
  return `<shot_retry>
上一版有画面没有交代${what}。这不影响剧情,但会让画面退化成默认的中景平视构型（人物的出现位置、画面重心、视线关系全都由模型随手决定）,所以重做一次。
这次每张图的 tag 里必须显式写出:
- 景别(必给一个):close-up / upper body / cowboy shot / full body / wide shot / portrait / lower body
- 机位或视角(必给一个):from above / from below / from side / from behind / over shoulder / pov / first-person view / dutch angle
- 画面里有光就补一个:rim lighting / backlighting / soft lighting / dim lighting / window light / silhouette
其余内容照旧:该照抄候选库的照抄,可以删掉正文否定的部件,不许为了让构图好看而改剧情、换瞬间或换服装。
直接从 <thinking> 开始,不要解释。
</shot_retry>`;
}

/** 归一化的景别与机位签名,用于检测同楼多张图是否拍成同一套「证件照分镜」。 */
export interface ShotSignature {
  distance: 'close' | 'upper' | 'mid' | 'far' | null;
  angle: 'above' | 'below' | 'side' | 'behind' | 'pov' | 'dutch' | 'front' | null;
}

const SIG_DISTANCE: ReadonlyArray<[RegExp, NonNullable<ShotSignature['distance']>]> = [
  [/(?:extreme[-_ ]?close[-_ ]?up|close[-_ ]?up|\bportrait\b|lower[-_ ]?body)/i, 'close'],
  [/(?:upper[-_ ]?body|from[-_ ]?chest[-_ ]?up|head[-_ ]?out[-_ ]?of[-_ ]?frame|half[-_ ]?body)/i, 'upper'],
  [/(?:cowboy[-_ ]?shot|medium[-_ ]?shot|from[-_ ]?waist[-_ ]?up)/i, 'mid'],
  [/(?:full[-_ ]?body|wide[-_ ]?shot|very[-_ ]?wide|feet[-_ ]?out[-_ ]?of[-_ ]?frame)/i, 'far'],
];

const SIG_ANGLE: ReadonlyArray<[RegExp, NonNullable<ShotSignature['angle']>]> = [
  [/(?:over[-_ ]?(?:the[-_ ]?)?shoulder|from[-_ ]?behind|back[-_ ]?view)/i, 'behind'],
  [/(?:pov|point[-_ ]?of[-_ ]?view|first[-_ ]?person(?:[-_ ]?view)?)/i, 'pov'],
  [/(?:dutch[-_ ]?angle|tilted|angled)/i, 'dutch'],
  [/(?:from[-_ ]?above|bird'?s[-_ ]?eye[-_ ]?view|looking[-_ ]?down)/i, 'above'],
  [/(?:from[-_ ]?below|worm'?s[-_ ]?eye[-_ ]?view|looking[-_ ]?up)/i, 'below'],
  [/(?:from[-_ ]?side|side[-_ ]?view|profile|three[-_ ]?quarter[-_ ]?view)/i, 'side'],
  [/(?:from[-_ ]?front|straight[-_ ]?on)/i, 'front'],
];

export function extractShotSignature(
  tag: string,
  characterTags: readonly string[] = [],
): ShotSignature {
  const hay = [tag ?? '', ...characterTags].join(', ');
  let distance: ShotSignature['distance'] = null;
  for (const [re, d] of SIG_DISTANCE) {
    if (re.test(hay)) {
      distance = d;
      break;
    }
  }
  let angle: ShotSignature['angle'] = null;
  for (const [re, a] of SIG_ANGLE) {
    if (re.test(hay)) {
      angle = a;
      break;
    }
  }
  return { distance, angle };
}

export interface MonotonousShotGap {
  signature: string;
  positions: string[];
}

/**
 * 检查同一楼的多张插图是否在景别+机位上完全雷同:
 * - 最典型的退化是连续 2 张及以上都写成 `upper body + from front`(半身正面证件照连拍);
 * - 或同一楼 3 张及以上全部使用完全相同的「景别档 + 机位档」。
 */
export function diagnoseMonotonousShots(
  images: ReadonlyArray<{
    position: string;
    tag: string;
    characters?: ReadonlyArray<{ tag: string }>;
  }>,
): MonotonousShotGap[] {
  if (images.length < 2) return [];
  const groups = new Map<string, string[]>();
  for (const image of images) {
    const sig = extractShotSignature(
      image.tag,
      image.characters?.map(c => c.tag) ?? [],
    );
    if (!sig.distance || !sig.angle) continue;
    const key = `${sig.distance}+${sig.angle}`;
    const list = groups.get(key) ?? [];
    list.push(image.position);
    groups.set(key, list);
  }
  const gaps: MonotonousShotGap[] = [];
  for (const [signature, positions] of groups) {
    const isPassportCombo = signature === 'upper+front';
    if ((isPassportCombo && positions.length >= 2) || positions.length >= 3) {
      gaps.push({ signature, positions });
    }
  }
  return gaps;
}

export function monotonousShotRetryNote(gaps: ReadonlyArray<MonotonousShotGap>): string {
  const lines = gaps.map(
    g => `- ${g.positions.join('、')}:景别与机位完全雷同(${g.signature})`,
  );
  return `<shot_variety_retry>
上一版在同一楼的多张图里重复使用了完全相同的景别与机位组合:
${lines.join('\n')}
同一楼的多张插图应当像一组有节奏的分镜(例如:建立镜头 wide shot/full body → 互动中景 cowboy shot + from side/over the shoulder → 情绪或局部焦点 close-up + from above/from below/dutch angle),不能连续拍成同一个机位的证件照。
改法:选点位置、人物、服装一律不动,只调整其中重复图片的景别档位或机位方向(如改用 from side / from above / from below / over the shoulder / dutch angle,或拉开 close-up / cowboy shot / full body 的层次)。
直接从 <thinking> 开始,不要解释。
</shot_variety_retry>`;
}
