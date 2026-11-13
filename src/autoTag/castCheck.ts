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
 * 只有「两个男人同时在跟她发生关系」才必须画两个男身。
 *
 * 正文只写「三个男人围着她」「男人们看着」时，镜头可以只留女主 + 一根肉棒、一只手——
 * 那是用户要的效果。旧版把这类「在场」写法也当硬错误，逼模型把三个完整男人塞进画框，
 * 直接导致多人构图崩坏。
 */
const EXTRA_MALE_STRONG_RE =
  /(?:前后夹|一前一后|两根肉棒|双插|两根一起|同时插|两人一起|三人行)/;

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
  kind:
    | 'missing-actor'
    | 'wrong-count'
    | 'prop-without-target'
    | 'contact-unbound'
    | 'missing-female';
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
 * @param femaleNames 已知的女性角色名单。给了它就只按女性核对人数——
 *                    多人场景里男性本来就可以被裁成局部身位，用「总人数」卡会把
 *                    正确的裁剪判成错，逼模型把一堆男伴重新塞回画布。
 */
/**
 * 判断这一格是不是「三人以上的场面」。
 *
 * 判据取三者最大值:正文点名的在场女性数、正文里的男性信号、实际写出的角色块数。
 * 少一个人的写法也要能识别——「三个男人围着她」里她是一个,男人是三个。
 */
function youngCrowd(
  text: string,
  counts: { girls: number; boys: number },
  womenPresent: number,
  blocks: number,
): boolean {
  const hay = text ?? '';
  const femaleCount = Math.max(womenPresent, counts.girls);
  const maleCount = Math.max(
    counts.boys,
    (hay.match(EXTRA_MALE_RE) ? 2 : 0),
    (hay.match(/三个男人|三个男的|三名男性|几个男人|男人们/) ? 3 : 0),
  );
  const others = /(?:围着她|围了上来|轮番|轮流|chōkyō|gangbang|一群|一屋子的?男人|众人)/.test(hay) ? 3 : 0;
  return femaleCount + maleCount >= 3 || blocks + femaleCount >= 3 || others > 0;
}

export function diagnoseCast(
  text: string,
  tag: string,
  characters: Array<{ name: string; tag: string }>,
  presentNames: string[],
  multiCast: boolean,
  femaleNames: readonly string[] = [],
): CastGap[] {
  const gaps: CastGap[] = [];
  const counts = readCounts(tag);
  const femaleSet = new Set(femaleNames.map((name) => name.trim()).filter(Boolean));
  const womenPresent = femaleSet.size
    ? presentNames.filter((name) => femaleSet.has(name.trim()))
    : presentNames;
  /**
   * 三人以上的场面（一男多女、多男多女、多男一女）走「裁人」口径：
   * 男伴默认只留正在接触的那副身体（一根肉棒、一只手、一段腰胯），
   * 没参与这一格动作的女性也不强求入画。双人戏仍按剧情与构图自由裁量。
   */
  const crowd = youngCrowd(text, counts, womenPresent.length, characters.length);

  // 正文明确「两个男人同时在她身上」,画面却只有 1boy —— 肉棒只能长在一个人身上
  if (EXTRA_MALE_STRONG_RE.test(text ?? '') && counts.boys <= 1) {
    const signal = (text ?? '').match(EXTRA_MALE_STRONG_RE)![0];
    gaps.push({
      kind: 'wrong-count',
      detail: `正文这里是两个男人同时在跟她发生关系(${signal}),画面却只有 ${counts.boys} 个 boy:另一副身体至少要留下一根肉棒或一只手`,
    });
  } else if (!EXTRA_MALE_STRONG_RE.test(text ?? '') && counts.boys === 1 && WEAK_EXTRA_MALE_RE.test(text ?? '')) {
    const weak = (text ?? '').match(WEAK_EXTRA_MALE_RE)![0];
    gaps.push({
      kind: 'wrong-count',
      detail: `正文写了「${weak}」而画面只有 1 个 boy:确认这两只手是不是两个人的,是就写 2boys 并各给一个角色块`,
    });
  }

  /**
   * 女性人数核对分两种场面:
   * - 双人/小场面:正文点名的女性都要在画面里——只画一个等于把另一个人凭空抹掉。
   * - 三人以上:按这一格的动作裁人。没参与互动的女性（站在旁边看、刚进门、
   *   已经昏过去）不必入画，硬塞进来只会让构图崩坏。
   */
  if (counts.girls > 0 && !crowd && womenPresent.length >= 2 && counts.girls < womenPresent.length) {
    gaps.push({
      kind: 'wrong-count',
      detail: `正文点名了 ${womenPresent.length} 个在场女角色(${womenPresent.join('、')}),画面女性人数只有 ${counts.girls}`,
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
    // 多人角色块使用了单向动作标签 source# / target# 时,必须成对闭合(一施一受)
    if (named >= 2) {
      const hasSource = characters.some(item => /\bsource#/i.test(item.tag ?? ''));
      const hasTarget = characters.some(item => /\btarget#/i.test(item.tag ?? ''));
      if (hasSource !== hasTarget) {
        gaps.push({
          kind: 'contact-unbound',
          detail: `角色块写了单边 ${hasSource ? 'source#' : 'target#'} 却没有另一方的 ${hasSource ? 'target#' : 'source#'} 配对,多人接触的施受运动方向不闭合`,
        });
      }
    }
  }
  return gaps;
}

/**
 * 道具表。key = 匹配正文的写法,value = 该道具在 tag 里的写法。
 *
 * 只收「必须在某个部位上作用」的道具:笔、鞭子、冰块、绳索、口球、刀刃这些离了落点就没有意义。
 * 普通随身物件不收。
 */
const PROP_RULES: ReadonlyArray<[RegExp, RegExp]> = [
  [/毛笔|毛笔墨水|笔尖|笔杆/, /(?:brush|calligraphy[-_ ]?brush|paintbrush)/i],
  [/羽毛(?:棒|尖)?拨|鸡毛掸/, /feather/i],
  [/蜡烛|烛油|蜡油/, /(?:candle|wax|wax[-_ ]?play)/i],
  [/冰块|冰块儿/, /ice/i],
  [/鞭子|皮鞭|马鞭|戒尺|藤条/, /(?:whip|crop|paddle|cane|rod)/i],
  [/按摩棒|跳蛋|振动棒|假阳具|拉珠/, /(?:vibrator|dildo|sex[-_ ]?toy|anal[-_ ]?beads|egg[-_ ]?vibrator)/i],
  [/毛笔|钢笔|记号笔|马克笔/, /(?:pen|marker)/i],
  [/绳子|麻绳|红绳|绳索|捆绑|五花大绑/, /(?:rope|shibari|bondage)/i],
  [/手铐|脚铐|镣铐|铐住/, /(?:handcuffs|shackles|cuffs|manacles)/i],
  [/项圈|狗链|锁链|铁链/, /(?:collar|leash|chain)/i],
  [/口球|眼罩|封口胶带|蒙住眼睛/, /(?:gag|ball[-_ ]?gag|blindfold|tape)/i],
  [/刀刃|匕首|刀尖|剑尖|短刀/, /(?:knife|blade|dagger|sword)/i],
  [/针筒|注射器|针尖/, /(?:syringe|needle)/i],
  [/红酒|酒液|牛奶|精油|润滑液/, /(?:wine|milk|oil|lotion)/i],
];

/** 落点/接触部位词。道具必须落在这些词里的某一个上。 */
const TARGET_RE =
  /(?:breast|nipple|areola|belly|navel|thigh|thighs|inner[-_ ]?thigh|hip|hips|waist|crotch|pussy|vulva|clitoris|labia|mons|groin|back|spine|shoulder|neck|face|cheek|chin|lips|mouth|tongue|throat|ear|ears|eye|eyes|chest|collarbone|skin|wrist|wrists|ankle|ankles|foot|feet|toe|toes|ass|butt|buttocks|anus)/i;

/**
 * 正文说「用道具在某处作用」,tag 却没写出落点或没绑定到部位上。
 *
 * 只在两件事同时成立时判:正文命中道具、tag(含角色块)里也有这个道具;
 * tag 里压根没写道具时是另一回事(可能这格确实没入画)。
 */
export function diagnosePropTarget(text: string, tag: string, charTags: string[] = []): CastGap[] {
  const hay = text ?? '';
  const allTagText = [tag ?? '', ...charTags].filter(Boolean).join(', ');
  const gaps: CastGap[] = [];
  for (const [zh, en] of PROP_RULES) {
    const zhMatch = hay.match(zh);
    if (!zhMatch) continue;
    if (!en.test(allTagText)) continue;
    // 道具出现了,但没有任何部位词:沦为摆设
    if (!TARGET_RE.test(allTagText)) {
      gaps.push({
        kind: 'prop-without-target',
        detail: `正文写了用「${zhMatch[0]}」作用在身体上,画面有道具却没有落点部位`,
      });
      break;
    }
    // 道具和部位都在,但如果正文明确有接触动作(写/划过/贴/刺/滴/捆等),却没有任何介词或动词绑定,模型会画成两样独立物体
    if (
      (CONTACT_VERB_RE.test(hay) || /(?:写字|抽打|滴落|滴在|捆住|绑住|铐住|戴上|塞入)/.test(hay)) &&
      !BINDING_RE.test(allTagText) &&
      !/(?:source#|target#|mutual#)/i.test(allTagText)
    ) {
      gaps.push({
        kind: 'contact-unbound',
        detail: `正文写了用「${zhMatch[0]}」作用在身体上,画面虽有道具与部位却只是孤立并列,未用介词或动作词组绑定(应写 <道具> on/against/into/around <部位>)`,
      });
      break;
    }
  }
  return gaps;
}

/**
 * 绑定词:把道具或另一个人**钉在身体上**的介词与动词。
 *
 * 用户原话:「剧情里出现一个物体接触人体,结果图片就是直接把它们两个都画出来」——
 * 道具在、身体在,但两者之间没有绑定词,模型只会并排画两样东西。
 */
const BINDING_RE =
  /(?:\bon\b|\bonto\b|\bagainst\b|\binto\b|\binside\b|\bbetween\b|\bover\b|\bacross\b|\balong\b|\bdown\b|\bup\b|\bunder\b|\bthrough\b|pressing|pressed|touching|touched|resting|rests|rubbing|pulling|pulled|pushing|pushed|sliding|slides|dripping|dripped|held|holding|wrapped|around|inserted|penetrat|spread|smeared|trailing|traced|lifted|lifting|writing|written|grabbing|grabbed|pinning|pinned|stepping|stepped|bound|tied|licking|sucking|kissing|biting|spanking|straddling)/i;

/**
 * 正文里「道具或肢体作用在身体上」的动作词。命中才查绑定。
 *
 * 不算接触的:拿、握、举、放回桌上——这些本来就只是握着,落点无所谓。
 */
const CONTACT_VERB_RE =
  /(?:划过|划向|滑向|滑过|蹭过|蹭向|贴上|贴住|抵住|抵在|按在|按上|压上|压在|落在|放到|放在|抹在|涂在|写上|写向|点上|刺入|探进|塞进|插入|伸进|搅动|摩擦|磨蹭|扫过|拂过|绕上|缠上|卷上|勾住|勾在|挑开|拨开|推开|分开|揉捏|捏住|掐住|抓着|按住)/;

/**
 * 道具或第二个人在正文里接触了身体,tag 却只是把它们并排列出。
 *
 * 与 diagnosePropTarget 分工不同:那条查「落点部位有没有出现」,这条查
 * **两者之间有没有绑定**——`1girl, hand, cup` 与 `1girl, holding cup` 的差别就是它。
 *
 * @param text     该图对应那一句正文
 * @param tag      Base tag
 * @param charTags 角色块 tag(NAI V5)。绑定词与部位常常写在角色块里,所以要合起来看。
 */
export function diagnoseContact(text: string, tag: string, charTags: string[] = []): CastGap[] {
  const hay = text ?? '';
  const verb = hay.match(CONTACT_VERB_RE);
  if (!verb) return [];
  const tagText = tag ?? '';
  const allText = [tagText, ...charTags].filter(Boolean).join(', ');
  if (!allText.trim()) return [];
  // 绑定词或 NAI V4.5/V5 的 source#/target#/mutual# 出现在任一处就算绑定成立
  if (BINDING_RE.test(allText) || /(?:source#|target#|mutual#)/i.test(allText)) return [];

  // 只有当画面(含 Base 与角色块)里确实同时有「手/手臂/道具」与「身体」两者时才可能是并列画法;
  // 少任何一边都不是这条要管的事。
  const hasActor = /(?:hand|hands|arm|arms|finger|fingers|pov hands|object|prop)/i.test(allText);
  const hasBody = TARGET_RE.test(allText);
  if (!hasActor || !hasBody) return [];

  return [
    {
      kind: 'contact-unbound',
      detail: `正文写的是「${verb[0]}」这类接触,画面里手/道具与身体都在,却没有一个词把它们钉在一起`,
    },
  ];
}

/**
 * 画面里没有女性主体。
 *
 * 生成模型在「这一段主要在写男人/环境」时会交只有男主或纯背景的图。
 * 这类图对用户没有价值：既没有代入感，也谈不上剧情插图。这里只做确定性判定：
 * 图里既没有被认定为女性的命名角色、base tag 里也没有 girl 人数，就算缺女性主体。
 * 正文这一段是否真有女性，决定重试话术是「把在场的补进画面」还是「换一段/少出一张」。
 */
export function diagnoseFemaleSubject(
  text: string,
  image: { tag: string; characters?: { name: string }[] },
  femaleNames: readonly string[],
): CastGap[] {
  const girls = readCounts(image.tag ?? '').girls;
  const hasFemaleChar = (image.characters ?? []).some(
    character => !!character.name && femaleNames.includes(character.name),
  );
  if (girls > 0 || hasFemaleChar) return [];
  const named = [...new Set(femaleNames.filter(name => name && (text ?? '').includes(name)))];
  if (named.length) {
    return [
      {
        kind: 'missing-female',
        detail: `正文这一段里有女性角色（${named.join('、')}），画面里却没有她`,
      },
    ];
  }
  if (/她|少女|女人|女子|女孩|姑娘|女修|女士|小姐/.test(text ?? '')) {
    return [
      {
        kind: 'missing-female',
        detail: '正文这一段用的是女性指代（她），画面里却没有女性角色',
      },
    ];
  }
  return [
    {
      kind: 'missing-female',
      detail: '正文这一段没有女性角色在场，不能为它出只有男性或纯背景的图',
    },
  ];
}

/**
 * 施受方向有没有写反。
 *
 * 用户原话：「人物动作对于是谁发起的、谁是被动的有点弄不清楚」。tag 里
 * `source#` 是施力方、`target#` 是受力方，这两个词一旦挂错人，整张图的动作关系
 * 就反了——她主动跨坐变成被他压，他按住她变成她夹住他。
 *
 * 判据只看**明确的主动句式**，不做语义猜测：正文写「她伸手/她按/她跨坐/她主动」
 * 这类，却把 source# 写在男性块上，就算反了。没写清楚的（「两人纠缠」）一律放过，
 * 不猜。
 *
 * @param text        该图对应那一句正文
 * @param characters  角色块
 * @param maleNames   已知男性角色名（用来判断 source# 挂在谁身上）
 */
export function diagnoseDirection(
  text: string,
  characters: Array<{ name: string; tag: string }>,
  maleNames: readonly string[] = [],
): CastGap[] {
  const hay = text ?? '';
  const femaleLead = /她(?:主动|伸手|抓住|按住|压住|跨坐|骑上|骑在|坐上|俯身|跪下|含住|吞下|拉过|扯开|解开)/.test(hay);
  if (!femaleLead) return [];
  if (characters.length < 2) return [];
  const males = new Set(maleNames.map((name) => name.trim()).filter(Boolean));
  const maleBlocks = characters.filter((item) => males.has(item.name.trim()));
  if (!maleBlocks.length) return [];
  const femaleBlocks = characters.filter((item) => !!item.name.trim() && !males.has(item.name.trim()));
  // 只有「男主挂了 source#、女主一个 source# 都没有、只有 target#」才算真反了;
  // 两边都写了 source#(互相主动)是正常的,不拦。
  const maleSources = maleBlocks.some((item) => /\bsource#/i.test(item.tag ?? ''));
  const femaleSources = femaleBlocks.some((item) => /\bsource#/i.test(item.tag ?? ''));
  const femaleTargets = femaleBlocks.some((item) => /\btarget#/i.test(item.tag ?? ''));
  if (!maleSources || femaleSources || !femaleTargets) return [];
  return [
    {
      kind: 'contact-unbound',
      detail: `正文是女主主动（「${(hay.match(/她(?:主动|伸手|抓住|按住|压住|跨坐|骑上|骑在|坐上|俯身|跪下|含住|吞下|拉过|扯开|解开)[^。！？]{0,12}/) ?? [''])[0]}」），画面却把 source# 挂在男性角色块上、让女主当 target#，施受方向反了`,
    },
  ];
}

/** 重试话术。 */
export function castRetryNote(gaps: CastGap[]): string {
  const lines = gaps.map(gap => `- ${gap.detail}`);
  const hasContact = gaps.some(gap => gap.kind === 'contact-unbound');
  const hasFemale = gaps.some(gap => gap.kind === 'missing-female');
  const hasDirection = gaps.some(gap => gap.detail.includes('施受方向反了'));
  return `<cast_retry>
上一版的画面事实对不上正文,主要是人数、道具落点、接触绑定与女性主体:
${lines.join('\n')}
改法:
- 人数:**双人戏**（一男一女）两个人都在动作里,就必须都在画面里——只画一个等于自慰,不是省人。
- 人数:**三人以上的场面**换一套口径——镜头只留给这一格真正在动作里的人。男伴默认只留正在接触的那副身体（一根肉棒、一只手、一段腰胯、一截手臂),写成 faceless male 的最小角色块,不给脸也不给全身;**没参与这一格动作的女性也不用入画**（站在旁边看、刚进门、已经昏过去的人塞进来只会让构图崩）。挑一到两个关键女主完整入画,其余按参与度给局部。**不要为了凑人数把在场的人全画上。**
- 道具:写了道具就必须按「三元闭环」写清谁拿着(holding <prop>)、落在哪个部位上(<prop> on/against/into/around <部位>)、以及受作部位的反应;只写一件孤立道具,模型会把它画在半空当摆设。${
    hasContact
      ? `
- 接触:并排列出「手/道具」和「身体部位」不会让它们碰上,必须用一个绑定词把两者钉在一起(hand on cheek、brush on pussy、fingers inside her、hand pressing her back),并在 NAI V4.5/V5 角色块中用成对的 source#<动作> 与 target#<动作> 锁定施受方向;英文介词 on / against / into / around 或现在分词 pressing / holding / resting / writing 都算绑定。实在绑不住就改取景:close-up + hand focus,让画面里只留下这一段接触。`
      : ''
  }${
    hasDirection
      ? `
- 施受方向:正文写的是女主主动（她伸手/她按/她跨坐/她俯身），施力方就该是女主——source# 写在她的角色块上，男主块写 target#<受迫状态> 与受力部位。反过来写成「男主 source#、女主 target#」，画出来就是她在被动承受，与她主动的剧情相反。两人互相主动时可以各写一个 source#。`
      : ''
  }${
    hasFemale
      ? `
- 女性主体:**每一格画面里至少要有一名女性角色**,她必须占据视觉重心;图片的 tag 里要有人数(1girl 或 2girls),并给她一个 characters 角色块。
- 正文这一段明明有女性在场,就把她写进画面;这一段确实没有女性角色时,不要为它出图——换到本楼有女性在场的段落,或者直接少出一张。**任何情况下都不要交只有男主或纯背景的图**,那种图等于没画。`
      : ''
  }
- 只改这些问题对应的部分,不过改动的地方保持原样。
直接从 <thinking> 开始,不要解释。
</cast_retry>`;
}
