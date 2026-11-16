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