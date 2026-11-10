import vocabulary from './clothingVocabulary.json';
import type { WardrobeItem, WardrobeSlot } from './loreTypes';

export const MATERIAL_KEY = 'moying_material_library_v2';
export const CLOTHING_SOURCE = 'https://github.com/DominikDoom/a1111-sd-webui-tagcomplete';
export const clothingWords = Object.keys(vocabulary);
const known = new Set(clothingWords);
const EXTRA_WORDS = 'moying_clothing_words_v2';
function validWord(word: unknown): word is string {
  return (
    typeof word === 'string' &&
    word.length > 0 &&
    word.length <= 80 &&
    /^[a-z][a-z -]*$/.test(word) &&
    word.split(' ').length <= 6 &&
    !/\b(?:hair|eyes|skin|girl|boy|breasts|quality|masterpiece|portrait|standing|looking|removed|wet|torn|lifted|unbuttoned|unzipped|lowered|pulled|holding|open|nude|topless|bottomless)\b/.test(
      word,
    )
  );
}
try {
  const own: unknown = JSON.parse(localStorage.getItem(EXTRA_WORDS) || '[]');
  const saved = JSON.parse(localStorage.getItem(MATERIAL_KEY) || 'null')?.words;
  const words: unknown = [...(Array.isArray(own) ? own : []), ...(Array.isArray(saved) ? saved : [])];
  if (Array.isArray(words))
    for (const word of words.filter(validWord)) {
      if (!known.has(word)) {
        known.add(word);
        clothingWords.push(word);
      }
    }
} catch {}
/** Explicit user confirmation in NAI's own tag suggestions; never label these as official validation. */
export function confirmClothingWords(words: string[]) {
  if (!words.length || words.some((word) => !validWord(word)))
    throw new Error('只能补入独立英文衣物标签；外貌、状态、画风和长句请移除');
  const extra = [...new Set([...clothingWords.filter((w) => !Object.hasOwn(vocabulary, w)), ...words])];
  if (extra.length > 2000) throw new Error('个人补充词已达 2000 条');
  localStorage.setItem(EXTRA_WORDS, JSON.stringify(extra));
  for (const word of extra)
    if (!known.has(word)) {
      known.add(word);
      clothingWords.push(word);
    }
}
export function inspectClothing(value: string) {
  const tags = [
    ...new Set(
      value
        .split(/[,，\n]+/)
        .map((t) => t.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' '))
        .filter(Boolean),
    ),
  ];
  return { tags: tags.join(', '), unknown: tags.filter((t) => !known.has(t)) };
}
export interface SuitMaterial extends WardrobeItem {
  era: 'ancient' | 'modern' | 'fantasy' | 'any';
  automatic: boolean;
  origin: string;
}
export const SUIT_CATEGORIES = [
  ['eastern', '古风与仙侠'],
  ['fantasy', '西式奇幻'],
  ['casual', '现代日常'],
  ['campus', '校园制服'],
  ['office', '职业装'],
  ['dress', '裙装礼服'],
  ['home', '家居睡衣'],
  ['swim', '泳装'],
  ['lingerie', '内搭'],
  ['hosiery', '鞋袜配饰'],
  ['costume', '其他'],
] as const;
const definitions: Array<[string, string, SuitMaterial['era'], string, string, WardrobeSlot?]> = [
  [
    '素白宽袖汉服',
    'eastern',
    'ancient',
    '汉服,仙侠,修仙,白衣,古装',
    'chinese clothes, hanfu, wide sleeves, long sleeves, white dress, sash',
  ],
  [
    '青蓝宽袖长衣',
    'eastern',
    'ancient',
    '青衣,蓝衣,汉服,古装,仙侠',
    'chinese clothes, hanfu, wide sleeves, long sleeves, blue dress, sash',
  ],
  [
    '朱红宽袖长衣',
    'eastern',
    'ancient',
    '红衣,红色汉服,古装,仙侠',
    'chinese clothes, hanfu, wide sleeves, long sleeves, red dress, sash',
  ],
  [
    '墨色古风长衣',
    'eastern',
    'ancient',
    '黑衣,墨衣,汉服,古装',
    'chinese clothes, hanfu, long sleeves, black dress, sash',
  ],
  [
    '绿衣宽袖',
    'eastern',
    'ancient',
    '绿衣,绿色汉服,古装',
    'chinese clothes, hanfu, wide sleeves, green dress, sash',
  ],
  [
    '粉色宽袖长衣',
    'eastern',
    'ancient',
    '粉衣,汉服,古装',
    'chinese clothes, hanfu, wide sleeves, pink dress, sash',
  ],
  [
    '绣花古风长裙',
    'eastern',
    'ancient',
    '绣花,刺绣,汉服,古装',
    'chinese clothes, hanfu, long sleeves, white dress, embroidery, sash',
  ],
  [
    '蓝色花纹和服',
    'eastern',
    'ancient',
    '和服,蓝色和服',
    'japanese clothes, kimono, blue kimono, floral print, obi',
  ],
  [
    '红色花纹和服',
    'eastern',
    'ancient',
    '和服,红色和服',
    'japanese clothes, kimono, red kimono, floral print, obi',
  ],
  ['夏日浴衣', 'eastern', 'ancient', '浴衣,夏日祭', 'japanese clothes, yukata, floral print, obi'],
  [
    '轻甲与披风',
    'fantasy',
    'fantasy',
    '女骑士,铠甲,轻甲,西式奇幻',
    'armor, shoulder armor, gauntlets, greaves, cape, boots',
  ],
  ['兜帽斗篷长裙', 'fantasy', 'fantasy', '斗篷,法师,魔女,西式奇幻', 'hooded cloak, long dress, boots'],
  [
    '白衬衫深色长裙',
    'casual',
    'modern',
    '白衬衫,长裙,日常',
    'white shirt, collared shirt, long sleeves, black skirt, long skirt, loafers',
  ],
  ['衬衫与牛仔裤', 'casual', 'modern', '衬衫,牛仔裤,日常', 'white shirt, short sleeves, jeans, sneakers'],
  [
    '针织衫与百褶裙',
    'casual',
    'modern',
    '针织衫,毛衣,百褶裙',
    'white sweater, long sleeves, blue skirt, pleated skirt, loafers',
  ],
  ['连帽衫与短裤', 'casual', 'modern', '连帽衫,卫衣,短裤', 'hoodie, long sleeves, denim shorts, sneakers'],
  ['风衣与长裤', 'casual', 'modern', '风衣,长裤', 'trench coat, white shirt, black pants, boots'],
  [
    '水手服与过膝袜',
    'campus',
    'modern',
    '水手服,校服,JK',
    'school uniform, serafuku, sailor collar, white shirt, blue skirt, pleated skirt, black thighhighs, loafers',
  ],
  [
    '西装校服',
    'campus',
    'modern',
    '西装校服,校服,JK',
    'school uniform, blazer, white shirt, red necktie, plaid skirt, kneehighs, loafers',
  ],
  [
    '夏季短袖制服',
    'campus',
    'modern',
    '夏季校服,短袖制服',
    'school uniform, white shirt, short sleeves, neckerchief, blue skirt, pleated skirt, socks, loafers',
  ],
  [
    '黑色职业套装',
    'office',
    'modern',
    '西装,职业装,办公',
    'black suit, white shirt, pencil skirt, black pantyhose, high heels',
  ],
  [
    '衬衫与包臀裙',
    'office',
    'modern',
    '职业装,白衬衫,包臀裙',
    'white shirt, collared shirt, pencil skirt, black skirt, black pantyhose, high heels',
  ],
  ['围裙家务装', 'home', 'modern', '围裙,家务', 'white shirt, long skirt, apron'],
  ['棉质睡衣', 'home', 'modern', '睡衣,家居服', 'pajamas, long sleeves'],
  ['白色睡裙', 'home', 'modern', '睡裙,睡衣', 'nightgown, white dress, frills'],
  [
    '黑色晚礼裙',
    'dress',
    'modern',
    '晚礼服,礼服,黑裙',
    'black dress, long dress, sleeveless dress, high heels',
  ],
  ['红色露肩裙', 'dress', 'modern', '红裙,礼服,露肩裙', 'red dress, off-shoulder dress, high heels'],
  [
    '白色荷叶边裙',
    'dress',
    'modern',
    '白裙,连衣裙,荷叶边',
    'white dress, frilled dress, short sleeves, sandals',
  ],
  ['蓝色无袖连衣裙', 'dress', 'modern', '蓝裙,连衣裙', 'blue dress, sleeveless dress, sandals'],
  ['黑色连体泳衣', 'swim', 'modern', '泳衣,连体泳衣', 'one-piece swimsuit'],
  ['蓝色比基尼', 'swim', 'modern', '泳装,比基尼', 'blue bikini, bikini'],
  ['黑色内搭', 'lingerie', 'modern', '黑色内衣,内衣', 'black bra, black panties', 'underwear'],
  ['白色内搭', 'lingerie', 'modern', '白色内衣,内衣', 'white bra, white panties', 'underwear'],
  ['黑色连裤袜', 'hosiery', 'any', '黑丝,连裤袜', 'black pantyhose', 'hosiery'],
  ['白色过膝袜', 'hosiery', 'any', '白丝,过膝袜', 'white thighhighs', 'hosiery'],
  ['黑色过膝袜', 'hosiery', 'any', '黑丝,过膝袜', 'black thighhighs', 'hosiery'],
  ['棕色乐福鞋', 'hosiery', 'modern', '乐福鞋,棕色皮鞋', 'loafers, brown footwear', 'shoes'],
  ['红色围巾', 'hosiery', 'any', '红围巾,围巾', 'red scarf', 'accessory'],
];
export const BUILTIN_SUITS: SuitMaterial[] = definitions.map(([name, category, era, aliases, tags, slot]) => {
  const checked = inspectClothing(tags);
  if (checked.unknown.length) throw new Error(`衣橱内置标签未收录：${checked.unknown.join(', ')}`);
  return {
    id: `closet-${name}`,
    name,
    category,
    era,
    tags: checked.tags,
    aliases: aliases.split(','),
    nsfw: ['swim', 'lingerie'].includes(category) ? 1 : 0,
    slot: slot ?? 'full',
    automatic: true,
    quality: 4,
    origin: CLOTHING_SOURCE,
    note: '常用独立标签组合；款式固定不代表像素级复现，穿脱状态由楼层账本管理。',
  };
});
export interface MaterialStore {
  version: 2;
  suits: SuitMaterial[];
  legacy?: string;
  words?: string[];
}
function store(): MaterialStore {
  try {
    const data = JSON.parse(localStorage.getItem(MATERIAL_KEY) || 'null');
    if (data?.version === 2 && Array.isArray(data.suits)) return data;
  } catch {}
  return { version: 2, suits: [] };
}
export function archiveLegacyMaterials() {
  const value = store();
  if (value.legacy !== undefined) return;
  value.legacy = localStorage.getItem('moying_image_custom_lore') || '';
  localStorage.setItem(MATERIAL_KEY, JSON.stringify(value));
}
export function legacyMaterials(): { name: string; tags: string }[] {
  try {
    return JSON.parse(store().legacy || '{}').wardrobe || [];
  } catch {
    return [];
  }
}
export function savedSuits(): SuitMaterial[] {
  return store().suits.filter(
    (s) => s && typeof s.tags === 'string' && !inspectClothing(s.tags).unknown.length,
  );
}
export function suitLibrary(): SuitMaterial[] {
  return [...BUILTIN_SUITS, ...savedSuits()];
}
export function saveSuit(input: Omit<SuitMaterial, 'id'>, id?: string): SuitMaterial {
  const result = inspectClothing(input.tags);
  if (!input.name.trim() || !result.tags) throw new Error('请填写套装名称和服装标签');
  if (result.unknown.length)
    throw new Error(`这些词未在衣橱词表收录，请替换或删去：${result.unknown.join(', ')}`);
  const data = store();
  const item = {
    ...input,
    name: input.name.trim(),
    tags: result.tags,
    id: id || 'closet-user-' + crypto.randomUUID(),
  };
  const index = data.suits.findIndex((s) => s.id === item.id);
  if (index < 0) {
    if (data.suits.length >= 600) throw new Error('衣橱已达 600 套上限');
    data.suits.push(item);
  } else data.suits[index] = item;
  localStorage.setItem(MATERIAL_KEY, JSON.stringify(data));
  return item;
}
export function deleteSuit(id: string) {
  const data = store();
  data.suits = data.suits.filter((s) => s.id !== id);
  localStorage.setItem(MATERIAL_KEY, JSON.stringify(data));
}
export function exportMaterials() {
  return JSON.stringify(
    { ...store(), words: clothingWords.filter((w) => !Object.hasOwn(vocabulary, w)) },
    null,
    2,
  );
}
export function importMaterials(json: string) {
  const value = JSON.parse(json);
  if (value?.version !== 2 || !Array.isArray(value.suits)) throw new Error('请选择新版衣橱备份');
  if (value.suits.length > 600) throw new Error('导入文件超过 600 套');
  const extra: unknown = value.words ?? [];
  if (!Array.isArray(extra) || extra.length > 2000 || !extra.every(validWord))
    throw new Error('备份中的个人衣物词格式不正确');
  const incomingKnown = new Set([...known, ...extra]);
  const next = store(),
    ids = new Set(next.suits.map((s) => s.id));
  // Validate everything before writing anything.
  const incoming = value.suits.map((s: SuitMaterial) => {
    if (
      typeof s?.id !== 'string' ||
      !s.id.startsWith('closet-user-') ||
      typeof s.name !== 'string' ||
      !s.name.trim() ||
      s.name.length > 120 ||
      typeof s.tags !== 'string' ||
      !s.tags.trim() ||
      s.tags.length > 6000 ||
      !Array.isArray(s.aliases) ||
      !s.aliases.every((a) => typeof a === 'string') ||
      !SUIT_CATEGORIES.some((c) => c[0] === s.category) ||
      !['ancient', 'modern', 'fantasy', 'any'].includes(s.era) ||
      !['full', 'top', 'bottom', 'underwear', 'hosiery', 'shoes', 'accessory'].includes(s.slot) ||
      inspectClothing(s.tags)
        .tags.split(', ')
        .some((t) => !incomingKnown.has(t))
    )
      throw new Error('备份含有无效套装，未导入');
    return {
      ...s,
      tags: inspectClothing(s.tags).tags,
      automatic: s.automatic === true,
      nsfw: Math.max(0, Math.min(3, Number(s.nsfw) || 0)),
    };
  });
  for (const item of incoming)
    if (!ids.has(item.id)) {
      next.suits.push(item);
      ids.add(item.id);
    }
  if (next.suits.length > 600) throw new Error('合并后超过 600 套');
  next.words = [...incomingKnown].filter((w) => !Object.hasOwn(vocabulary, w));
  if (next.words.length > 2000) throw new Error('合并后个人衣物词超过 2000 条');
  localStorage.setItem(MATERIAL_KEY, JSON.stringify(next));
  for (const word of extra)
    if (!known.has(word)) {
      known.add(word);
      clothingWords.push(word);
    }
}
