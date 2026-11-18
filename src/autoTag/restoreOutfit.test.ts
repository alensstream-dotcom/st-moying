import { describe, expect, it } from 'vitest';

import { rememberCompleteOutfit, restoreOutfitFacts } from '@/autoTag/facts';
import { buildFloorTrace } from '@/autoTag/trace';
import type { ClothingState } from '@/autoTag/outfitTimeline';

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
