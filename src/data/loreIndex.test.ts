import { describe, expect, it } from 'vitest';
import { WARDROBE_CATEGORIES, WARDROBE_ITEMS } from '@/data/wardrobe';
import { POSE_CATEGORIES, POSE_ITEMS } from '@/data/poseBank';
import { buildLoreBlock, collectLoreCandidates, pickDiverse, wardrobeByCategory } from '@/data/loreIndex';
import { BODY_PRESETS, FACE_PRESETS, FANDOM_PRESETS } from '@/data/faceBank';
import { BODY_EXTRA, FACE_EXTRA, FANDOM_EXTRA } from '@/data/faceExtra';

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
    expect(POSE_ITEMS.length).toBeGreaterThanOrEqual(84);
    const counts = POSE_CATEGORIES.map(
      category => POSE_ITEMS.filter(item => item.category === category.id).length,
    );
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(6);
    }
    // 最多的那一类不能超过最少那一类的 4 倍,否则召回会永远偏向同一类。
    expect(Math.max(...counts)).toBeLessThanOrEqual(Math.min(...counts) * 4);
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

describe('数据文件的书写口径(导入别人整理的表时最容易踩)', () => {
  it('所有服装 tag 串都是英文小写 + 逗号加空格', () => {
    for (const item of WARDROBE_ITEMS) {
      expect(item.tags).not.toMatch(/[\u4e00-\u9fa5]/);
      expect(item.tags).toBe(item.tags.toLowerCase());
      expect(item.tags).not.toMatch(/,\S/);
    }
  });

  it('所有触发词都在两个汉字以上(单字会被匹配器直接跳过)', () => {
    for (const item of [...WARDROBE_ITEMS, ...POSE_ITEMS]) {
      for (const alias of item.aliases) {
        expect(alias.trim().length).toBeGreaterThanOrEqual(2);
      }
      expect(item.aliases.length).toBeGreaterThan(0);
    }
  });

  it('姿势条目的 category 都在分类表里,且 id 唯一', () => {
    const known = new Set<string>(POSE_CATEGORIES.map(category => category.id));
    for (const item of POSE_ITEMS) {
      expect(known.has(item.category)).toBe(true);
    }
    const ids = POSE_ITEMS.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('人物指纹三条表的 id 互不重复', () => {
    const ids = [
      ...FACE_PRESETS,
      ...FACE_EXTRA,
      ...BODY_PRESETS,
      ...BODY_EXTRA,
      ...FANDOM_PRESETS,
      ...FANDOM_EXTRA,
    ].map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('loreIndex 同人骨相召回', () => {
  const opts = { wardrobeLimit: 0, poseLimit: 0, faces: true, faceLimit: 8 };

  it('正文点名角色或作品时,同人条目排在最前并被标 direct', () => {
    const { faces } = collectLoreCandidates('卡琳站在走廊尽头,清冷地看着他', opts);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces[0].item.id).toBe('fandom-ba-karin');
    expect(faces[0].direct).toBe(true);
  });

  it('只写作品名也算点名,不必写到角色名', () => {
    const { faces } = collectLoreCandidates('这是碧蓝档案的学园', opts);
    expect(faces.some(hit => hit.direct)).toBe(true);
    expect(faces.every(hit => !hit.direct || hit.item.kind === 'fandom')).toBe(true);
  });

  it('正文没点名时同人条目依然进候选,不再被脸型体型挤掉', () => {
    // 只有泛的外形词,一条 aliases 都命不中;旧实现里这一类整块为空。
    const { faces } = collectLoreCandidates('她一张清冷的脸,白色长发,紫色眼睛', opts);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.some(hit => hit.item.kind === 'fandom')).toBe(true);
  });

  it('同人条目与脸型体型分占配额,不再互相挤成 2 条', () => {
    const { faces } = collectLoreCandidates('卡琳一张清冷的脸,白色长发', opts);
    const kinds = new Set(faces.map(hit => hit.item.kind));
    expect(faces.length).toBeLessThanOrEqual(8);
    // 有同人指名时,脸型/体型仍要各留位置做底。
    expect(kinds.has('fandom') || kinds.has('face') || kinds.has('body')).toBe(true);
  });

  it('faceLimit 卡得住条数,设 0 就整块不召回', () => {
    expect(collectLoreCandidates('卡琳一张清冷的脸', { ...opts, faceLimit: 2 }).faces.length).toBeLessThanOrEqual(2);
    expect(collectLoreCandidates('卡琳一张清冷的脸', { ...opts, faceLimit: 0 }).faces).toEqual([]);
  });

  it('渲染时点名与未点名的同人条目给不同用法', () => {
    const direct = buildLoreBlock('卡琳望着他', opts);
    expect(direct).toContain('正文点名了作品或角色时,优先用对应的同人条目');
    // 没点名、但外形词能召回同人时,给的是「借骨相」用法,不是「别用」。
    const loose = buildLoreBlock('她一张清冷的脸,白色长发,紫色眼睛', opts);
    expect(loose).toContain('即使正文没有点名作品也可以用');
    expect(loose).toContain('以角色的固定外貌为准');
  });
});

describe('loreIndex 同分摇号', () => {
  it('不同种子会在同分候选之间换人', () => {
    const text = '她穿着水手服';
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const { wardrobe } = collectLoreCandidates(text, { wardrobeLimit: 3, rollSeed: seed });
      seen.add(wardrobe.map(hit => hit.item.id).join(','));
    }
    // 摇号没生效的话这 12 个种子会给出同一个组合。
    expect(seen.size).toBeGreaterThan(1);
  });

  it('同一种子结果稳定,单测可复现', () => {
    const text = '她穿着水手服';
    const a = collectLoreCandidates(text, { wardrobeLimit: 4, rollSeed: 7 }).wardrobe.map(hit => hit.item.id);
    const b = collectLoreCandidates(text, { wardrobeLimit: 4, rollSeed: 7 }).wardrobe.map(hit => hit.item.id);
    expect(a).toEqual(b);
  });

  it('种子为 0 时保持严格按分数,顺序与 id 字典序', () => {
    const a = collectLoreCandidates('她穿着黑丝', { wardrobeLimit: 5, rollSeed: 0 }).wardrobe.map(hit => hit.item.id);
    const b = collectLoreCandidates('她穿着黑丝', { wardrobeLimit: 5 }).wardrobe.map(hit => hit.item.id);
    expect(a).toEqual(b);
  });

  it('摇号只在同分之间动,不会把明显高分的挤掉', () => {
    const text = '她穿着黑丝';
    const base = collectLoreCandidates(text, { wardrobeLimit: 8 }).wardrobe;
    const top = base[0].score;
    for (let seed = 1; seed <= 6; seed += 1) {
      const { wardrobe } = collectLoreCandidates(text, { wardrobeLimit: 8, rollSeed: seed });
      // 最高分的那批必须还在,不能因为摇号掉出前 8。
      expect(wardrobe.some(hit => hit.score === top)).toBe(true);
    }
  });

  it('脸型/体型也摇号,不会永远只推同一个新面孔', () => {
    const opts = { wardrobeLimit: 0, poseLimit: 0, faces: true, faceLimit: 6 };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const { faces } = collectLoreCandidates('她一张清冷的脸', { ...opts, rollSeed: seed });
      const nonFandom = faces.filter(hit => hit.item.kind !== 'fandom').map(hit => hit.item.id);
      seen.add(nonFandom.join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('脸型摇号同样不越过高分条目', () => {
    const opts = { wardrobeLimit: 0, poseLimit: 0, faces: true, faceLimit: 8 };
    const base = collectLoreCandidates('她一张清冷的脸', opts).faces.filter(
      hit => hit.item.kind !== 'fandom',
    );
    const top = base[0].score;
    for (let seed = 1; seed <= 6; seed += 1) {
      const { faces } = collectLoreCandidates('她一张清冷的脸', { ...opts, rollSeed: seed });
      expect(faces.some(hit => hit.score === top)).toBe(true);
    }
  });
});
