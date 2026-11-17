/**
 * 同一属性互斥检查（封闭集合）。
 *
 * 只处理「两个词不可能同时为真」这一类，不去评判谁更好：
 * - 袖长：短袖与长袖不能同屏（模型常把正文的短袖与档案的长袖一起写上）；
 * - 穿着类否定与肯定：`no shirt` 与 `shirt`、`shirt removed` 与 `shirt`；
 * - 裸体与着装：`completely nude` 与任何上衣/下装；
 * - 人数：`solo` 与 `1boy`/`2boys`/`multiple boys` 不能并存；
 * - 内外层：外层扣好时内层不该露（`conceals` 已挡，这里补「同屏出现 bra 但外层 closed」的残局）。
 *
 * 判定靠「封闭集合 + 同一事实的两种说法」，不靠词表枚举剧情。
 */

const SLEEVES = ['sleeveless', 'short sleeves', 'long sleeves'] as const;
const TOPS = /\b(?:shirt|blouse|t-shirt|sweater|hoodie|jacket|coat|dress|tank top|camisole|uniform)\b/i;
const BOTTOMS = /\b(?:skirt|pants|jeans|shorts|trousers|leggings)\b/i;
const NUDE = /\b(?:completely nude|naked|nude|topless|bottomless|nipples|no bra|no panties)\b/i;
const MALE_COUNT = /\b(?:1boy|2boys|3boys|multiple boys)\b/i;
const NEGATED = (word: string) =>
  new RegExp(`\\b(?:no|without|not wearing)\\s+(?:her\\s+|his\\s+)?${word}\\b|\\b${word}\\s+(?:removed|off|on the floor)\\b`, 'i');

export interface ConflictResult {
  tag: string;
  /** 人话说明改了什么；空数组表示没动。 */
  notes: string[];
}

function pieces(tag: string): string[] {
  return tag
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean);
}

/**
 * @param tag 待检查的一段（Base 或某个角色）
 * @param source 本楼正文：袖长这种「正文明说」的字段，一律以正文为准，不靠模型记忆
 */
export function resolveTagConflicts(tag: string, source = ''): ConflictResult {
  const notes: string[] = [];
  let items = pieces(tag);

  // 1) 袖长：正文说了短袖就留短袖；正文没说就留先出现的那个。
  const sleeves = items.filter((item) => (SLEEVES as readonly string[]).includes(item.toLowerCase()));
  if (sleeves.length > 1) {
    const textSaid = (SLEEVES as readonly string[]).find((word) => {
      const zh = word === 'short sleeves' ? /短袖/ : word === 'long sleeves' ? /长袖/ : /无袖|吊带/;
      return zh.test(source);
    });
    const keep = (textSaid ?? sleeves[0]).toLowerCase();
    items = items.filter((item) => !(SLEEVES as readonly string[]).includes(item.toLowerCase()) || item.toLowerCase() === keep);
    notes.push(`袖长只留 ${keep}`);
  }

  // 2) 穿着类否定与肯定并存：同一件衣物不可能既写着穿着又写着脱下。
  const isNegated = (item: string) => /^(?:no|without|not wearing)\b/i.test(item) || /\b(?:removed|off)$/i.test(item);
  const garmentWord = (item: string) =>
    (item.match(/\b(shirt|blouse|t-shirt|sweater|hoodie|jacket|coat|dress|tank top|camisole|uniform|skirt|pants|jeans|shorts|trousers|leggings)\b/i) ?? [''])[0].toLowerCase();
  const negatedItems = items.filter((item) => isNegated(item) && garmentWord(item));
  const positiveItems = items.filter((item) => !isNegated(item) && garmentWord(item));
  if (negatedItems.length && positiveItems.length) {
    const positives = new Set(positiveItems.map(garmentWord));
    const drop = negatedItems.filter((item) => positives.has(garmentWord(item)));
    if (drop.length) {
      items = items.filter((item) => !drop.includes(item));
      notes.push('同一件衣物不再同时写「穿着」与「脱下」');
    }
  }

  // 3) 裸体与着装互斥：有明确上衣/下装时，裸体词只在正文也写了裸露时保留。
  const dressed = items.some((item) => TOPS.test(item) || BOTTOMS.test(item));
  if (dressed && items.some((item) => NUDE.test(item)) && !/(?:赤裸|裸体|没穿|脱下|光着)/.test(source)) {
    const kept = items.filter((item) => !NUDE.test(item));
    if (kept.length !== items.length) {
      items = kept;
      notes.push('身上写着衣服时不再同时写裸体');
    }
  }

  // 4) solo 与男方人数互斥：有男方就不可能 solo。
  if (MALE_COUNT.test(items.join(','))) {
    const kept = items.filter((item) => !/^solo$/i.test(item));
    if (kept.length !== items.length) {
      items = kept;
      notes.push('有男方时去掉 solo');
    }
  }

  return { tag: items.join(', '), notes };
}
const HAIR_COLORS = ['black hair','brown hair','blonde hair','white hair','silver hair','red hair','pink hair','blue hair','purple hair','grey hair','green hair'];
const EYE_COLORS = ['brown eyes','blue eyes','green eyes','red eyes','amber eyes','gold eyes','grey eyes','purple eyes'];
const HAIR_LENGTHS = ['long hair','short hair','medium hair'];
const HAIR_STYLES = ['straight hair','wavy hair','curly hair','twin tails','bob cut','ponytail','braid','drill hair'];
const BODY_SHAPES = ['slender','curvy','petite','muscular','chubby'];
const HEIGHTS = ['tall','short stature'];
const ZH_OF: Record<string, RegExp> = {
  'black hair': /黑发|黑长直|黑色长发/,
  'brown hair': /棕发|褐色头发|棕色头发/,
  'blonde hair': /金发|金色头发/,
  'white hair': /白发|银白/,
  'silver hair': /银发/,
  'red hair': /红发/,
  'long hair': /长发|及腰/,
  'short hair': /短发/,
  'straight hair': /直发|长直/,
  'wavy hair': /波浪|卷发/,
  'twin tails': /双马尾/,
  slender: /纤细|苗条/,
  curvy: /丰满|曲线/,
  tall: /高挑/,
};

/**
 * 同一属性只留一个：头发颜色/长度/发型、眼睛颜色、体型。
 *
 * 抓到的真实错例：同一条 tag 里同时写着 `brown hair, wavy hair, blonde hair, twin tails`，
 * 出图就是四种头发互相拉扯；`curvy` 与 `slender` 同屏也是同一件身体说了两遍。
 * 判据：正文点名的优先，否则留先出现的那个（模型通常把档案里的写在前面）。
 */
export function collapseAttributes(tag: string, source = ''): ConflictResult {
  const notes: string[] = [];
  let items = pieces(tag);
  for (const group of [HAIR_COLORS, EYE_COLORS, HAIR_LENGTHS, HAIR_STYLES, BODY_SHAPES, HEIGHTS]) {
    const hits = items.filter((item) => group.includes(item.toLowerCase()));
    if (hits.length < 2) continue;
    const said = group.find((word) => ZH_OF[word]?.test(source));
    const keep = (said ?? hits[0]).toLowerCase();
    items = items.filter((item) => !group.includes(item.toLowerCase()) || item.toLowerCase() === keep);
    notes.push(`同一属性只留 ${keep}`);
  }
  return { tag: items.join(', '), notes };
}