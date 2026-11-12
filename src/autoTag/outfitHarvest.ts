import { extractGarment } from '@/autoTag/outfitState';
import type { WardrobeSlot } from '@/data/loreTypes';
import { SUIT_CATEGORIES } from '@/data/materialLibrary';

/**
 * 从一张已经出好的图里把衣服"扒"出来,整理成可以存进新衣橱的条目。
 *
 * 为什么要从图里扒、而不是从正文扒:用户看中的是**这张图实际画出来的那套**,
 * 正文描述往往更粗。图片的 tag 里已经带着版型、颜色、部件,直接复用就能保留
 * 那份"指纹";从正文重新生成等于二次翻译,好看的细节就丢了。
 *
 * 只做纯字符串整理,不发请求、不写库——调用方拿到结果给用户改,确认后再保存。
 */

export interface HarvestedOutfit {
  name: string;
  tags: string;
  slot: WardrobeSlot;
  category: string;
  era: 'ancient' | 'modern' | 'fantasy' | 'any';
  /** 参与提取的角色名(给用户看"这是谁身上那套")。 */
  wearer: string;
  /** 提取到几件衣物部件;0 表示这张图几乎没有可存的衣服。 */
  pieces: number;
}

/** 古风/奇幻衣物词,只用来猜分类,猜错用户自己改。 */
const ANCIENT_RE = /(?:hanfu|chinese clothes|kimono|yukata|dress robes?|qipao|cheongsam|sash|dudou|wide sleeves)/i;
const FANTASY_RE = /(?:armor|plate|mail|robe|cape|cloak|witch|sorcer|elf|fantasy|circlet|tiara)/i;

/** 按衣物词猜一个槽位。只在提取到的部件全都同一类时给具体槽位,否则整身。 */
function slotOf(tags: string): WardrobeSlot {
  const has = (re: RegExp) => re.test(tags);
  const upper = /(?:shirt|blouse|top|sweater|jacket|blazer|coat|camisole|corset|tunic)\b/i.test(tags);
  const lower = /(?:skirt|pants|trousers|shorts|jeans)\b/i.test(tags);
  if (has(/\b(?:panties|briefs|knickers|bra|bralette)\b/i) && !upper && !lower) return 'underwear';
  if (has(/\b(?:pantyhose|stockings|thighhighs|socks|garter)\b/i) && !upper && !lower) return 'hosiery';
  if (has(/\b(?:shoes|heels|boots|sandals|loafers)\b/i) && !upper && !lower) return 'shoes';
  if (has(/\b(?:hat|hairpin|earrings|necklace|choker|glasses|ribbon|hairband)\b/i) && !upper && !lower)
    return 'accessory';
  if (upper && !lower) return 'top';
  if (lower && !upper) return 'bottom';
  return 'full';
}

function categoryOf(tags: string, slot: WardrobeSlot): string {
  if (ANCIENT_RE.test(tags)) return 'eastern';
  if (FANTASY_RE.test(tags)) return 'fantasy';
  if (slot === 'underwear') return 'lingerie';
  if (slot === 'hosiery' || slot === 'shoes' || slot === 'accessory') return 'hosiery';
  if (/\b(?:swimsuit|bikini|one-piece swimsuit)\b/i.test(tags)) return 'swim';
  if (/\b(?:school|serafuku|sailor|blazer)\b/i.test(tags)) return 'campus';
  if (/\b(?:office|business|suit|pencil skirt)\b/i.test(tags)) return 'office';
  if (/\b(?:nightgown|pajamas|negligee|sleepwear)\b/i.test(tags)) return 'home';
  if (/\b(?:dress|gown|evening)\b/i.test(tags)) return 'dress';
  return 'casual';
}

/**
 * 从一张图的提示词里整理出可保存的服装条目。
 *
 * @param image 该图的提示词内容(tag 与 characters[].tag 都会被扫)。
 * @param fallbackName 用户可读的默认名字,通常是"某某的这身"。
 */
export function harvestOutfit(
  image: { tag?: string; characters?: Array<{ name?: string; tag?: string }> },
  fallbackName = '这张图的服装',
): HarvestedOutfit {
  const cast = image.characters ?? [];
  // 角色块优先:那里才是"她身上那套";base tag 里常混着场景与道具。
  const perCharacter = cast.map((c) => ({ name: (c.name ?? '').trim(), tags: extractGarment(c.tag ?? '') }));
  const fromCast = perCharacter.filter((c) => c.tags);
  const tags = fromCast.length
    ? [...new Set(fromCast.flatMap((c) => c.tags.split(', ')).filter(Boolean))].join(', ')
    : extractGarment(image.tag ?? '');
  const pieces = tags ? tags.split(', ').filter(Boolean).length : 0;
  const slot = slotOf(tags);
  const wearer = fromCast[0]?.name ?? '';
  const name = wearer ? `${wearer} · 这身` : fallbackName;
  const era = ANCIENT_RE.test(tags) ? 'ancient' : FANTASY_RE.test(tags) ? 'fantasy' : 'modern';
  const category = categoryOf(tags, slot);
  return {
    name,
    tags,
    slot,
    category: SUIT_CATEGORIES.some((c) => c[0] === category) ? category : 'casual',
    era,
    wearer,
    pieces,
  };
}
