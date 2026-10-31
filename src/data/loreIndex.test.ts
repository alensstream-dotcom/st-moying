import { describe, expect, it } from 'vitest';
import { WARDROBE_CATEGORIES, WARDROBE_ITEMS } from '@/data/wardrobe';
import { POSE_CATEGORIES, POSE_ITEMS } from '@/data/poseBank';
import { buildLoreBlock, collectLoreCandidates, pickDiverse, wardrobeByCategory } from '@/data/loreIndex';

describe('loreIndex 服装召回', () => {
  it('把「黑丝」拆成多条差异明显的候选,而不是每次都同一款', () => {
    const { wardrobe } = collectLoreCandidates('他低头看了一眼她腿上的黑丝', { wardrobeLimit: 8 });
    expect(wardrobe.length).toBeGreaterThanOrEqual(5);
    // 全部落在袜类,且互不重复 —— 同一条候选重复出现等于没扩容。
    expect(wardrobe.every(hit => hit.category === 'hosiery')).toBe(true);
    expect(new Set(wardrobe.map(hit => hit.item.id)).size).toBe(wardrobe.length);
  });

  it('库内以「黑丝」直接触发词收录的款式足够多', () => {
    const black = WARDROBE_ITEMS.filter(item => item.aliases.includes('黑丝'));
    // 13 条:透肉/半透/不透/亮面/哑光/竖条/蕾丝/后缝线/渔网/吊带/破洞/单腿/开裆。
    expect(black.length).toBeGreaterThanOrEqual(12);
    // 至少覆盖「透肉 / 不透 / 亮面 / 花纹 / 结构」五类画面上可分辨的差异。
    const tags = black.map(item => item.tags).join(' | ');
    expect(tags).toMatch(/sheer/);
    expect(tags).toMatch(/opaque|matte/);
    expect(tags).toMatch(/glossy|shine/);
    expect(tags).toMatch(/lace|striped|seam|pattern/);
  });

  it('按 maxNsfw 过滤:调到 1 之后不再给情趣款', () => {
    const { wardrobe } = collectLoreCandidates('她穿着黑丝', { maxNsfw: 1, wardrobeLimit: 8 });
    expect(wardrobe.length).toBeGreaterThan(0);
    expect(wardrobe.every(hit => hit.item.nsfw <= 1)).toBe(true);
  });

  it('limit 为 0 时这一路完全不召回', () => {
    const { wardrobe, poses } = collectLoreCandidates('她穿着黑丝跪在地上', {
      wardrobeLimit: 0,
      poseLimit: 0,
    });
    expect(wardrobe).toEqual([]);
    expect(poses).toEqual([]);
  });

  it('命中多个类别时切换到较小的单类配额', () => {
    const text = '她穿着水手服和黑丝,怀里抱着一只猫';
    const { wardrobe } = collectLoreCandidates(text, { wardrobeLimit: 12 });
    const byCategory = new Map<string, number>();
    for (const hit of wardrobe) byCategory.set(hit.category, (byCategory.get(hit.category) ?? 0) + 1);
    expect(byCategory.size).toBeGreaterThan(1);
    for (const count of byCategory.values()) expect(count).toBeLessThanOrEqual(3);
  });
});

describe('loreIndex 姿势召回', () => {
  it('「后入」召回到后位类,且带上机位', () => {
    const { poses } = collectLoreCandidates('他让她跪趴下来,后入的姿势', { wardrobeLimit: 0, poseLimit: 6 });
    expect(poses.length).toBeGreaterThan(0);
    expect(poses.every(hit => hit.category === 'rear')).toBe(true);
    expect(poses.some(hit => Boolean(hit.item.camera))).toBe(true);
  });

  it('姿势库每类条数均衡,不出现某一类独大', () => {
    expect(POSE_ITEMS.length).toBe(84);
    for (const category of POSE_CATEGORIES) {
      const count = POSE_ITEMS.filter(item => item.category === category.id).length;
      expect(count).toBe(6);
    }
  });
});

describe('loreIndex 人物外貌召回', () => {
  it('默认不召回人物指纹', () => {
    const { faces } = collectLoreCandidates('她一张清冷的脸,眼尾上挑');
    expect(faces).toEqual([]);
  });

  it('打开 faces 后把外形词召回到脸型/体型/同人三类之一', () => {
    const { faces } = collectLoreCandidates('她一张清冷的脸,眼尾上挑', {
      wardrobeLimit: 0,
      poseLimit: 0,
      faces: true,
    });
    expect(faces.length).toBeGreaterThan(0);
    for (const hit of faces) {
      expect(['face', 'body', 'fandom']).toContain(hit.category);
    }
  });

  it('人物候选块单独渲染,不与服装块混在一起', () => {
    const block = buildLoreBlock('她一张清冷的脸', { wardrobeLimit: 0, poseLimit: 0, faces: true });
    expect(block).toContain('【人物外貌候选库】');
    expect(block).not.toContain('【服装候选库】');
  });
});

describe('loreIndex 渲染', () => {
  it('块头写死「照抄」而不是「参考」', () => {
    const block = buildLoreBlock('她把吊带袜的扣子扣好', { wardrobeLimit: 4 });
    expect(block).toContain('【服装候选库】');
    expect(block).toContain('原样照抄');
    expect(block).toContain('不许换成更泛的词');
  });

  it('没有命中就不注入任何东西', () => {
    expect(buildLoreBlock('')).toBe('');
    expect(buildLoreBlock('他打开门走出去,外面在下雨')).toBe('');
  });

  it('服装与姿势同时命中时两块都在', () => {
    const block = buildLoreBlock('她穿着水手服跪在地上,后入', { wardrobeLimit: 4, poseLimit: 4 });
    expect(block).toContain('【服装候选库】');
    expect(block).toContain('【姿势与机位候选库】');
  });
});

describe('loreIndex 库结构', () => {
  it('服装库覆盖分类表的每一个分类', () => {
    const grouped = wardrobeByCategory();
    expect(new Set(grouped.keys())).toEqual(new Set(WARDROBE_CATEGORIES.map(category => category.id)));
    expect(WARDROBE_ITEMS.length).toBeGreaterThanOrEqual(300);
  });

  it('条目 id 全局唯一(核心表与扩展表拼接后不能撞车)', () => {
    const ids = WARDROBE_ITEMS.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pickDiverse 的 limit 生效', () => {
    const picked = pickDiverse(WARDROBE_ITEMS, '黑丝 吊带袜 旗袍 女仆', item => item.category, { limit: 3 });
    expect(picked.length).toBeLessThanOrEqual(3);
  });
});
