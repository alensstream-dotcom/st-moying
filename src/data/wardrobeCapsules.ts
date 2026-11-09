import type { WardrobeItem } from './loreTypes';
// Complete coherent palettes, not independent random adjectives on each generation.
const colors = [
  ['月白', 'white', 'pale blue'],
  ['黛青', 'navy blue', 'white'],
  ['绯红', 'red', 'black'],
  ['竹绿', 'dark green', 'ivory'],
  ['藕紫', 'light purple', 'white'],
  ['墨金', 'black', 'gold'],
  ['杏黄', 'light yellow', 'brown'],
  ['霜蓝', 'light blue', 'silver'],
];
const designs = [
  ['交领长袍', 'hanfu, cross collar, long robe, long sleeves, sash', '交领,长袍,仙侠,宗门,古风'],
  ['大袖绣衣', 'hanfu, wide sleeves, long skirt, embroidered trim, silk, sash', '大袖,绣衣,仙侠,古装,长裙'],
  [
    '修行便装',
    'chinese clothes, long sleeved tunic, loose trousers, cloth belt, cloth shoes',
    '修行服,练功服,道服,仙侠,武侠',
  ],
  [
    '薄纱披帛裙',
    'hanfu, layered long skirt, silk, translucent shawl, ribbon sash',
    '披帛,薄纱,襦裙,仙侠,古风',
  ],
  ['侠客披风', 'chinese clothes, long robe, short cape, cloth belt, boots', '侠客,披风,武侠,剑客,仙侠'],
  [
    '窄袖骑装',
    'chinese clothes, fitted tunic, narrow sleeves, trousers, leather belt, boots',
    '骑装,窄袖,古装,武侠,女侠',
  ],
  [
    '宽袖内搭裙',
    'hanfu, wrap top, long skirt, loose sleeves, cotton, cloth sash',
    '居家,寝衣,古风,棉布,仙侠',
  ],
  [
    '仪典层叠袍',
    'hanfu, layered robes, long sleeves, embroidered border, silk, wide sash',
    '礼服,仪典,宗门,仙侠,古装',
  ],
] as const;
export const WARDROBE_CAPSULES: WardrobeItem[] = designs.flatMap(([name, tags, aliases], i) =>
  colors.map(([label, main, accent], j) => ({
    id: `capsule-${i}-${j}`,
    name: label + name,
    category: 'costume',
    slot: 'full',
    tags: `${tags}, ${main} clothes, ${accent} sash`,
    aliases: [label + name, ...aliases.split(',')],
    nsfw: 0,
    quality: 4,
    note: '整套固定配色与版型；可组合配饰，不应逐楼重新随机配色',
  })),
);
