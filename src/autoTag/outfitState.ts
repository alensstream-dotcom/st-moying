/**
 * 服装状态的**跨楼层账本**。
 *
 * 用户原话:「衣物固定感觉被你修改后还变差了,明明衣服没有变化,结果一层楼生出的图片
 * 衣服种类乱飘。隔了楼层就更加严重,可能当前楼层没有描述女主穿什么衣服,导致它就随便挑了。」
 * 「衣服穿脱、半穿半脱不固定,有时候女主是露肩膀或漏屁股…图片里就变成无衣服或全穿。」
 *
 * 根因是**视野**而不是规则:上下文只带最近几楼,当前楼又常常一句衣着都没写,
 * 于是模型每层都在从零决定穿什么、脱到什么程度。规则写多少条都没用——
 * 它没有可继承的事实。
 *
 * 这里把「谁现在穿着什么、脱到哪一步」落进该楼的 message.extra,
 * 下一楼开跑前读回来注入成【服装现状】区块。于是:
 * - 没写衣着的新楼有事实可抄,不再随机挑;
 * - 半脱是可持久化的中间态,不会因为没写就弹回全穿或滑到全裸。
 *
 * 注意:0.2.x 起跨楼层账本已统一由 outfitTimeline.ts(v2)接管,这里只保留
 * 「从 tag 串识别衣物 / 读穿脱程度 / 兼容读 v1 旧账本」三件事。
 *
 * 指纹的取法是**词表匹配**而非自由文本:从服装库里取所有 tag 词做词表,
 * 命中即视为衣着部件;不在词表里的词(发色、体型、表情)不会混进来。
 */

import { isAccessoryToken, isCollarToken, isPropToken } from '@/autoTag/props';
import { allWardrobeItems } from '@/data/loreIndex';
import { clothingWords } from '@/data/materialLibrary';
import type { STMessage } from '@/st/context';

/** 穿着程度。三档足够,再多模型就用不准。 */
export type WearLevel = 'worn' | 'partial' | 'off';

interface OutfitStateEntry {
  name: string;
  /** 冻结的衣着部件(英文 tag,取自服装库词表,已去重)。 */
  garment: string;
  /** 当前穿脱程度。 */
  wear: WearLevel;
  /** 半脱/脱下时保留在画面里的状态词(slipped down、around waist 等)。 */
  state: string;
}

interface OutfitFloorState {
  v: 1;
  swipe: number;
  entries: OutfitStateEntry[];
}

export const BBI_OUTFIT_EXTRA_KEY = 'bbiOutfitState';
const ENTRY_CAP = 24;

/**
 * 半脱状态词。danbooru 上「衣服还在身上但移位」的写法。
 * 顺序有意义:`on the floor` 这类脱落词要排在移位词之后判,否则被误判成 partial。
 */
const PARTIAL_STATE_RE =
  /(?:slipped[-_ ]?down|pulled[-_ ]?(?:aside|down|up)|unzipped|unbuttoned|open[-_ ]?(?:shirt|jacket|robe)|around[-_ ]?(?:waist|hips|one[-_ ]?arm|arm)|hanging[-_ ]?off[-_ ]?(?:shoulder|one[-_ ]?shoulder)|off[-_ ]?shoulder|one[-_ ]?shoulder[-_ ]?bare|hanging[-_ ]?on[-_ ]?one[-_ ]?arm|clothes[-_ ]?around[-_ ]?waist|undressed[-_ ]?partially|half[-_ ]?(?:naked|undressed|dressed)|torn|ripped|breasts[-_ ]?out|midriff[-_ ]?bare)/i;

/** 完全脱下。命中即 off(优先于 partial)。 */
const OFF_STATE_RE =
  /(?:completely[-_ ]?nude|fully[-_ ]?nude|full[-_ ]?nude|nude|naked|topless|bottomless|no[-_ ]?clothes|on[-_ ]?the[-_ ]?floor|discarded|undressed[-_ ]?completely)/i;

/** 只穿内衣的中间态。裸着上身但内裤还在,也算半脱而不是全裸。 */
const UNDERWEAR_ONLY_RE =
  /(?:in[-_ ]?(?:only[-_ ]?)?(?:underwear|lingerie|bra[-_ ]?and[-_ ]?panties|panties)|lingerie|underwear|panties|(?:^|[,\s])(?:bra|bikini)(?=$|[,\s]))/i;

/**
 * 纯颜色词。服装库的 tag 里有单独成词的 black、white,
 * 它们单独出现时说明不了穿了什么,不算衣着部件。
 */
const COLOR_ONLY = new Set([
  'black',
  'white',
  'red',
  'blue',
  'green',
  'yellow',
  'pink',
  'purple',
  'brown',
  'grey',
  'gray',
  'orange',
  'gold',
  'silver',
  'beige',
  'navy',
  'cream',
  'tan',
  'aqua',
]);

let garmentVocab: Set<string> | null = null;
let clothingWordCount = 0;

/**
 * 服装词表:服装库所有 tag 词 + 少量库外常见部件。
 *
 * 词表只用来**识别**衣着词,不用于注入——注入的是模型自己写过的那串原文,
 * 所以词表漏一个词最多是少记一件,不会写出它没穿过的东西。
 */
function vocab(): Set<string> {
  if (garmentVocab && clothingWordCount === clothingWords.length) return garmentVocab;
  const set = new Set<string>(clothingWords);
  for (const item of allWardrobeItems()) {
    for (const part of String(item.tags ?? '').split(',')) {
      const word = part.trim().toLowerCase();
      if (!word) continue;
      // 权重语法 2::xxx:: 与括号注释剥掉,只留词干
      const bare = word
        .replace(/^[-+\d.]+::/, '')
        .replace(/::/g, '')
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .trim();
      if (bare) set.add(bare);
    }
  }
  for (const extra of [
    'dress',
    'shirt',
    'skirt',
    'pants',
    'shorts',
    'jeans',
    'jacket',
    'coat',
    'bra',
    'panties',
    'underwear',
    'thighhighs',
    'pantyhose',
    'stockings',
    'garter belt',
    'apron',
    'uniform',
    'kimono',
    'yukata',
    'robe',
    'towel',
    'scarf',
    'gloves',
    'boots',
    'shoes',
    'sandals',
    'hoodie',
    'sweater',
    'cardigan',
    'blouse',
    'camisole',
    'leotard',
    'bodysuit',
    'bikini',
    'swimsuit',
    'socks',
    'belt',
    'necktie',
    'ribbon',
    'lingerie',
    'babydoll',
    'teddy',
    'chemise',
    'negligee',
    'bodystocking',
    'garter belt',
    'harness',
    'pasties',
    'armor',
    'breastplate',
    'jersey',
    'windbreaker',
    'petticoat',
    'crinoline',
    'gown',
    'hanbok',
    'sari',
    'fishnets',
    'boyshorts',
    'sports bra',
    'crotchless panties',
    'bloomers',
    'buruma',
    'catsuit',
    'zentai',
    'trunks',
    'sarong',
  ]) {
    set.add(extra);
  }
  garmentVocab = set;
  clothingWordCount = clothingWords.length;
  return set;
}

/**
 * 从一个角色的 tag 串里取出衣着部件(去重、保序、限量)。
 *
 * 按逗号分段扫描:只要某一段里含有服装词表里的词(或以 blazer/coat/gown/vest 等衣着中心词结尾),
 * 就把**整段**(含颜色与修饰词,如 `white dress`、`navy school blazer`、`dark pleated skirt`)
 * 原样保留下来。只存裸词会把颜色和版型全丢掉,下一楼账本只剩 `shirt, skirt`,颜色照样乱飘。
 */
const GARMENT_HEAD_RE =
  /(?:^|\s)(?:dress|shirt|t-shirt|skirt|miniskirt|pants|trousers|slacks|shorts|jeans|jacket|blazer|coat|raincoat|trenchcoat|overcoat|vest|waistcoat|suit|bra|bralette|panties|knickers|briefs|underwear|lingerie|negligee|nightgown|pajamas|pyjamas|thighhighs|kneehighs|pantyhose|stockings|tights|leggings|fishnets|garter(?:\s+belt|\s+straps)?|suspenders|apron|uniform|serafuku|sailor\s+collar|kimono|yukata|haori|hakama|hanfu|cheongsam|qipao|robe|bathrobe|towel|scarf|neckerchief|necktie|bowtie|choker|collar|necklace|pendant|earrings?|piercing|bracelet|bangle|anklet|hairpin|hair ornament|tiara|circlet|gloves|mittens|sleeves|wristbands|cuffs|boots|shoes|heels|loafers|sneakers|sandals|slippers|hoodie|sweater|pullover|turtleneck|cardigan|blouse|top|halterneck|tube\s+top|crop\s+top|tank\s+top|camisole|corset|bustier|leotard|bodysuit|jumpsuit|overalls|playsuit|romper|bikini|swimsuit|swimwear|trunks|bloomers|buruma|socks|anklets|tabi|belt|sash|obi|ribbon|cape|capelet|cloak|shawl|veil|headdress|headband|beret|hat|cap|gown|wedding dress|evening gown|hanbok|sari|lingerie|babydoll|teddy|chemise|bodystocking|garter belt|garter straps|harness|pasties|armor|armour|breastplate|chainmail|jersey|windbreaker|petticoat|crinoline|bustle|boyshorts|boxers|sports bra|bralette|crotchless panties)(?:$|\s)/i;

const NON_GARMENT_SEGMENT_RE =
  /\b(?:hair|eyes|eyelashes|eyebrows|pupils|skin|breasts|nipples|cleavage|ass|butt|hips|thighs|legs|waist|stomach|belly|navel|back|shoulders|neck|collarbone|clavicle|face|lips|mouth|tongue|teeth|ears|hands|fingers|arms|feet|toes|nails|sweat|tears|saliva|blush|smile|smiling|looking|staring|gaze|expression|sitting|standing|kneeling|lying|leaning|bending|squatting|straddling|hugging|holding|grabbing|touching|pressing|rubbing|kissing|licking|sucking|biting|solo|1girl|2girls|1boy|2boys|multiple|pov|close-up|upper\s+body|lower\s+body|cowboy\s+shot|full\s+body|portrait|from\s+(?:above|below|behind|side)|indoors|outdoors|background|lighting|light|shadow|window|bed|couch|sofa|chair|desk|table|wall|floor|door)\b/i;

export function extractGarment(tag: string): string {
  const found: string[] = [];
  const words = vocab();
  const segments = (tag ?? '')
    .split(',')
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/^[-+\d.]+::/, '')
        .replace(/::/g, '')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);

  for (const seg of segments) {
    if (found.length >= 12) break;
    if (COLOR_ONLY.has(seg)) continue;
    if (NON_GARMENT_SEGMENT_RE.test(seg)) continue;
    // 一次性道具(刀/手铐/绳…)不是衣服，记进账本会变成永久挂件。
    if (isPropToken(seg)) continue;
    // 裸 `collar` / `black collar` 同理：它既可能是项圈也可能是错觉，
    // 交给锚点按「本楼还提不提」决定，这里先不写进服装账本。
    // 但 choker / 项链这类常驻饰品要照常当衣服记下来。
    if (isCollarToken(seg) && !isAccessoryToken(seg)) continue;
    let matched = GARMENT_HEAD_RE.test(seg);
    if (!matched) {
      for (const word of words) {
        if (!word || COLOR_ONLY.has(word)) continue;
        const needle = word.replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
        if (!needle) continue;
        const re = new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`);
        if (re.test(seg)) {
          matched = true;
          break;
        }
      }
    }
    if (matched && !found.includes(seg)) found.push(seg);
  }
  return found.join(', ');
}

/** 从 tag 串读出穿脱程度。 */
export function readWear(tag: string): { wear: WearLevel; state: string } {
  const hay = tag ?? '';
  const off = hay.match(OFF_STATE_RE);
  const partialWords = [...hay.matchAll(new RegExp(PARTIAL_STATE_RE.source, 'gi'))].map((m) => m[0]);
  const partial = partialWords.join(', ');
  // 同时出现「脱到地上」与移位词时按移位算:衣服还在画面里,那是半脱
  if (partial) return { wear: 'partial', state: partial };
  if (off) {
    // 只有内裤/胸罩还在 = 半脱(不是全裸)
    if (UNDERWEAR_ONLY_RE.test(hay) && /\b(?:nude|naked|topless|bottomless)\b/i.test(hay)) {
      return { wear: 'partial', state: 'underwear only' };
    }
    return { wear: 'off', state: off[0] };
  }
  // Underwear mentioned underneath a complete outfit does not imply partial undressing.
  return { wear: 'worn', state: '' };
}

function normalizeEntry(raw: unknown): OutfitStateEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Partial<OutfitStateEntry>;
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!name) return null;
  const wear: WearLevel = item.wear === 'off' || item.wear === 'partial' ? item.wear : 'worn';
  return {
    name,
    garment: typeof item.garment === 'string' ? item.garment.trim().slice(0, 400) : '',
    wear,
    state: typeof item.state === 'string' ? item.state.trim().slice(0, 200) : '',
  };
}

export function readOutfitState(message: STMessage | undefined): OutfitFloorState | null {
  const raw = message?.extra?.[BBI_OUTFIT_EXTRA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<OutfitFloorState>;
  if (value.v !== 1 || !Array.isArray(value.entries)) return null;
  const swipe = typeof value.swipe === 'number' && Number.isInteger(value.swipe) ? value.swipe : 0;
  const entries = value.entries
    .map(normalizeEntry)
    .filter((entry): entry is OutfitStateEntry => !!entry)
    .slice(0, ENTRY_CAP);
  return { v: 1, swipe, entries };
}
