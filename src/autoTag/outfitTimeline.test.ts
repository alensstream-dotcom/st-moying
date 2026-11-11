import { describe, expect, it } from 'vitest';
import type { CharTagEntry } from '@/state/charTags';
import type { TargetSegment } from './clean';
import type { ImageInsertion } from './protocol';
import {
  acceptClothingChanges,
  adoptChangedClothing,
  clothingAt,
  clothingCaption,
  parseClothingChanges,
  synthesiseSceneClothing,
  type ClothingChange,
  type ClothingPiece,
  type ClothingRecord,
  type ClothingState,
} from './outfitTimeline';

const segments = [{ id: 'P1', text: '', sourceLine: 0, charOffset: 0 }] as unknown as TargetSegment[];

function entry(name: string): CharTagEntry {
  return {
    name,
    fields: { hair: 'black long hair', eyes: 'amber eyes' },
    raw: 'black long hair, amber eyes',
    nl: '',
    source: 'manual',
    desc: '',
    history: [],
  } as unknown as CharTagEntry;
}

function piece(id: string, design: string, state: Record<string, string> = { location: 'worn' }): ClothingPiece {
  return { id, design, state };
}

function wardrobeOf(
  name: string,
  pieces: ClothingPiece[],
  suitMode?: 'style' | 'always',
): ClothingState {
  const record: ClothingRecord = { name, outfitId: 'o1', pieces, source: 'init', suitMode };
  return new Map([[name, record]]);
}

function patchOf(
  name: string,
  pieces: ClothingPiece[],
  evidence: string,
): ClothingChange {
  return {
    name,
    reportedName: name,
    position: 'P1',
    sourceLine: 0,
    charOffset: 0,
    operation: 'patch',
    evidence,
    pieces,
  };
}

describe('acceptClothingChanges 容错', () => {
  it('固定套装仍允许记录穿脱状态,但拒绝整套换装', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt')], 'always');
    const accepted = acceptClothingChanges(
      [patchOf('林晚晴', [piece('a', '', { fastening: 'open' })], '林晚晴解开衬衫扣子。')],
      '林晚晴解开衬衫扣子。',
      wardrobe,
      [entry('林晚晴')],
    );
    expect(accepted.changes).toHaveLength(1);

    const rejectedChange: ClothingChange = {
      ...patchOf('林晚晴', [piece('a', 'red dress')], '林晚晴换上一件红色连衣裙。'),
      operation: 'change',
    };
    const rejected = acceptClothingChanges(
      [rejectedChange],
      '林晚晴换上一件红色连衣裙。',
      wardrobe,
      [entry('林晚晴')],
    );
    expect(rejected.changes).toHaveLength(0);
    expect(rejected.rejected.join()).toContain('固定套装');
  });

  it('部件 ID 写错时按衣物类别唯一匹配归位', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt'), piece('b', 'dark skirt')]);
    const accepted = acceptClothingChanges(
      [patchOf('林晚晴', [piece('tmp', 'black blouse', { fastening: 'open' })], '林晚晴解开上衣扣子。')],
      '林晚晴解开上衣扣子。',
      wardrobe,
      [entry('林晚晴')],
    );
    expect(accepted.changes).toHaveLength(1);
    expect(accepted.changes[0].pieces[0].id).toBe('a');
  });

  it('状态全写 unknown 时按动作句推断,不再整条丢弃', () => {
    const wardrobe = wardrobeOf('林晚晴', [
      piece('a', 'white shirt'),
      piece('b', 'white panties'),
    ]);
    const source = '林晚晴褪下内裤。';
    const accepted = acceptClothingChanges(
      [patchOf('林晚晴', [piece('b', '', { location: 'unknown' })], source)],
      source,
      wardrobe,
      [entry('林晚晴')],
    );
    expect(accepted.changes).toHaveLength(1);
    const at = clothingAt(wardrobe, accepted.changes, 'scope');
    expect(at.get('林晚晴')?.pieces.find((p) => p.id === 'b')?.state.location).toBe('removed');
  });

  it('引文多抄一句时仍能按分句定位', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt')]);
    const source = '林晚晴解开衬衫扣子，露出锁骨。她别过脸去。';
    const parsed = parseClothingChanges(
      [
        {
          name: '林晚晴',
          position: 'P1',
          operation: 'patch',
          evidence: '她别过脸去。林晚晴解开衬衫扣子，露出锁骨。',
          pieces: [{ id: 'a', design: '', state: { fastening: 'open' } }],
        },
      ],
      segments,
      source,
    );
    const accepted = acceptClothingChanges(parsed, source, wardrobe, [entry('林晚晴')]);
    expect(accepted.changes).toHaveLength(1);
    expect(accepted.changes[0].evidence).toBe('林晚晴解开衬衫扣子');
  });
});

describe('synthesiseSceneClothing 场景推断', () => {
  it('洗澡时把在穿衣物全部记为脱下并打湿', () => {
    const wardrobe = wardrobeOf('林晚晴', [
      piece('a', 'white shirt'),
      piece('b', 'dark skirt'),
      piece('c', 'white panties'),
    ]);
    const scene = synthesiseSceneClothing(
      '林晚晴走进浴室，泡进热水里。',
      [entry('林晚晴')],
      wardrobe,
    );
    expect(scene.changes).toHaveLength(1);
    const states = scene.changes[0].pieces.map((p) => p.state);
    expect(states.every((s) => s.location === 'floor' && s.wetness === 'wet')).toBe(true);
  });

  it('亲密情节至少脱下内裤,裙子掀起', () => {
    const wardrobe = wardrobeOf('林晚晴', [
      piece('a', 'white shirt'),
      piece('b', 'dark skirt'),
      piece('c', 'white panties'),
    ]);
    const scene = synthesiseSceneClothing(
      '林晚晴与他做爱，喘息声压得很低。',
      [entry('林晚晴')],
      wardrobe,
    );
    const pieces = scene.changes[0].pieces;
    expect(pieces.find((p) => p.id === 'c')?.state.location).toBe('removed');
    expect(pieces.find((p) => p.id === 'b')?.state.arrangement).toBe('lifted');
  });

  it('固定套装不做场景改动,只提示', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt')], 'always');
    const scene = synthesiseSceneClothing('林晚晴在浴室洗澡。', [entry('林晚晴')], wardrobe);
    expect(scene.changes).toHaveLength(0);
    expect(scene.notes.join()).toContain('固定套装');
  });
});

describe('adoptChangedClothing 采纳剧情换装', () => {
  function imageOf(name: string, tag: string): ImageInsertion {
    return {
      position: 'P1',
      after: '',
      tag: '',
      nl: '',
      sourceLine: 0,
      charOffset: 0,
      characters: [{ name, tag, nl: '' }],
    } as unknown as ImageInsertion;
  }

  it('剧情明确换装且图片外观是新型衣物时接管新衣物', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt'), piece('b', 'dark skirt')]);
    const adopted = adoptChangedClothing(
      imageOf('林晚晴', 'red dress, long hair'),
      wardrobe,
      '林晚晴换上一件红色连衣裙。',
    );
    expect(adopted.changes).toHaveLength(1);
    expect(adopted.changes[0].operation).toBe('change');
    const at = clothingAt(wardrobe, adopted.changes, 'scope');
    expect(clothingCaption(at.get('林晚晴')!).tag).toContain('red dress');
  });

  it('没有换装动词时不改动账本', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt')]);
    const adopted = adoptChangedClothing(
      imageOf('林晚晴', 'red dress'),
      wardrobe,
      '林晚晴站在窗前，想着心事。',
    );
    expect(adopted.changes).toHaveLength(0);
  });
});

describe('clothingCaption', () => {
  it('上下都脱光时输出 nude', () => {
    const record: ClothingRecord = {
      name: '林晚晴',
      outfitId: 'o1',
      pieces: [piece('a', 'white shirt', { location: 'removed' }), piece('b', 'dark skirt', { location: 'removed' })],
      source: 'x',
    };
    expect(clothingCaption(record).tag).toContain('nude');
  });
});
