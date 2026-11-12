import { describe, expect, it } from 'vitest';
import type { CharTagEntry } from '@/state/charTags';
import type { TargetSegment } from './clean';
import type { ImageInsertion } from './protocol';
import {
  acceptClothingChanges,
  redressForNewScene,
  adoptChangedClothing,
  clothingAt,
  clothingCaption,
  initialiseClothingFromImage,
  parseClothingChanges,
  proseGarment,
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

  it('亲吻和隔着衣服的抚摸不推断任何脱衣', () => {
    const wardrobe = wardrobeOf('林晚晴', [
      piece('a', 'white shirt'),
      piece('b', 'dark skirt'),
      piece('c', 'white panties'),
      piece('d', 'white bra'),
    ]);
    const kiss = synthesiseSceneClothing('林晚晴与他接吻，呼吸交缠。', [entry('林晚晴')], wardrobe);
    expect(kiss.changes).toHaveLength(0);
    const touch = synthesiseSceneClothing(
      '林晚晴靠在他怀里，他隔着衣服抚摸她的胸口。',
      [entry('林晚晴')],
      wardrobe,
    );
    expect(touch.changes).toHaveLength(0);
  });

  it('明确写着隔着衣物时,即使情节再亲密也不脱', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt'), piece('c', 'white panties')]);
    const scene = synthesiseSceneClothing(
      '林晚晴与他做爱，衣服都还穿在身上，只是下体隔着布料摩擦。',
      [entry('林晚晴')],
      wardrobe,
    );
    expect(scene.changes).toHaveLength(0);
  });

  it('只脱了被点名的那件,其余保持原样', () => {
    const wardrobe = wardrobeOf('林晚晴', [
      piece('a', 'white shirt'),
      piece('b', 'dark skirt'),
      piece('c', 'white panties'),
    ]);
    const scene = synthesiseSceneClothing(
      '林晚晴做爱前褪下内裤，裙子仍然穿着。',
      [entry('林晚晴')],
      wardrobe,
    );
    expect(scene.changes).toHaveLength(1);
    const pieces = scene.changes[0].pieces;
    expect(pieces.map((p) => p.id)).toEqual(['c']);
    expect(pieces[0].state.location).toBe('removed');
  });

  it('写了赤裸/全裸时整身衣物才全部脱下', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt'), piece('b', 'dark skirt')]);
    const scene = synthesiseSceneClothing('林晚晴赤裸着身子压在他身上。', [entry('林晚晴')], wardrobe);
    expect(scene.changes[0].pieces.every((p) => p.state.location === 'removed')).toBe(true);
  });

  it('洗澡时原文写着穿泳衣,不按全脱处理', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white swimsuit')]);
    const scene = synthesiseSceneClothing('林晚晴穿着泳衣走进浴室冲洗。', [entry('林晚晴')], wardrobe);
    expect(scene.changes).toHaveLength(0);
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

describe('款式漂移防护', () => {
  it('外观描述不能整套换装', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'long jeans')]);
    const change: ClothingChange = {
      name: '林晚晴',
      reportedName: '林晚晴',
      position: 'P1',
      sourceLine: 0,
      charOffset: 0,
      operation: 'change',
      evidence: '林晚晴穿着一条短牛仔裤，站在门口。',
      pieces: [piece('b', 'denim shorts')],
    };
    const accepted = acceptClothingChanges([change], change.evidence, wardrobe, [entry('林晚晴')]);
    expect(accepted.changes).toHaveLength(0);
    expect(accepted.rejected.join()).toContain('外观描述');
  });

  it('proseGarment 认得出长牛仔裤与短牛仔裤', () => {
    expect(proseGarment('她穿着一条蓝色的长牛仔裤')).toBe('blue long jeans');
    expect(proseGarment('换上黑色牛仔短裤')).toBe('black denim shorts');
    expect(proseGarment('她笑了笑，没说话')).toBe('');
  });

  it('首次建档优先采用剧情原文的款式', () => {
    const wardrobe: ClothingState = new Map();
    const image = {
      position: 'P1',
      after: '',
      tag: '',
      nl: '',
      sourceLine: 0,
      charOffset: 0,
      characters: [{ name: '林晚晴', tag: 'white denim shorts, tank top', nl: '' }],
    } as unknown as ImageInsertion;
    initialiseClothingFromImage(image, wardrobe, '林晚晴穿着一条白色长牛仔裤走进房间。');
    const design = wardrobe.get('林晚晴')!.pieces.map((p) => p.design).join(',');
    expect(design).toContain('long jeans');
    expect(design).not.toContain('shorts');
  });
});

describe('redressForNewScene', () => {
  const before: ClothingState = new Map([
    [
      '林晚晴',
      {
        name: '林晚晴',
        outfitId: 'o1',
        pieces: [
          { id: 'p1', design: 'white shirt', state: { location: 'removed' } },
          { id: 'p2', design: 'long jeans', state: { location: 'worn' } },
        ],
        source: 'init',
      },
    ],
  ]);

  it('换天出门时把脱下的衣物穿回', () => {
    const { changes, notes } = redressForNewScene('第二天清晨，她收拾好出门上班。', [], before);
    expect(changes).toHaveLength(1);
    expect(changes[0].pieces[0].state.location).toBe('worn');
    expect(notes[0]).toContain('穿回');
  });

  it('本楼正在做爱/洗澡时不复位', () => {
    const { changes } = redressForNewScene('第二天清晨，两人在浴室里做爱。', [], before);
    expect(changes).toHaveLength(0);
  });

  it('没有翻篇标志时不动', () => {
    const { changes } = redressForNewScene('她坐在床边说话。', [], before);
    expect(changes).toHaveLength(0);
  });
});
