/**
 * 画面**事实闭环**校验:人数对不对、道具落没落到身上。
 *
 * 用户原话:
 * - 「两个男的插一个女的,它直接变成一个人长了双头肉棒」——多人只剩一个角色块,
 *   模型就没有「第二个男人」这回事,肉棒当然只能长在一个人身上。
 * - 「用毛笔在女主阴部写字,图片里出现了毛笔出现了女主的赤裸身体,但没有捕捉到
 *   最关键的用毛笔在阴部上写」——道具进了画面,落点没进,道具就成了摆设。
 * - 「明明是双人甚至多人互动,结果图片里只出现一个女的,直接就变成了一个人的自慰」。
 *
 * 两条都是**可判定的**:正文写着几个人、道具在谁身上动,和 tag 里的人数与接触词对不上,
 * 就是确定错。这里只查这两种确定错,不管构图审美。
 *
 * 人数判据取保守口径:只在「正文点名的在场角色数」明显多于「tag 人数」时才报,
 * 因为把一人误判成两人会凭空加人,比漏一个人更难看。
 */

/** 人数 tag:2girls / 2boys / 3girls 这类。 */
const COUNT_RE = /(?:^|[,\s])(\d+)\s*(girl|boy|other)s?(?=$|[,\s])/gi;

/** tag 里的人数字段,合计成 {girls, boys}。 */
export function readCounts(tag: string): { girls: number; boys: number } {
  let girls = 0;
  let boys = 0;
  for (const match of (tag ?? '').matchAll(COUNT_RE)) {
    const count = Math.max(0, Number.parseInt(match[1], 10) || 0);
    if (match[2].toLowerCase() === 'girl') girls += count;
    else boys += count;
  }
  return { girls, boys };
}

/**
 * 正文里「第二个男性在场」的强信号。
 *
 * 男性不建档,所以没法按名字数;这里只认明确指向第二个男性的词。
 * 拿不准就不报——多男误判会把单人图逼成双人。
 */
const EXTRA_MALE_RE =
  /(?:两个男人|两个男的|两名男性|两个男性|男人们|两男|三男|几个男人|另一个男人|另一个男的|第二个男人|前后夹|一前一后|两根肉棒|双插|三人行)/;

/**
 * 弱信号:「另一只手」「两只手」可能是男主的手,也可能只是女主自己的两只手。
 * 只在画面里已经有一个男性时才算数——帮忙把 1boy 抬到 2boys,不会凭空往单人图里加人。
 */
const WEAK_EXTRA_MALE_RE = /(?:另一只手|两只手|两双手|另一双手)/;

/** 正文里数出的在场女性名字(调用方给已建档名字表)。 */
export function countPresentNames(text: string, names: Iterable<string>): number {
  const hay = text ?? '';
  let count = 0;
  const seen = new Set<string>();
  for (const name of names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (hay.includes(name)) count += 1;
  }
  return count;
}

export interface CastGap {
  kind: 'missing-actor' | 'wrong-count' | 'prop-without-target';
  detail: string;
}

/**
 * 人数是否对得上。
 *
 * @param text        该图对应那一句正文
 * @param tag         Base tag
 * @param characters  角色块(NAI V5)。单人协议下为空,此时只查人数 tag。
 * @param presentNames 该句里出现的已建档角色名
 * @param multiCast   协议是否使用角色块(NAI V5)
 */
export function diagnoseCast(
  text: string,
  tag: string,
  characters: Array<{ name: string; tag: string }>,
  presentNames: string[],
  multiCast: boolean,
): CastGap[] {
  const gaps: CastGap[] = [];
  const counts = readCounts(tag);
  const total = counts.girls + counts.boys;

  // 正文明确多名男性,画面却只有 1boy 甚至没有 boy —— 肉棒只能长在一个人身上
  const maleSignal = (text ?? '').match(EXTRA_MALE_RE);
  if (maleSignal && counts.boys <= 1) {
    gaps.push({
      kind: 'wrong-count',
      detail: `正文这里是多男同场(${maleSignal[0]}),画面却只有 ${counts.boys} 个 boy`,
    });
  } else if (!maleSignal && counts.boys === 1 && WEAK_EXTRA_MALE_RE.test(text ?? '')) {
    const weak = (text ?? '').match(WEAK_EXTRA_MALE_RE)![0];
    gaps.push({
      kind: 'wrong-count',
      detail: `正文写了「${weak}」而画面只有 1 个 boy:确认这两只手是不是两个人的,是就写 2boys 并各给一个角色块`,
    });
  }

  // 正文点名的在场角色多于画面里的人
  if (presentNames.length >= 2 && total > 0 && total < presentNames.length) {
    gaps.push({
      kind: 'wrong-count',
      detail: `正文点名了 ${presentNames.length} 个在场角色(${presentNames.join('、')}),画面人数只有 ${total}`,
    });
  }

  // 角色块与人数互相矛盾:块数多于人数 tag,说明有人的块被人数 tag 抵消掉了
  if (multiCast) {
    const named = characters.filter(item => item.name.trim()).length;
    if (named >= 2 && counts.girls + counts.boys < named) {
      gaps.push({
        kind: 'wrong-count',
        detail: `写了 ${named} 个角色块,人数 tag 却只有 ${counts.girls + counts.boys}`,
      });
    }
    // 角色块里某人 tag 全空,等于没有外貌,画出来会与别人粘连
    for (const item of characters) {
      if (!item.tag.trim() && named >= 2) {
        gaps.push({ kind: 'missing-actor', detail: `角色「${item.name}」的 tag 是空的` });
      }
    }
  }
  return gaps;
}

/**
 * 道具表。key = 匹配正文的写法,value = 该道具在 tag 里的写法。
 *
 * 只收「必须在某个部位上作用」的道具:笔、鞭子、冰块这些离了落点就没有意义。
 * 杯子、手机这类拿着就行、落点无所谓的不收。
 */
const PROP_RULES: ReadonlyArray<[RegExp, RegExp]> = [
  [/毛笔|毛笔墨水|笔尖|笔杆/, /(?:brush|calligraphy[-_ ]?brush|paintbrush)/i],
  [/羽毛(?:棒|尖)?拨|鸡毛掸/, /feather/i],
  [/蜡烛|烛油|蜡油/, /(?:candle|wax|wax[-_ ]?play)/i],
  [/冰块|冰块儿/, /ice/i],
  [/鞭子|皮鞭|马鞭/, /(?:whip|crop)/i],
  [/按摩棒|跳蛋|振动棒|假阳具|拉珠/, /(?:vibrator|dildo|sex[-_ ]?toy|anal[-_ ]?beads)/i],
  [/毛笔|钢笔|记号笔|马克笔/, /(?:pen|marker)/i],
];

/** 落点/接触部位词。道具必须落在这些词里的某一个上。 */
const TARGET_RE =
  /(?:breast|nipple|areola|belly|navel|thigh|thighs|inner[-_ ]?thigh|hip|hips|waist|crotch|pussy|vulva|clitoris|labia|mons|groin|back|spine|shoulder|neck|face|cheek|chin|lips|chest|collarbone|skin)/i;

/**
 * 正文说「用道具在某处作用」,tag 却没写出落点。
 *
 * 只在两件事同时成立时判:正文命中道具、tag 里也有这个道具;
 * tag 里压根没写道具时是另一回事(可能这格确实没入画)。
 */
export function diagnosePropTarget(text: string, tag: string): CastGap[] {
  const hay = text ?? '';
  const tagText = tag ?? '';
  const gaps: CastGap[] = [];
  for (const [zh, en] of PROP_RULES) {
    const zhMatch = hay.match(zh);
    if (!zhMatch) continue;
    if (!en.test(tagText)) continue;
    // 道具出现了,但没有任何部位词:沦为摆设
    if (!TARGET_RE.test(tagText)) {
      gaps.push({
        kind: 'prop-without-target',
        detail: `正文写了用「${zhMatch[0]}」作用在身体上,画面有道具却没有落点部位`,
      });
      break;
    }
  }
  return gaps;
}

/** 重试话术。 */
export function castRetryNote(gaps: CastGap[]): string {
  const lines = gaps.map(gap => `- ${gap.detail}`);
  return `<cast_retry>
上一版的画面事实对不上正文,主要是人数和道具落点:
${lines.join('\n')}
改法:
- 人数:正文里有几个在场者就写几个,人数 tag 写成 2girls/1boy+2girls 这样,并给每个可见个体一个角色块;两个人只剩一个人时,画面就会退化成自慰。
- 道具:写了道具就必须写它落在哪个部位上,再补该部位的接触词(brush on pussy、whip on thigh 这类);只写一件孤立道具,模型会把它画在手里当摆设。
- 只改这些问题对应的部分,不过改动的地方保持原样。
直接从 <thinking> 开始,不要解释。
</cast_retry>`;
}
