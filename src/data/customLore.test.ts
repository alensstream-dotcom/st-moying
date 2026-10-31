import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCustomPose,
  addCustomWardrobe,
  clearCustomLore,
  customPoses,
  customWardrobe,
  exportCustomLoreJson,
  importCustomLoreJson,
  removeCustomLore,
  resetCustomLoreCache,
  splitList,
} from '@/data/customLore';

const wardrobe = {
  name: '湿透白衬衫',
  tags: 'wet clothes, see-through, white shirt, clinging, bra visible',
  aliases: '湿衬衫、湿透、白衬衣',
  category: 'office',
  slot: 'top' as const,
  nsfw: 3 as const,
};

const pose = {
  name: '第一视角俯视领口',
  tags: 'pov, from above, pov cleavage, male hand, cleavage, looking up',
  aliases: '偷看、领口、俯视',
  category: 'pov' as const,
  nsfw: 2 as const,
};

beforeEach(() => {
  clearCustomLore();
  resetCustomLoreCache();
});

describe('customLore 新增', () => {
  it('服装入库后立刻出现在自定义列表里', () => {
    const result = addCustomWardrobe(wardrobe);
    expect(result.ok).toBe(true);
    expect(customWardrobe().map(item => item.name)).toEqual(['湿透白衬衫']);
    expect(result.item?.id.startsWith('u-')).toBe(true);
  });

  it('缺 tag 或中文触发词都拒绝,并给出可读原因', () => {
    expect(addCustomWardrobe({ ...wardrobe, tags: '   ' }).error).toContain('tag');
    expect(addCustomWardrobe({ ...wardrobe, aliases: '' }).error).toContain('触发词');
  });

  it('同名条目不会被重复写入', () => {
    addCustomWardrobe(wardrobe);
    const again = addCustomWardrobe(wardrobe);
    expect(again.ok).toBe(false);
    expect(again.error).toContain('同名');
    expect(customWardrobe()).toHaveLength(1);
  });

  it('未知分类会回落到制服类而不是报错', () => {
    const result = addCustomWardrobe({ ...wardrobe, name: '奇怪衣服', category: 'not-a-category' });
    expect(result.ok).toBe(true);
    expect(result.item?.category).toBe('costume');
  });

  it('姿势必须落在已知分类里', () => {
    expect(addCustomPose(pose).ok).toBe(true);
    expect(customPoses()[0].category).toBe('pov');
    expect(addCustomPose({ ...pose, name: '瞎写的姿势', category: 'nope' as never }).ok).toBe(false);
  });
});

describe('customLore 删除与导入导出', () => {
  it('删除只影响指定的那一条', () => {
    addCustomWardrobe(wardrobe);
    addCustomWardrobe({ ...wardrobe, name: '第二件', aliases: '第二' });
    const target = customWardrobe()[0];
    expect(removeCustomLore('wardrobe', target.id)).toBe(true);
    expect(customWardrobe().map(item => item.name)).toEqual(['第二件']);
    expect(removeCustomLore('wardrobe', 'not-exist')).toBe(false);
  });

  it('导出的 JSON 能原样导回来', () => {
    addCustomWardrobe(wardrobe);
    addCustomPose(pose);
    const json = exportCustomLoreJson();
    clearCustomLore();
    resetCustomLoreCache();
    const report = importCustomLoreJson(json);
    expect(report.error).toBeUndefined();
    expect(report.wardrobe).toBe(1);
    expect(report.poses).toBe(1);
    expect(customWardrobe()[0].name).toBe('湿透白衬衫');
    expect(customPoses()[0].category).toBe('pov');
  });

  it('裸数组按 category 自动分流到服装或姿势', () => {
    const report = importCustomLoreJson(
      JSON.stringify([
        { name: '胶衣', tags: 'latex, bodysuit, shiny', aliases: '胶衣', category: 'lingerie', slot: 'full' },
        { name: '抬腿压墙', tags: 'standing sex, leg up, against wall', aliases: '压墙,抬腿', category: 'standing' },
      ]),
    );
    expect(report.wardrobe).toBe(1);
    expect(report.poses).toBe(1);
    expect(customWardrobe()[0].name).toBe('胶衣');
    expect(customPoses()[0].name).toBe('抬腿压墙');
  });

  it('坏条目只跳过,不整体失败', () => {
    const report = importCustomLoreJson(
      JSON.stringify({ wardrobe: [{ name: '', tags: 'x' }, { name: '缺触发词', tags: 'leotard, highleg', aliases: '' }] }),
    );
    expect(report.wardrobe).toBe(0);
    expect(report.poses).toBe(0);
    expect(report.error).toBeUndefined();
  });

  it('完全不是 JSON 时给出错误而不是抛出', () => {
    expect(importCustomLoreJson('这不是 json').error).toBeTruthy();
  });
});

describe('splitList', () => {
  it('逗号、全角逗号、顿号、竖线、换行都认', () => {
    expect(splitList('黑丝，白丝、灰丝|肉丝\n渔网')).toEqual(['黑丝', '白丝', '灰丝', '肉丝', '渔网']);
  });
});
