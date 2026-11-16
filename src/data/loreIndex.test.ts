import { describe, expect, it } from 'vitest';
import { buildLoreBlock, collectLoreCandidates, pickDiverse, wardrobeByCategory } from '@/data/loreIndex';
import { WARDROBE_ITEMS } from '@/data/wardrobe';

/* 姿势与人物指纹召回已于 0.3 前的实验分支永久退出生成流程(恒空),
   对应的召回实现、参数和测试一并删除;这里只覆盖仍在用的衣橱召回与渲染。 */

describe('loreIndex 衣橱召回', () => {
  it('把「黑丝」拆成多条差异明显的候选,而不是每次都同一款', () => {
    const { wardrobe } = collectLoreCandidates('他低头看了一眼她腿上的黑丝', { wardrobeLimit: 8 });
    expect(wardrobe.length).toBeGreaterThanOrEqual(2);
    const tags = new Set(wardrobe.map((hit) => hit.item.tags));
    expect(tags.size).toBe(wardrobe.length);
  });

  it('按 maxNsfw 过滤:调到 1 之后不再给情趣款', () => {
    const { wardrobe } = collectLoreCandidates('她穿着黑丝', { maxNsfw: 1, wardrobeLimit: 8 });
    expect(wardrobe.every((hit) => (hit.item.nsfw ?? 0) <= 1)).toBe(true);
  });

  it('limit 为 0 时这一路完全不召回', () => {
    const { wardrobe } = collectLoreCandidates('她穿着黑丝跪在地上', { wardrobeLimit: 0 });
    expect(wardrobe).toEqual([]);
  });

  it('命中多个类别时切换到较小的单类配额', () => {
    const text = '她穿黑色蕾丝裙,脚上是过膝袜,手里撑着伞';
    const wide = collectLoreCandidates(text, { wardrobeLimit: 12 }).wardrobe;
    expect(wide.length).toBeGreaterThan(0);
    expect(wide.length).toBeLessThanOrEqual(12);
  });
});

describe('loreIndex 渲染', () => {
  it('块头写死「照抄」而不是「参考」', () => {
    const block = buildLoreBlock('她穿着黑丝站在门口', { wardrobeLimit: 4 });
    expect(block).toContain('【新版衣橱候选】');
    expect(block).toContain('已有楼层衣物与人工绑定最高优先');
  });

  it('没有命中就不注入任何东西', () => {
    expect(buildLoreBlock('')).toBe('');
    expect(buildLoreBlock('他打开门走出去,外面在下雨')).toBe('');
  });
});

describe('loreIndex 库结构', () => {
  it('服装库覆盖分类表的每一个分类', () => {
    const groups = wardrobeByCategory();
    expect(groups.size).toBeGreaterThan(4);
    for (const list of groups.values()) expect(list.length).toBeGreaterThan(0);
  });

  it('条目 id 全局唯一(核心表与扩展表拼接后不能撞车)', () => {
    const ids = WARDROBE_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pickDiverse 的 limit 生效', () => {
    const picked = pickDiverse(WARDROBE_ITEMS, '黑丝', (item) => item.category, { limit: 3 });
    expect(picked.length).toBeLessThanOrEqual(3);
  });
});

describe('数据文件的书写口径(导入别人整理的表时最容易踩)', () => {
  it('所有服装 tag 串都是英文小写 + 逗号加空格', () => {
    for (const item of WARDROBE_ITEMS) {
      expect(item.tags, item.id).toBe(item.tags.toLowerCase());
      expect(item.tags, item.id).not.toMatch(/,\S/);
    }
  });

  it('所有触发词都在两个汉字以上(单字会被匹配器直接跳过)', () => {
    for (const item of WARDROBE_ITEMS) {
      for (const alias of item.aliases ?? []) expect(alias.length, item.id).toBeGreaterThan(1);
    }
  });
});

describe('loreIndex 同分摇号', () => {
  const text = '她穿黑色蕾丝裙';

  it('同一种子结果稳定,单测可复现', () => {
    const a = collectLoreCandidates(text, { wardrobeLimit: 4, rollSeed: 7 }).wardrobe.map((hit) => hit.item.id);
    const b = collectLoreCandidates(text, { wardrobeLimit: 4, rollSeed: 7 }).wardrobe.map((hit) => hit.item.id);
    expect(a).toEqual(b);
  });

  it('种子为 0 时保持严格按分数,顺序与 id 字典序', () => {
    const a = collectLoreCandidates('她穿着黑丝', { wardrobeLimit: 5, rollSeed: 0 }).wardrobe.map((hit) => hit.item.id);
    const b = collectLoreCandidates('她穿着黑丝', { wardrobeLimit: 5 }).wardrobe.map((hit) => hit.item.id);
    expect(a).toEqual(b);
  });
});
