import { describe, expect, it } from 'vitest';
import {
  acceptClothingChanges,
  clothingCaption,
  clothingAt,
  clothingBefore,
  enforceClothing,
  initialiseClothingFromImage,
  parseClothingChanges,
  synthesiseSceneClothing,
} from './outfitTimeline';
import { removeUnbackedCostume } from './costumeContext';
import { emptyCharFields, type CharTagEntry } from '@/state/charTags';
import type { ImageInsertion } from './protocol';
import type { TargetSegment } from './clean';

/**
 * 外观与服装两条管道的交界处。这些不是某一条报错的复现，而是整体的一致性约束：
 * 同一个人的账本只能有一条、固定着装能被单件改状态、饰物不会被服装层剥掉。
 */

const entry = (name: string, outfit = ''): CharTagEntry => ({
  name,
  fields: { ...emptyCharFields(), sex: '1girl', outfit },
  raw: '',
  nl: '',
  source: 'manual',
  desc: '',
  history: [],
});

const segment = (id: string, text: string, sourceLine = 1, charOffset = 0): TargetSegment => ({
  id,
  text,
  sourceLine,
  charOffset,
});

const image = (name: string, tag = '1girl'): ImageInsertion => ({
  position: 'P1',
  tag: '1girl, solo',
  nl: '',
  negative: '',
  characters: [{ name, tag, nl: '' }],
  size: 'portrait',
  sourceLine: 1,
  charOffset: 0,
});

describe('账本按档案主名记，模型写别名也不能记出第二条', () => {
  it('initialiseClothingFromImage 归一别名', () => {
    const entries = [entry('林晚晴', 'white shirt, long jeans')];
    const state = clothingAt(clothingBefore([], 0, entries), [], 's');
    initialiseClothingFromImage(image('晚晴', '1girl, long jeans'), state, '晚晴站在门口。', entries);
    expect([...state.keys()]).toEqual(['林晚晴']);
  });

  it('拆开的固定着装能被单件 patch 改状态', () => {
    const entries = [entry('林晚晴', 'white shirt, long jeans')];
    const wardrobe = clothingBefore([], 0, entries);
    const source = '林晚晴褪下牛仔裤，只剩一件衬衫。';
    const parsed = parseClothingChanges(
      [
        {
          name: '林晚晴',
          position: 'P1',
          operation: 'patch',
          evidence: '林晚晴褪下牛仔裤',
          pieces: [{ id: 'jeans', state: { location: 'removed', arrangement: 'around_ankles' } }],
        },
      ],
      [segment('P1', source)],
      source,
    );
    const accepted = acceptClothingChanges(parsed, source, wardrobe, entries);
    expect(accepted.rejected).toEqual([]);
    const at = clothingAt(wardrobe, accepted.changes, 's');
    expect(clothingCaption(at.get('林晚晴')!).tag).toContain('no pants');
  });

  it('removeUnbackedCostume 认识别名，不会把整段服饰判成无依据', () => {
    const entries = [entry('林晚晴', 'long jeans')];
    const state = clothingAt(clothingBefore([], 0, entries), [], 's');
    const target = image('晚晴', '1girl, long jeans');
    removeUnbackedCostume(target, state, { era: 'ancient', culture: 'chinese', evidence: '', source: 'story' }, entries);
    expect(target.characters[0].tag).toBe('1girl, long jeans');
  });

  it('场景补录（洗澡）认正文里的简称，不会因为写的是「晚晴」就漏补', () => {
    const entries = [entry('林晚晴', 'white shirt, long jeans')];
    const wardrobe = clothingBefore([], 0, entries);
    const scene = synthesiseSceneClothing('晚晴走进浴室，泡进热水里。', entries, wardrobe);
    expect(scene.changes).toHaveLength(1);
    expect(scene.changes[0].name).toBe('林晚晴');
    expect(scene.changes[0].pieces.every((p) => p.state.location === 'floor')).toBe(true);
  });
});

describe('饰物归 appearance，服装层不许剥', () => {
  it('她自己身上的发带与项链不被服装层剥掉', () => {
    const entries = [entry('林晚晴', 'white shirt')];
    const state = clothingAt(clothingBefore([], 0, entries), [], 's');
    const target = image('林晚晴', '1girl, long black hair, hair ribbon, silver necklace');
    enforceClothing(target, state, false, true, entries, '林晚晴站在门口。');
    const tag = target.characters[0].tag;
    expect(tag).toContain('hair ribbon');
    expect(tag).toContain('silver necklace');
    expect(tag).toContain('white shirt');
  });

  it('眼镜在这段里没写在她脸上时，从她的 tag 里摘掉', () => {
    // 契约要求「别人的特征不许写进她 tag」，但那是概率性的；出口再判一次。
    // 实测：第 3 节李斌推了推眼镜，后面几十楼女主的脸上都有 glasses。
    const entries = [entry('林晚晴', 'white shirt')];
    const state = clothingAt(clothingBefore([], 0, entries), [], 's');
    const target = image('林晚晴', '1girl, long black hair, glasses, white shirt');
    enforceClothing(target, state, false, true, entries, '李斌推了推眼镜，看向林晚晴。');
    expect(target.characters[0].tag).not.toContain('glasses');
    expect(target.characters[0].tag).toContain('white shirt');
  });

  it('正文写了她自己戴着眼镜时保留', () => {
    const entries = [entry('林晚晴', 'white shirt')];
    const state = clothingAt(clothingBefore([], 0, entries), [], 's');
    const target = image('林晚晴', '1girl, glasses, white shirt');
    enforceClothing(target, state, false, true, entries, '林晚晴推了推自己的眼镜。');
    expect(target.characters[0].tag).toContain('glasses');
  });
});
