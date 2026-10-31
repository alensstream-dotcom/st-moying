import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCustomPose,
  addCustomWardrobe,
  clearCustomLore,
  customPoses,
  customWardrobe,
  exportCustomLoreJson,
  guessWardrobeCategory,
  guessWardrobeSlot,
  importCustomLoreJson,
  parseTagBundle,
  removeCustomLore,
  resetCustomLoreCache,
  splitList,
  updateCustomPose,
  updateCustomWardrobe,
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

describe('parseTagBundle（网上分享的 tag 串）', () => {
  const shared =
    'champagne_tulle_gown（香槟色薄纱晚礼服）, halter_neckline（挂脖领口）, beaded_lace_bodice（珠绣蕾丝上身）, ' +
    'illusion_neckline_detail（透视领口细节）, chest_cutout（胸部镂空）, side_hip_cutout（侧臀镂空）, ' +
    'transparent_waist_panel（腰部透明拼接）, sequin_embroidery（亮片刺绣）, crystal_embellishment（水晶装饰）, ' +
    'layered_tulle_skirt（多层薄纱裙摆）, floor_length_hem（落地裙长）, open_back（露背）, ' +
    'concealed_zipper（隐形拉链）, metallic_high_heels（金属色高跟鞋）';

  it('英文 tag 与中文说明分别归位，名称取第一个中文说明', () => {
    const draft = parseTagBundle(shared);
    expect(draft.tags.split(', ')).toHaveLength(14);
    expect(draft.tags.startsWith('champagne_tulle_gown, halter_neckline')).toBe(true);
    expect(draft.tags).not.toMatch(/[（(）)]/);
    expect(draft.tags).not.toMatch(/[\u4e00-\u9fa5]/);
    expect(draft.name).toBe('香槟色薄纱晚礼服');
    expect(draft.aliases).toContain('挂脖领口');
  });

  it('括号里的顿号不会把一条拆成两条 tag，但会拆成多个触发词', () => {
    const draft = parseTagBundle('bunny_girl（兔女郎、兔耳、紧身）');
    expect(draft.tags).toBe('bunny_girl');
    expect(draft.aliases).toEqual(['兔女郎', '兔耳', '紧身']);
  });

  it('全角括号、全角逗号、换行混排都能认', () => {
    const draft = parseTagBundle('black_thighhighs（黑丝）\nwhite_pantyhose, 白丝');
    expect(draft.tags).toBe('black_thighhighs, white_pantyhose');
    expect(draft.aliases).toContain('黑丝');
  });

  it('纯英文没有中文触发词时 aliases 为空', () => {
    const draft = parseTagBundle('latex_bodysuit, high_heels');
    expect(draft.tags).toBe('latex_bodysuit, high_heels');
    expect(draft.aliases).toEqual([]);
  });

  it('猜分类与部位', () => {
    expect(guessWardrobeCategory('champagne_tulle_gown', ['礼服'])).toBe('date');
    expect(guessWardrobeSlot('champagne_tulle_gown, metallic_high_heels', ['高跟鞋'])).toBe('shoes');
    expect(guessWardrobeCategory('sheer_black_pantyhose', ['黑丝'])).toBe('hosiery');
    expect(guessWardrobeSlot('sheer_black_pantyhose', ['黑丝'])).toBe('hosiery');
  });

  it('把分享串直接粘进导入框就能入库', () => {
    const report = importCustomLoreJson(shared);
    expect(report.error).toBeUndefined();
    expect(report.wardrobe).toBe(1);
    const added = customWardrobe()[0];
    expect(added.name).toBe('香槟色薄纱晚礼服');
    expect(added.category).toBe('date');
    expect(added.tags).toContain('sequin_embroidery');
  });

  it('只有英文 tag 没有中文说明时明确告知缺触发词', () => {
    const report = importCustomLoreJson('latex_bodysuit, high_heels');
    expect(report.wardrobe).toBe(0);
    expect(report.error).toContain('中文');
  });
});

describe('编辑已有条目', () => {
  beforeEach(() => {
    clearCustomLore();
    resetCustomLoreCache();
  });

  it('改分类与触发词后 id 不变', () => {
    const created = addCustomWardrobe({
      name: '湿透白衬衫',
      tags: 'wet clothes, white shirt',
      aliases: '湿衬衫',
      category: 'office',
      slot: 'top',
      nsfw: 2,
    });
    expect(created.ok).toBe(true);
    const id = created.item!.id;
    const edited = updateCustomWardrobe(id, {
      name: '湿透白衬衫',
      tags: 'wet clothes, white shirt, see-through',
      aliases: '湿衬衫, 半透',
      category: 'home',
      slot: 'top',
      nsfw: 3,
    });
    expect(edited.ok).toBe(true);
    expect(edited.item!.id).toBe(id);
    expect(edited.item!.category).toBe('home');
    expect(edited.item!.nsfw).toBe(3);
    expect(edited.item!.tags).toContain('see-through');
    expect(customWardrobe()).toHaveLength(1);
  });

  it('改成与别人同名时拒绝', () => {
    addCustomWardrobe({
      name: '甲款',
      tags: 'dress a',
      aliases: '甲',
      category: 'date',
      slot: 'full',
      nsfw: 1,
    });
    const second = addCustomWardrobe({
      name: '乙款',
      tags: 'dress b',
      aliases: '乙',
      category: 'date',
      slot: 'full',
      nsfw: 1,
    });
    const edited = updateCustomWardrobe(second.item!.id, {
      name: '甲款',
      tags: 'dress b',
      aliases: '乙',
      category: 'date',
      slot: 'full',
      nsfw: 1,
    });
    expect(edited.ok).toBe(false);
    expect(edited.error).toContain('同名');
  });

  it('姿势编辑保留机位', () => {
    const created = addCustomPose({
      name: '自创体位',
      tags: 'stand and carry',
      aliases: '抱起体位',
      category: 'standing',
      nsfw: 3,
      camera: 'from below',
    });
    const edited = updateCustomPose(created.item!.id, {
      name: '自创体位改',
      tags: 'stand and carry, spread legs',
      aliases: '抱起体位',
      category: 'standing',
      nsfw: 3,
      camera: 'from below',
    });
    expect(edited.ok).toBe(true);
    expect(edited.item!.camera).toBe('from below');
    expect(customPoses()).toHaveLength(1);
  });
});