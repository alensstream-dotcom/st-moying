import { describe, expect, it } from 'vitest';
import {
  adoptStoryClothing,
  clothingAt,
  clothingCaption,
  englishDesign,
  garmentKind,
} from '@/autoTag/outfitTimeline';
import type { CharTagEntry } from '@/state/charTags';

const entry = (name: string): CharTagEntry => ({
  name,
  fields: { hair: 'black hair', eyes: 'purple eyes' } as CharTagEntry['fields'],
  raw: '',
  nl: '',
  source: 'book',
  desc: '',
  history: [],
});
const record = (pieces: Array<{ id: string; design: string; state: Record<string, string> }>) =>
  ({ name: '林晚晴', outfitId: 'probe', source: 'ai', pieces }) as unknown as Parameters<
    typeof clothingCaption
  >[0];
/** 账本状态：ClothingState 的键是规范名，值是一条 ClothingRecord。 */
type Wardrobe = Map<string, ReturnType<typeof record>>;
const wardrobe = (pieces: Array<{ id: string; design: string; state: Record<string, string> }>): Wardrobe =>
  new Map([['林晚晴', record(pieces)]]);
const asState = (state: Wardrobe) => state as unknown as Parameters<typeof clothingAt>[0];

const DAY = [
  { id: 'shirt', design: 'white shirt', state: { location: 'worn' } },
  { id: 'skirt', design: 'black skirt', state: { location: 'worn' } },
  { id: 'panties', design: 'white panties', state: { location: 'worn' } },
];

// 覆盖各时代 / 各类别的款式大表：只要有一个落不到品类，那件衣服的换装事件会被整条丢弃
// （garmentKind 空串 → 部件 ID 落 piece → patch 判「未知衣物部件」）。
const WORDS: string[] = [
  // 古代中国 / 东亚
  '汉服', '襦裙', '齐胸襦裙', '曲裾', '直裾', '深衣', '袄裙', '褙子', '明制袄裙', '宋制褙子',
  '道袍', '僧袍', '袈裟', '法衣', '巫女服', '长袍', '白袍', '罩袍', '大氅', '肚兜', '兜肚',
  '抹胸', '束胸', '小褂', '短褂', '褂子', '长衫', '旗装', '旗袍', '铠甲', '皮甲', '锁子甲',
  '板甲', '胸甲', '护甲', '和服', '浴衣', '振袖', '留袖', '羽织', '韩服', '纱丽', '奥黛', '束腰',
  // 近代 / 职业 / 制式
  '白大褂', '手术服', '护士服', '女仆装', '修女服', '军装', '警服', '空姐制服', '教师装',
  '服务生制服', '兔女郎', '啦啦队服', '水手服', '校服', '学生装', '围裙', '围裙装', '制服',
  // 礼服
  '婚纱', '晚礼服', '礼服裙', '舞会裙', '敬酒服', '礼裙', '衬裙', '裙撑',
  // 现代上装 / 外套
  '衬衫', '白衬衫', '雪纺衫', 't恤', 'T恤', '短袖', '吊带', '吊带衫', '背心', '卫衣', '连帽衫',
  '毛衣', '针织衫', '开衫', '罩衫', '线衣', '马甲', '坎肩', '西装', '皮衣', '机车夹克',
  '牛仔外套', '羽绒服', '冲锋衣', '风衣', '大衣', '外套', '夹克', '披风', '斗篷', '披肩', '雨衣',
  '棉袄', '小袄',
  // 现代下装 / 裙装
  '牛仔裤', '长牛仔裤', '直筒牛仔裤', '紧身牛仔裤', '破洞牛仔裤', '牛仔短裤', '短牛仔裤',
  '长裤', '西裤', '西装裤', '休闲裤', '运动裤', '阔腿裤', '灯笼裤', '喇叭裤', '哈伦裤', '打底裤',
  '瑜伽裤', '皮裤', '工装裤', '背带裤', '七分裤', '九分裤', '骑行裤', '马裤', '短裤', '热裤',
  '裙子', '半身裙', '长裙', '短裙', '百褶裙', '超短裙', '迷你裙', '包臀裙', '铅笔裙', '鱼尾裙',
  '伞裙', '蛋糕裙', '蓬蓬裙', '纱裙', '牛仔裙', '皮裙', '工装裙', '开衩裙', '露背裙', '连衣裙',
  '洋装', '连身裙', '裙装', '吊带裙',
  // 连体 / 内衣 / 袜 / 鞋
  '连体裤', '连身裤', '吊带裤', '乳胶衣', '胶衣', '连体紧身衣', '全身紧身衣', '紧身衣', '连体衣',
  '连身衣', '体操服', '内裤', '底裤', '亵裤', '丁字裤', '三角裤', '安全裤', '无痕内裤', '珍珠内裤',
  '开裆裤', '开裆内裤', '文胸', '胸罩', '内衣', '奶罩', '运动内衣', '吊带袜', '渔网袜', '网袜',
  '连裤袜', '丝袜', '长袜', '短袜', '袜圈', '袜', '高跟鞋', '细高跟', '长靴', '短靴', '靴子',
  '皮鞋', '运动鞋', '帆布鞋', '拖鞋', '木屐', '凉鞋', '玛丽珍',
  // 睡衣 / 泳装
  '睡衣', '睡裙', '睡袍', '浴袍', '睡衣裤', '睡裤', '家居服', '居家服', '晨衣', '吊带睡裙',
  '真丝睡裙', '泳衣', '泳装', '泳裤', '比基尼', '死库水', '连体泳衣', '竞泳泳装', '沙滩裙',
  '三角泳裤', '平角泳裤',
  // 情趣
  '情趣睡衣', '情趣内衣', '情趣套装', '情趣装', '蕾丝内衣', '镂空内衣', '网纱内衣', '半透明内衣',
  '开裆连体衣', '连体情趣', '情趣吊带', '蕾丝睡裙', '网纱睡裙', '吊袜带', '袜带', '束具',
  '皮质束具', '皮质绑带', '束带', '胸背带', '乳贴', '胸贴',
  // 英文
  'dress', 'sundress', 'gown', 'wedding dress', 'evening gown', 'shirt', 'blouse', 't-shirt',
  'skirt', 'miniskirt', 'pleated skirt', 'pencil skirt', 'pants', 'trousers', 'slacks', 'shorts',
  'jeans', 'jacket', 'blazer', 'coat', 'raincoat', 'trench coat', 'cardigan', 'sweater', 'hoodie',
  'turtleneck', 'camisole', 'tube top', 'suit', 'tuxedo', 'vest', 'waistcoat', 'bra', 'bralette',
  'sports bra', 'panties', 'underwear', 'thong', 'lingerie', 'babydoll', 'teddy', 'chemise',
  'negligee', 'bodystocking', 'garter belt', 'harness', 'pasties', 'stockings', 'thighhighs',
  'pantyhose', 'fishnets', 'socks', 'shoes', 'boots', 'heels', 'sneakers', 'sandals', 'slippers',
  'loafers', 'uniform', 'serafuku', 'labcoat', 'maid outfit', 'nurse uniform', 'cheerleader outfit',
  'bunny girl', 'nun habit', 'military uniform', 'hanfu', 'hanbok', 'sari', 'kimono', 'yukata',
  'robe', 'cheongsam', 'qipao', 'petticoat', 'crinoline', 'bustle', 'jumpsuit', 'bodysuit',
  'leotard', 'unitard', 'overalls', 'dungarees', 'swimsuit', 'swimwear', 'bikini', 'monokini',
  'tankini', 'apron', 'cloak', 'cape', 'shawl', 'scarf', 'gloves', 'belt', 'armor', 'breastplate',
  'chainmail', 'jersey', 'windbreaker', 'denim jacket', 'leather jacket', 'down jacket',
  'crotchless panties', 'crotchless bodysuit', 'boyshorts', 'boxers', 'catsuit', 'zentai',
  'pajamas', 'nightgown', 'nightdress', 'bathrobe', 'sleepwear', 'housewear', 'sarong', 'poncho',
  'trunks', 'bloomers', 'buruma', 'geta', 'mary janes', 'obi', 'hakama',
];

describe('服装词表：各时代 + 各类型都不能有空类别', () => {
  it('每个词都落到一个品类（否则该件衣服的换装事件会被整条丢弃）', () => {
    expect(WORDS.filter((word) => !garmentKind(word))).toEqual([]);
  });

  it('中文款式都能翻成英文 tag（中文进 prompt 等于没写）', () => {
    const untranslated = WORDS.filter((word) => /[\u4e00-\u9fff]/.test(word)).filter((word) =>
      /[\u4e00-\u9fff]/.test(englishDesign(word)),
    );
    expect(untranslated).toEqual([]);
  });

  it('款式词保留时代特色，不被压成通用品类', () => {
    expect(englishDesign('白色汉服')).toBe('white hanfu');
    expect(englishDesign('红色旗袍')).toBe('red cheongsam');
    expect(englishDesign('黑色和服')).toBe('black kimono');
    expect(englishDesign('白色婚纱')).toBe('white wedding dress');
    expect(englishDesign('黑色女仆装')).toBe('black maid outfit');
    expect(englishDesign('白色水手服')).toBe('white serafuku');
    expect(englishDesign('黑色蕾丝内衣')).toBe('black lingerie');
    expect(englishDesign('吊袜带')).toBe('garter belt');
    // 半身裙不能被整身词抢走
    expect(englishDesign('黑色长裙')).toBe('black skirt');
    expect(englishDesign('黑色百褶裙')).toBe('black pleated skirt');
  });
});

describe('服装词表：换装真正落账（各时代 + 情趣）', () => {
  it('古装：白衬衫换成汉服，旧上衣退出账本', () => {
    const before = wardrobe(DAY);
    const { changes } = adoptStoryClothing('林晚晴换上了一身白色汉服。', [entry('林晚晴')], asState(before));
    expect(changes).toHaveLength(1);
    expect(changes[0].operation).toBe('change');
    const after = clothingAt(asState(before), changes, 'scope');
    const caption = clothingCaption(after.get('林晚晴')!);
    expect(caption.tag).toContain('hanfu');
    expect(caption.tag).not.toContain('shirt');
  });

  it('制服：换成女仆装后画面里不再是普通连衣裙', () => {
    const before = wardrobe([{ id: 'dress', design: 'white dress', state: { location: 'worn' } }]);
    const { changes } = adoptStoryClothing('她换上了女仆装。', [entry('林晚晴')], asState(before));
    const after = clothingAt(asState(before), changes, 'scope');
    expect(clothingCaption(after.get('林晚晴')!).tag).toContain('maid outfit');
  });

  it('情趣：换上蕾丝内衣时不会被睡衣/内衣抢走', () => {
    const before = wardrobe([{ id: 'pajamas', design: 'pink pajamas', state: { location: 'worn' } }]);
    const { changes } = adoptStoryClothing('林晚晴换上了黑色蕾丝内衣。', [entry('林晚晴')], asState(before));
    expect(changes).toHaveLength(1);
    const after = clothingAt(asState(before), changes, 'scope');
    const caption = clothingCaption(after.get('林晚晴')!);
    expect(caption.tag).toContain('black lingerie');
    expect(caption.tag).not.toContain('pajamas');
  });

  it('束具类不遮挡身体：只戴袜带束具时算没穿衣服', () => {
    const state = wardrobe([
      { id: 'accessory', design: 'garter belt', state: { location: 'worn' } },
      { id: 'accessory_2', design: 'harness', state: { location: 'worn' } },
    ]);
    const caption = clothingCaption(state.get('林晚晴')!);
    expect(caption.tag).toContain('garter belt');
    expect(caption.tag).toContain('nude');
  });

  it('古代铠甲脱掉后不再出现在画面里', () => {
    const before = wardrobe([
      { id: 'shirt', design: 'black armor', state: { location: 'worn' } },
      { id: 'pants', design: 'black pants', state: { location: 'worn' } },
    ]);
    const { changes } = adoptStoryClothing(
      '林晚晴脱下了铠甲，换上了一身白色长袍。',
      [entry('林晚晴')],
      asState(before),
    );
    const after = clothingAt(asState(before), changes, 'scope');
    const caption = clothingCaption(after.get('林晚晴')!);
    expect(caption.tag).not.toContain('armor');
  });
});
