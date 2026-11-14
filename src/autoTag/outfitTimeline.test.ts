import { describe, expect, it } from 'vitest';
import { emptyCharFields, type CharTagEntry } from '@/state/charTags';
import type { TargetSegment } from './clean';
import type { ImageInsertion } from './protocol';
import {
  acceptClothingChanges,
  redressForNewScene,
  settleStaleUndress,
  enforceClothing,
  adoptChangedClothing,
  clothingAt,
  clothingBefore,
  clothingBlock,
  clothingCaption,
  garmentKind,
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

  it('扒开衣领露出胸部只算裸露,不算脱下', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt'), piece('b', 'dark skirt')]);
    const scene = synthesiseSceneClothing(
      '林晚晴做爱，他扒开她的衣领，露出整个胸部。',
      [entry('林晚晴')],
      wardrobe,
    );
    expect(scene.changes).toHaveLength(1);
    const shirt = scene.changes[0].pieces.find((p) => p.id === 'a');
    // 旧版记成 removed,渲染成 no shirt → 画成光膀子,比正文脱得更多。
    expect(shirt?.state.exposure).toBe('bare');
    expect(shirt?.state.location).toBeUndefined();
  });

  it('扒开内裤露出私处只算裸露下体', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt'), piece('c', 'white panties')]);
    const scene = synthesiseSceneClothing(
      '林晚晴做爱，他扒开她的内裤，露出阴部。',
      [entry('林晚晴')],
      wardrobe,
    );
    const panties = scene.changes[0]?.pieces.find((p) => p.id === 'c');
    expect(panties?.state.exposure).toBe('bare');
    expect(scene.changes[0].pieces.some((p) => p.id === 'a')).toBe(false);
  });
});

describe('exposure 渲染', () => {
  it('衣服还穿着但露出来时渲染 breasts out / pussy 而不是 no shirt', () => {
    const record: ClothingRecord = {
      name: '林晚晴',
      outfitId: 'o1',
      source: 'init',
      pieces: [
        { id: 'a', design: 'white shirt', state: { location: 'worn', exposure: 'bare' } },
        { id: 'b', design: 'white panties', state: { location: 'worn', exposure: 'bare' } },
      ],
    };
    const caption = clothingCaption(record);
    expect(caption.tag).toContain('breasts out');
    expect(caption.tag).toContain('pussy');
    expect(caption.tag).not.toContain('no shirt');
    expect(caption.tag).not.toContain('no panties');
    expect(caption.tag).not.toContain('topless');
    expect(caption.tag).not.toContain('bottomless');
  });

  it('只露一部分渲染 cleavage', () => {
    const record: ClothingRecord = {
      name: '林晚晴',
      outfitId: 'o1',
      source: 'init',
      pieces: [{ id: 'a', design: 'white shirt', state: { location: 'worn', exposure: 'partial' } }],
    };
    expect(clothingCaption(record).tag).toContain('cleavage');
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

  /**
   * 陈述句也算数。
   *
   * 「她今天穿着一条长牛仔裤」没有换装动词，却已经把款式写死了；只看动作词的话，
   * 账本记成短牛仔裤就永远纠不回来——这正是用户报的「剧情写了服装，图里还是旧的」。
   */
  it('正文陈述她穿着什么时按正文纠正记错的款式', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'denim shorts')]);
    const adopted = adoptChangedClothing(
      imageOf('林晚晴', 'denim shorts, long hair'),
      wardrobe,
      '林晚晴今天穿着一条长牛仔裤。',
    );
    expect(adopted.changes).toHaveLength(1);
    const at = clothingAt(wardrobe, adopted.changes, 'scope');
    expect(clothingCaption(at.get('林晚晴')!).tag).toContain('long jeans');
  });

  /**
   * 陈述里没有衣物词（「她穿着衣服」）不足以接管，否则每句「穿着」都要重记一次账本。
   */
  it('陈述句里没有具体衣物词时不接管', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'denim shorts')]);
    const adopted = adoptChangedClothing(
      imageOf('林晚晴', 'white shirt'),
      wardrobe,
      '林晚晴穿着衣服坐在床边。',
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

  it('连体衣脱掉渲染成 no dress,而不是空串', () => {
    // 空串会让 enforceClothing 的 `if (!caption.tag.trim()) continue` 整条跳过，
    // 服装层对这个角色直接失效。
    const record: ClothingRecord = {
      name: '林晚晴',
      outfitId: 'o1',
      pieces: [piece('a', 'blue cheongsam', { location: 'removed' })],
      source: 'x',
    };
    const caption = clothingCaption(record);
    expect(caption.tag).toContain('no dress');
    expect(caption.tag).toContain('nude');
  });

  it('只脱下装时点名到具体那件', () => {
    const record: ClothingRecord = {
      name: '林晚晴',
      outfitId: 'o1',
      pieces: [piece('a', 'white shirt'), piece('b', 'long jeans', { location: 'removed' })],
      source: 'x',
    };
    const caption = clothingCaption(record);
    expect(caption.tag).toContain('white shirt');
    expect(caption.tag).toContain('no pants');
    expect(caption.tag).toContain('bottomless');
  });
});

describe('款式漂移防护', () => {
  it('外观描述只换同类部件的款式,不整套重置', () => {
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
    // 旧版一律拒掉,账本记错过一次就一路错到底;现在按同类部件改款式。
    expect(accepted.changes).toHaveLength(1);
    expect(accepted.changes[0].operation).toBe('patch');
    expect(accepted.changes[0].pieces[0]).toMatchObject({ id: 'a', design: 'denim shorts' });
  });

  it('外观描述对不上任何同类部件时才拒', () => {
    const wardrobe = wardrobeOf('林晚晴', [piece('a', 'white shirt')]);
    const change: ClothingChange = {
      ...patchOf('林晚晴', [piece('x', 'red skirt')], '林晚晴穿着一条红裙子。'),
      operation: 'change',
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

describe('settleStaleUndress', () => {
  const make = (): ClothingState =>
    new Map([
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

  it('连续两楼不提这件衣服就穿回去', () => {
    const state = make();
    settleStaleUndress(state, '两人坐在窗边聊天。');
    expect(state.get('林晚晴')?.pieces[0].state.location).toBe('removed');
    settleStaleUndress(state, '天色暗了下来。');
    expect(state.get('林晚晴')?.pieces[0].state.location).toBe('worn');
    expect(state.get('林晚晴')?.pieces[1].state.location).toBe('worn');
  });

  it('这一楼还在裸着/在脱就不算陈旧', () => {
    const state = make();
    settleStaleUndress(state, '她赤裸着坐在床边。');
    expect(state.get('林晚晴')?.pieces[0].state.location).toBe('removed');
  });

  it('场景翻篇立刻穿回', () => {
    const state = make();
    settleStaleUndress(state, '第二天清晨，她出门锁门。');
    expect(state.get('林晚晴')?.pieces[0].state.location).toBe('worn');
  });

  it('只脱了上衣时裤子照旧，不会被连带改状态', () => {
    const state = make();
    settleStaleUndress(state, '她坐在窗边发呆。');
    settleStaleUndress(state, '窗外下起了雨。');
    expect(state.get('林晚晴')?.pieces[0].state.location).toBe('worn');
    expect(state.get('林晚晴')?.pieces[1].state.location).toBe('worn');
  });
});

describe('固定着装进账本', () => {
  it('没动过时按原样渲染出整套，而不是空串', () => {
    const state = clothingBefore([], 0, [
      {
        name: '林晚晴',
        fields: { ...emptyCharFields(), sex: '1girl', outfit: 'white shirt, long jeans' },
        raw: '',
        nl: '',
        source: 'manual',
        desc: '',
        history: [],
      },
    ]);
    const tag = clothingCaption(state.get('林晚晴')!).tag;
    expect(tag).toContain('white shirt');
    expect(tag).toContain('long jeans');
  });
});

describe('initialiseClothingFromImage', () => {
  const blank: ImageInsertion = {
    position: 'P1',
    sourceLine: 0,
    charOffset: 0,
    tag: '',
    nl: '',
    negative: '',
    size: 'portrait',
    characters: [{ name: '林晚晴', tag: '1girl, nude, black hair', nl: '' }],
  } as ImageInsertion;

  it('正文没说脱衣时，把模型写的 nude 降级成穿着', () => {
    const state: ClothingState = new Map();
    initialiseClothingFromImage(blank, state, '林晚晴穿着白色衬衫站在门口。');
    expect(state.get('林晚晴')?.pieces[0].state.location).not.toBe('removed');
  });

  it('正文确实写了赤裸就保留脱衣状态', () => {
    const state: ClothingState = new Map();
    initialiseClothingFromImage(blank, state, '林晚晴浑身赤裸地站在窗边。');
    expect(state.get('林晚晴')?.pieces[0].state.location).toBe('removed');
  });
});

describe('clothingCaption 空账本', () => {
  it('一件衣物都没记时不剥掉模型写的衣服', () => {
    const state: ClothingState = new Map([
      ['林晚晴', { name: '林晚晴', outfitId: 'o', pieces: [], source: 'init' }],
    ]);
    const image: ImageInsertion = {
      position: 'P1',
      sourceLine: 0,
      charOffset: 0,
      tag: 'white shirt, long jeans',
      nl: '',
      negative: '',
      size: 'portrait',
      characters: [{ name: '林晚晴', tag: '1girl, white shirt, long jeans', nl: '' }],
    } as ImageInsertion;
    enforceClothing(image, state, false, true);
    expect(image.characters[0].tag).toContain('white shirt');
    expect(image.tag).toContain('white shirt');
  });
});

describe('enforceClothing 道具剔除', () => {
  function build() {
    const state: ClothingState = new Map([
      [
        '林晚晴',
        {
          name: '林晚晴',
          outfitId: 'o',
          source: 'init',
          pieces: [{ id: 'top', design: 'white shirt', state: { location: 'worn' } }],
        },
      ],
    ]);
    const image: ImageInsertion = {
      position: 'P1',
      sourceLine: 0,
      charOffset: 0,
      tag: '1girl, knife at neck, white shirt, handcuffs',
      nl: '',
      negative: '',
      size: 'portrait',
      characters: [{ name: '林晚晴', tag: 'long hair, knife at neck, handcuffs', nl: '' }],
    } as ImageInsertion;
    return { state, image };
  }

  it('正文没再提刀和手铐时全部剔除', () => {
    const { state, image } = build();
    enforceClothing(image, state, false, true, [], '第二天她走进教室。');
    expect(image.characters[0].tag).not.toContain('knife');
    expect(image.characters[0].tag).not.toContain('handcuffs');
    expect(image.tag).not.toContain('knife');
    expect(image.characters[0].tag).toContain('white shirt');
  });

  it('正文还在用刀就保留', () => {
    const { state, image } = build();
    enforceClothing(image, state, false, true, [], '他把刀架在她脖子上。');
    expect(image.characters[0].tag).toContain('knife at neck');
  });
});

describe('服装账本的呈现与固定着装', () => {
  function record(name: string, design: string, location = 'worn'): ClothingRecord {
    return {
      name,
      outfitId: `outfit_${name}`,
      pieces: [{ id: 'p1', design, state: { location } }],
      source: '正文',
    };
  }

  it('账本按人一行渲染,不再整串 JSON', () => {
    const state: ClothingState = new Map([
      ['林晚晴', record('林晚晴', 'white blouse, long jeans')],
      ['苏晚', record('苏晚', 'black skirt', 'floor')],
    ]);
    const text = clothingBlock(state);
    expect(text).toContain('- 林晚晴：white blouse, long jeans');
    expect(text).toContain('已脱下：black skirt');
    expect(text).not.toContain('[{');
  });

  it('半脱状态跟着部件写出来,不丢位置', () => {
    const worn = record('林晚晴', 'white blouse');
    worn.pieces[0].state = { location: 'worn', arrangement: 'pulled_aside' };
    expect(clothingBlock(new Map([['林晚晴', worn]]))).toContain('white blouse（pulled_aside）');
  });

  it('用户固定整套会在行尾点名', () => {
    const state: ClothingState = new Map([
      ['林晚晴', { ...record('林晚晴', 'white blouse'), suitMode: 'always' }],
    ]);
    expect(clothingBlock(state)).toContain('用户固定整套');
  });

  it('空账本给一次性提示,不是空白', () => {
    expect(clothingBlock(new Map())).toContain('账本为空');
  });

  it('档案里的固定着装进基准账本,并锁成 style', () => {
    const state = clothingBefore([], 0, [
      { ...entry('林晚晴'), fields: { ...entry('林晚晴').fields, outfit: 'navy sailor uniform' } },
    ]);
    expect(state.get('林晚晴')?.pieces[0].design).toBe('navy sailor uniform');
    // always 会拒掉整套换装,必须用 style:锁款式但允许有证据的换装。
    expect(state.get('林晚晴')?.suitMode).toBe('style');
  });

  it('没有固定着装的角色不进基准账本', () => {
    expect(clothingBefore([], 0, [{ ...entry('无名'), fields: { ...entry('无名').fields, outfit: '' } }]).size).toBe(0);
  });
});
describe('真实正文：场景推断与账本兜底', () => {
  // 用户那本小说开篇的原句（保留原写法）。这一句同时踩了三个坑：
  // ①「躯体近乎毫无遮挡」不点任何一件衣服；②「按着震动棒…反复抽送」没有脱的动词；
  // ③「肩带垮落」是衣服自己滑下去。旧版全不命中 → 账本一条不记 → 图里全套穿好。
  const PROSE =
    '名为茉莉的少女靠着柱子，近乎透明的白连衣的肩带垮落，稚嫩饱满真娇躯体近乎毫无遮挡，柔软乳球被埋入得近乎消失的手指肆意揉搓，挺拔娇粉的樱桃被双指夹住拨弄，探入裙底的纤细玉手死死按着震动棒，在瘙痒难耐淫水流满的小穴内反复来回抽送。';

  function seeded(name: string): ClothingState {
    const state: ClothingState = new Map();
    state.set(name, {
      name,
      outfitId: 'o1',
      source: '',
      suitMode: 'style',
      pieces: [
        { id: 'shirt', design: 'white camisole', state: { location: 'worn' } },
        { id: 'skirt', design: 'black skirt', state: { location: 'worn' } },
        { id: 'panties', design: 'white panties', state: { location: 'worn' } },
      ],
    } as ClothingRecord);
    return state;
  }

  function apply(state: ClothingState, changes: ClothingChange[]): void {
    for (const change of changes) {
      const record = state.get(change.name);
      if (!record) continue;
      for (const piece of change.pieces) {
        const target = record.pieces.find((item) => item.id === piece.id);
        if (target) target.state = { ...target.state, ...piece.state };
      }
    }
  }

  it('「躯体毫无遮挡」这种不点名衣物的写法也要推进账本', () => {
    const state = seeded('茉莉');
    const out = synthesiseSceneClothing(PROSE, [entry('茉莉')], state, []);
    expect(out.changes.length).toBeGreaterThan(0);
    apply(state, out.changes);
    expect(clothingCaption(state.get('茉莉')!).tag).toContain('nude');
  });

  it('中文款式能归类，脱掉后才渲染得出 no dress', () => {
    expect(garmentKindOf('白连衣')).toBe('dress');
    expect(garmentKindOf('牛仔长裤')).toBe('pants');
  });

  it('手/道具已经进到下身里时，内裤记成半脱而不是消失', () => {
    const state = seeded('茉莉');
    const out = synthesiseSceneClothing(
      '茉莉的手探进自己内裤里，按着跳蛋在小穴内来回抽送。',
      [entry('茉莉')],
      state,
      [],
    );
    apply(state, out.changes);
    const panties = state.get('茉莉')!.pieces.find((piece) => piece.id === 'panties')!;
    expect(panties.state.exposure).toBe('bare');
    expect(panties.state.arrangement).toBe('pulled_aside');
  });

  it('账本漏判但正文在裸时，保留模型写的 nude；正文只是亲吻仍按账本', () => {
    const state = seeded('茉莉');
    const nude = { ...image('1girl, nude, black hair') } as ImageInsertion;
    enforceClothing(nude, state, false, true, [entry('茉莉')], '她赤裸着身子躺在床上，乳球随着呼吸起伏。');
    expect(nude.characters[0].tag).toContain('nude');

    const kiss = { ...image('1girl, nude, black hair') } as ImageInsertion;
    enforceClothing(kiss, state, false, true, [entry('茉莉')], '他低头吻了她，两人贴近了一些。');
    expect(kiss.characters[0].tag).not.toContain('nude');
    expect(kiss.characters[0].tag).toContain('white camisole');
  });

  it('账本已经记了脱除时，模型写的穿着也压不过账本', () => {
    const state = seeded('茉莉');
    state.get('茉莉')!.pieces.forEach((piece) => {
      piece.state = { location: 'removed' };
    });
    const dressed = { ...image('1girl, white camisole, white panties') } as ImageInsertion;
    enforceClothing(dressed, state, false, true, [entry('茉莉')], '她赤裸着身子。');
    expect(dressed.characters[0].tag).toContain('no shirt');
  });

  function image(charTag: string): ImageInsertion {
    return {
      position: 'P2',
      after: '',
      tag: '1girl, solo, lying, bedroom',
      nl: '',
      negative: '',
      size: 'portrait',
      characters: [{ name: '茉莉', tag: charTag, nl: '' }],
      sourceLine: 0,
      charOffset: 0,
    } as unknown as ImageInsertion;
  }

  function garmentKindOf(design: string): string {
    return garmentKind(design);
  }
});
