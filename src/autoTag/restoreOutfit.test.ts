import { describe, expect, it } from 'vitest';

import { rememberCompleteOutfit, restoreOutfitFacts, detectOutfitEvents } from '@/autoTag/facts';
import type { ClothingPiece, ClothingRecord, ClothingState } from '@/autoTag/outfitTimeline';
import { buildFloorTrace } from '@/autoTag/trace';

function state(): ClothingState {
  return new Map([
    [
      '温岚',
      {
        name: '温岚',
        outfitId: 'facts-温岚',
        source: 'facts',
        pieces: [
          { id: 'shirt', design: 'white shirt, short sleeves', state: { location: 'worn' }, garmentId: '温岚#g1' },
          { id: 'skirt', design: 'pleated skirt', state: { location: 'worn' }, garmentId: '温岚#g2' },
        ],
      },
    ],
  ]);
}

describe('最近完整穿搭', () => {
  it('穿整齐时记下快照，半脱时不覆盖', () => {
    const wardrobe = state();
    expect(rememberCompleteOutfit(wardrobe, 3)).toEqual(['温岚']);
    expect(wardrobe.get('温岚')?.lastComplete?.length).toBe(2);

    const lifted = state();
    lifted.get('温岚')!.pieces[0].state = { location: 'worn', arrangement: 'lifted', exposure: 'bare' };
    expect(rememberCompleteOutfit(lifted, 4)).toEqual([]);
    expect(lifted.get('温岚')?.lastComplete).toBeUndefined();
  });

  it('跨场景只复原没穿齐的人', () => {
    const wardrobe = state();
    rememberCompleteOutfit(wardrobe, 3);
    const record = wardrobe.get('温岚')!;
    record.pieces = record.pieces.map((piece) => ({ ...piece, state: { location: 'removed' } }));

    const { facts, restored } = restoreOutfitFacts(wardrobe, '第二天');
    expect(restored).toEqual(['温岚']);
    expect(facts.map((fact) => fact.value)).toEqual(['white shirt, short sleeves', 'pleated skirt']);
    expect(facts.every((fact) => fact.confidence === 'inherited')).toBe(true);

    const dressed = state();
    rememberCompleteOutfit(dressed, 3);
    expect(restoreOutfitFacts(dressed, '第二天').restored).toEqual([]);
  });
});

describe('诊断轨迹', () => {
  it('留下原文与终稿、选中句子与穿搭', () => {
    const trace = buildFloorTrace({
      floor: 2,
      facts: [{ subject: '温岚', kind: 'wear', value: 'shirt', evidence: '白衬衫', confidence: 'explicit' }],
      images: [
        {
          position: 'P2',
          candidateId: 'P2',
          frameAction: '她把信封递出去',
          tag: '1girl, upper body',
          nl: 'She holds out the envelope.',
          characters: [{ name: '温岚', tag: 'white shirt', nl: 'She holds the envelope out.' }],
        },
      ],
      original: new Map([['P2', { nl: 'She is wearing white shirt, collared shirt.', characters: [{ name: '温岚', nl: 'Wearing white shirt.' }] }]]),
      wardrobe: state(),
      segmentOf: (position) => (position === 'P2' ? '她把信封递到他手里。' : ''),
    });
    expect(trace.facts).toBe(1);
    expect(trace.images[0].segment).toBe('她把信封递到他手里。');
    expect(trace.images[0].nlOriginal).toContain('wearing white shirt');
    expect(trace.images[0].characters[0].outfit).toContain('white shirt, short sleeves');
  });
});

describe('服装事件', () => {
  const piece = (id: string, design: string, state: Record<string, string>): ClothingPiece =>
    ({ id, design, state }) as ClothingPiece;
  const record = (name: string, pieces: ClothingPiece[], lastComplete: ClothingPiece[]): ClothingRecord =>
    ({ name, pieces, lastComplete }) as ClothingRecord;

  it('跨场景时把「复原」写成带人物、套装与地点的事件', () => {
    const state: ClothingState = new Map<string, ClothingRecord>([
      [
        '温岚',
        record(
          '温岚',
          [piece('shirt', 'white shirt', { location: 'worn', arrangement: 'lifted', exposure: 'bare' }), piece('pants', 'denim shorts', { location: 'worn' })],
          [piece('shirt', 'white shirt', { location: 'worn' }), piece('pants', 'denim shorts', { location: 'worn' })],
        ),
      ],
    ]);
    const events = detectOutfitEvents('第二天清晨，她推开楼道的门走出去。', state, 'hallway');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'restore', subject: '温岚', place: 'hallway' });
    expect(events[0].outfit).toEqual(['white shirt', 'denim shorts']);
    expect(events[0].evidence).toContain('hallway');
  });

  it('穿得整整齐齐时不产生复原事件', () => {
    const state: ClothingState = new Map<string, ClothingRecord>([
      ['温岚', record('温岚', [piece('shirt', 'white shirt', { location: 'worn' })], [piece('shirt', 'white shirt', { location: 'worn' })])],
    ]);
    expect(detectOutfitEvents('她坐在沙发上喝奶茶。', state, 'living room')).toEqual([]);
  });
});
