/**
 * 从中文正文里认出「这一楼她身上穿的是什么」。
 *
 * 为什么需要：账本（bbiOutfitState）只跟着换装动作走——「换上/穿上/脱掉」。
 * 剧情从泳池直接切到「第二天早上……制服衬衫扣到第二颗，蓝格纹百褶裙平整地铺在椅面上」，
 * 一个换装动词都没有：账本停在泳衣上，enforceClothing 就把 swimsuit 塞回角色 tag，
 * 于是正文写校服、图里还是泳衣。模型读的也是同一段正文，但它会照抄账本。
 *
 * 所以这里把正文里出现的衣物词翻成 danbooru 词，作为「正文口径」交给提示词与服装层：
 * 正文口径与账本冲突时以正文为准（见 enforceClothing 的 near-text 判据）。
 *
 * 只认 tagChinese 里确实存在的中文名，且必须是服装类词条——不做模糊联想，
 * 免得「桌上放着一件外套」被当成她穿着外套。
 */
import tagChinese from '@/data/tagChinese.json';
import { TAG_LEXICON } from '@/data/tagLexicon';

const CLOTHING = new Set(TAG_LEXICON.clothing);

// tagChinese 的口径不会覆盖口语写法（「泳衣」记的是「泳装」）。这里补一批常用别名，
// 只补「正文里真的会这么写」的词，且都指向 danbooru 上真实存在的 tag。
const ALIASES: Array<[string, string]> = [
  ['连体泳衣', 'one-piece swimsuit'],
  ['泳衣', 'swimsuit'],
  ['泳装', 'swimsuit'],
  ['泳裤', 'speedo'],
  ['水手领', 'sailor collar'],
  ['水手服', 'serafuku'],
  ['制服衬衫', 'shirt'],
  ['百褶裙', 'pleated skirt'],
  ['长袜', 'thighhighs'],
  ['过膝袜', 'thighhighs'],
  ['皮鞋', 'loafers'],
  ['领结', 'neckerchief'],
  ['校服', 'school uniform'],
  ['连衣裙', 'dress'],
  ['内裤', 'panties'],
  ['胸罩', 'bra'],
  ['文胸', 'bra'],
  ['吊带袜', 'garter belt'],
];

// 中文名 → danbooru tag。只收录服装词，且中文名至少两个字（单字误报太多）。
const INDEX: Array<{ zh: string; tag: string }> = Object.entries(tagChinese as Record<string, string>)
  .filter(([tag, zh]) => {
    if (typeof zh !== 'string') return false;
    if (!CLOTHING.has(tag)) return false;
    return zh.length >= 2 && zh.length <= 8;
  })
  .map(([tag, zh]) => ({ zh, tag }))
  // 长词优先，避免「裙」抢先匹配「百褶裙」
  .sort((a, b) => b.zh.length - a.zh.length);

/** 正文里出现的衣物词（去重、按出现顺序、上限 12 个）。 */
export function storyGarments(text: string): string[] {
  if (!text || text.length < 2) return [];
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const [zh, tag] of ALIASES) {
    if (text.includes(zh) && !seen.has(tag)) {
      hits.push(tag);
      seen.add(tag);
    }
  }
  for (const { zh, tag } of INDEX) {
    if (seen.has(tag)) continue;
    if (!text.includes(zh)) continue;
    // 同一类别只留最先命中的那个（百褶裙 命中后，skirt 不再重复收集）
    hits.push(tag);
    seen.add(tag);
    if (hits.length >= 12) break;
  }
  return hits;
}

/** 给提示词用的一行；正文没提衣物时返回空串。 */
export function storyGarmentLine(text: string): string {
  const garments = storyGarments(text);
  if (!garments.length) return '';
  return `【本楼正文衣物】${garments.join(', ')}\n（这一行是从本楼正文里认出来的穿着。它与上面的账本冲突时，以本楼正文为准；账本只是上一楼留下的状态。）`;
}
// 场所：Base 只写 `house, day` 太糊，模型会把「楼梯」「走廊」这些真正决定画面的词省掉。
// 只认正文里确实写到的场所，认不出来就不补——替模型编场所比写糊更糟。
const PLACE_ALIASES: Array<[string, string[]]> = [
  ['排练厅', ['rehearsal hall']],
  ['排练室', ['rehearsal hall']],
  ['舞台', ['stage']],
  ['机房', ['equipment room']],
  ['楼梯', ['stairs']],
  ['楼上', ['stairs']],
  ['走廊', ['hallway']],
  ['过道', ['hallway']],
  ['玄关', ['doorway']],
  ['门口', ['doorway']],
  ['教室', ['classroom']],
  ['客厅', ['living room']],
  ['卧室', ['bedroom']],
  ['房间', ['bedroom']],
  ['浴室', ['bathroom']],
  ['卫生间', ['bathroom']],
  ['洗手间', ['bathroom']],
  ['厨房', ['kitchen']],
  ['沙发', ['couch']],
  ['床上', ['bed']],
  ['车内', ['car interior']],
  ['街道', ['street']],
  ['街', ['street']],
  ['天台', ['rooftop']],
  ['阳台', ['balcony']],
  ['办公室', ['office']],
  ['酒店', ['hotel']],
  ['公寓', ['apartment']],
  ['学校', ['school']],
  ['窗', ['window']],
];

const PLACE_TAGS = new Set([...TAG_LEXICON.scene, 'rehearsal hall', 'equipment room', 'stage']);
const PLACE_CJK = Object.entries(tagChinese as Record<string, string>)
  .filter(([tag, zh]) => typeof zh === 'string' && PLACE_TAGS.has(tag) && zh.length >= 2 && zh.length <= 8)
  .map(([tag, zh]) => ({ zh, tag }))
  .sort((a, b) => b.zh.length - a.zh.length);

/** 这一段里「人真的在」的场所：场所词前面得有方位/动作线索（在/于/进/到/里/从、
 *  坐在/站在/躺在/趴在），否则多半只是被顺口提到（「明天还要回学校」不是这个画面）。
 *  只认这类带线索的命中，才不会出现客厅段落被写成 `living room, street, school`。 */
/** 场所词的「人真的在这里」线索。除了在/于/进/到/里，还包括带方向的动词
 *  （推开教室门走进去、回到卧室、穿过走廊）——只认介词会把最常见的写法漏掉。 */
const LOCATIVE_BEFORE =
  /(?:在|于|进|到|从|里|中|内|上|坐|站|躺|趴|蹲|靠|走|跑|推开|推门|拉开|回到|返回|穿过|经过|路过|来到|进入|走进)/;
const LOCATIVE_AFTER = /^(?:里|内|中|上方|中央|边缘|旁边)/;

function placeMentioned(text: string, zh: string): boolean {
  let from = 0;
  while (true) {
    const index = text.indexOf(zh, from);
    if (index < 0) return false;
    const before = text.slice(Math.max(0, index - 10), index);
    if (LOCATIVE_BEFORE.test(before) || LOCATIVE_AFTER.test(text.slice(index + zh.length))) return true;
    from = index + zh.length;
  }
}

/** 家具与脚下物件不是「另一个房间」：`couch`/`bed`/`stairs` 这类本来就和房间共存，
 *  只属于画面里的落点，不参与「只留一个场所」的裁剪。 */
const PLACE_FURNITURE = /^(?:couch|sofa|bed|desk|chair|table|bench|bathtub|pool|floor|stairs?|doorway|living room)$/;

/** 正文里的动作词——场所离动作越近，越可能是这一格真正发生的地方。 */
const ACTION_CHAR = /[坐站躺趴蹲走跑进出靠跪睡醒望看等笑哭脱穿抱吻咬舔抓握按推拉]/;

function firstActionIndex(text: string): number {
  const match = ACTION_CHAR.exec(text);
  return match ? match.index : -1;
}

function nearestLocativeIndex(text: string, zh: string): number {
  let from = 0;
  let best = -1;
  while (true) {
    const index = text.indexOf(zh, from);
    if (index < 0) return best;
    const before = text.slice(Math.max(0, index - 10), index);
    if (LOCATIVE_BEFORE.test(before) || LOCATIVE_AFTER.test(text.slice(index + zh.length))) best = index;
    from = index + zh.length;
  }
}

/**
 * 这一段真正发生在哪：场所词里离第一个动作最近的那个。
 *
 * 为什么要挑一个而不是全留：一段话经常同时提到两个地方（「她坐在客厅喝奶茶，
 * 明天还得回学校」「他从楼梯下端看着走廊里的她」）。两个场所同时进 Base，
 * 画面就会同时出现客厅和街道——一个镜头只有一个「在哪」。
 */
export function primaryPlace(text: string): string {
  if (!text) return '';
  const action = firstActionIndex(text);
  let best = '';
  let bestScore = Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  const consider = (zh: string, tags: readonly string[]): void => {
    const at = nearestLocativeIndex(text, zh);
    if (at < 0) return;
    for (const tag of tags) {
      const lower = tag.toLowerCase();
      if (!PLACE_TAGS.has(lower) || seen.has(lower) || PLACE_FURNITURE.test(lower)) continue;
      // 离动作词越近越可能是「在哪」；没有动作词时按出现顺序。
      const score = action >= 0 ? Math.abs(at - action) : at;
      seen.add(lower);
      if (score < bestScore) {
        bestScore = score;
        best = lower;
      }
    }
  };
  for (const [zh, tags] of PLACE_ALIASES) consider(zh, tags);
  for (const { zh, tag } of PLACE_CJK) consider(zh, [tag]);
  return best;
}

/** 正文里出现的场所词（按出现顺序、上限 3 个）。 */
export function storyPlaces(text: string): string[] {
  if (!text) return [];
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const [zh, tags] of PLACE_ALIASES) {
    if (!placeMentioned(text, zh)) continue;
    for (const tag of tags) {
      if (!PLACE_TAGS.has(tag) || seen.has(tag)) continue;
      hits.push(tag);
      seen.add(tag);
    }
    if (hits.length >= 3) return hits;
  }
  for (const { zh, tag } of PLACE_CJK) {
    if (seen.has(tag) || hits.length >= 3) break;
    if (!placeMentioned(text, zh)) continue;
    hits.push(tag);
    seen.add(tag);
  }
  return hits;
}

/**
 * Base 里的场所词必须能在这段正文里找到出处。
 * 模型常把「客厅」写成 `living room, street, school`——多出来的两个是它顺手
 * 补的常见场景，和这一段没关系，画出来就像把客厅接在街上。这里只保留
 * 正文认得出的场所；一个都认不出时原样放行（宁可不删也不乱删）。
 */
export function groundScenes(tag: string, text: string): string {
  const places = new Set(storyPlaces(text));
  if (!places.size) return tag;
  // 一个镜头只有一个「在哪」：挑出离动作最近的那个场所，其余非家具场所一律删。
  // 只按 `storyPlaces` 过滤是不够的——两个场所都被正文提到时它会把两个都留下
  // （实机里客厅段落同时出现 `living room` 与 `school`）。
  const primary = primaryPlace(text);
  const tokens = tag.split(',').map((token) => token.trim()).filter(Boolean);
  const concrete = tokens.filter((token) => PLACE_TAGS.has(token.toLowerCase()));
  if (!concrete.some((token) => places.has(token.toLowerCase()))) return tag;
  return tokens
    .filter((token) => {
      const lower = token.toLowerCase();
      if (!PLACE_TAGS.has(lower)) return true;
      if (!places.has(lower)) return false;
      if (!primary || PLACE_FURNITURE.test(lower)) return true;
      return lower === primary;
    })
    .join(', ');
}

/** Prefer the scene proven by the current or an earlier story sentence. */
export function groundFramePlace(tag: string, text: string): string {
  const primary = primaryPlace(text);
  if (!primary) return tag;
  const tokens = new Set([...tag.split(',').map((token) => token.trim()).filter(Boolean), primary]);
  return groundScenes([...tokens].join(', '), text);
}
