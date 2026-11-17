import { describe, expect, it } from 'vitest';
import {
  factsAcrossSceneBreak,
  factsBackedByLedger,
  factsBlock,
  parseFacts,
  repairByFacts,
  stripExposureTokens,
  dropExposureClaims,
  factsToClothingChanges,
  type StoryFact,
} from '@/autoTag/facts';
import type { ImageInsertion } from '@/autoTag/protocol';

const names = new Set(['温岚', 'scene']);

const image = (tag: string): ImageInsertion =>
  ({
    position: 'P1',
    sourceLine: 0,
    charOffset: 0,
    tag: '1girl, bedroom',
    nl: '',
    negative: '',
    characters: [{ name: '温岚', tag, nl: '' }],
    size: 'portrait',
  }) as unknown as ImageInsertion;

describe('事实表', () => {
  it('收下合法条目、丢掉坏 kind 与幻觉人名', () => {
    const facts = parseFacts(
      [
        { subject: '温岚', kind: 'wear', value: 'white shirt', evidence: '白衬衫', confidence: 'explicit' },
        { subject: '温岚', kind: 'mood', value: 'sad' },
        { subject: '路人甲', kind: 'wear', value: 'hat' },
        { subject: 'scene', kind: 'place', value: 'stairs' },
      ],
      names,
    );
    expect(facts.map((f) => f.value)).toEqual(['white shirt', 'stairs']);
    expect(facts[1].subject).toBe('scene');
  });

  it('confidence 非法退回 unknown', () => {
    const facts = parseFacts([{ subject: '温岚', kind: 'state', value: 'breasts out', confidence: 'pretty sure' }], names);
    expect(facts[0].confidence).toBe('unknown');
  });

  it('明确穿着事实否定裸体词，只做减法', () => {
    const facts: StoryFact[] = [
      { subject: '温岚', kind: 'wear', value: 'white shirt', evidence: '白衬衫', confidence: 'explicit' },
    ];
    const target = image('1girl, naked, nipples, white shirt, jeans');
    const changes = repairByFacts(target, facts);
    expect(changes).toHaveLength(1);
    expect(target.characters[0].tag).toBe('1girl, white shirt, jeans');
  });

  it('有裸露事实时不推翻', () => {
    const facts: StoryFact[] = [
      { subject: '温岚', kind: 'state', value: 'nude', evidence: '一丝不挂', confidence: 'explicit' },
    ];
    const target = image('1girl, naked, nipples');
    expect(repairByFacts(target, facts)).toHaveLength(0);
    expect(target.characters[0].tag).toContain('naked');
  });

  it('factsBlock 带出处，便于重试沿用', () => {
    const block = factsBlock([
      { subject: '温岚', kind: 'wear', value: 'white shirt', evidence: '白衬衫', confidence: 'explicit' },
      { subject: 'scene', kind: 'place', value: 'stairs', evidence: '', confidence: 'inherited' },
    ]);
    expect(block).toContain('温岚 · wear · white shirt');
    expect(block).toContain('原文：白衬衫');
    expect(block).toContain('[inherited]');
  });
});

describe('事实表回写账本', () => {
  it('明确写着穿着时，把账本里的 removed 改回 worn', async () => {
    const { applyExplicitFacts } = await import('@/autoTag/outfitTimeline');
    const state = new Map([
      [
        '温岚',
        {
          name: '温岚',
          outfitId: 'o1',
          source: '',
          pieces: [{ id: 'shirt', design: 'white shirt', state: { location: 'removed' } }],
        },
      ],
    ]);
    const facts: StoryFact[] = [
      { subject: '温岚', kind: 'wear', value: 'white shirt', evidence: '白衬衫', confidence: 'explicit' },
    ];
    const lines = applyExplicitFacts(state as never, facts);
    expect(lines).toHaveLength(1);
    expect(state.get('温岚')!.pieces[0].state.location).toBe('worn');
  });

  it('继承来的事实不足以改动账本', async () => {
    const { applyExplicitFacts } = await import('@/autoTag/outfitTimeline');
    const state = new Map([
      [
        '温岚',
        {
          name: '温岚',
          outfitId: 'o1',
          source: '',
          pieces: [{ id: 'shirt', design: 'white shirt', state: { location: 'removed' } }],
        },
      ],
    ]);
    const facts: StoryFact[] = [
      { subject: '温岚', kind: 'wear', value: 'white shirt', evidence: '', confidence: 'inherited' },
    ];
    expect(applyExplicitFacts(state as never, facts)).toHaveLength(0);
    expect(state.get('温岚')!.pieces[0].state.location).toBe('removed');
  });
});

describe('跨场景继承', () => {
  it('新的一天丢掉继承的露点事实，保留 explicit 的', () => {
    const facts: StoryFact[] = [
      { subject: '温岚', kind: 'state', value: 'shirt lift, breasts out', evidence: '', confidence: 'inherited' },
      { subject: '温岚', kind: 'state', value: 'breasts out', evidence: '她敞着怀', confidence: 'explicit' },
      { subject: '温岚', kind: 'wear', value: 'jeans', evidence: '', confidence: 'inherited' },
    ];
    const kept = factsAcrossSceneBreak(facts, true);
    expect(kept.map((f) => f.value)).toEqual(['breasts out', 'jeans']);
    expect(factsAcrossSceneBreak(facts, false)).toHaveLength(3);
  });

  it('tag 里的继承露点词一并摘掉', () => {
    expect(stripExposureTokens('1girl, shirt lift, pink bra, breasts out, jeans')).toBe('1girl, pink bra, jeans');
  });
});

describe('账本背书', () => {
  it('账本没有任何露着状态时，继承的露点事实被丢掉', () => {
    const facts: StoryFact[] = [
      { subject: '温岚', kind: 'state', value: 'shirt lift, breasts out', evidence: '', confidence: 'inherited' },
      { subject: '温岚', kind: 'wear', value: 'white shirt', evidence: '', confidence: 'inherited' },
      { subject: '温岚', kind: 'state', value: 'breasts out', evidence: '她敞着怀', confidence: 'explicit' },
    ];
    const kept = factsBackedByLedger(facts, () => false);
    expect(kept.map((f) => f.value)).toEqual(['white shirt', 'breasts out']);
  });

  it('账本里她还露着时，继承的露点事实保留', () => {
    const facts: StoryFact[] = [
      { subject: '温岚', kind: 'state', value: 'breasts out', evidence: '', confidence: 'inherited' },
    ];
    expect(factsBackedByLedger(facts, () => true)).toHaveLength(1);
  });
});

describe('nl 露点句', () => {
  it('删掉自相矛盾的句子，保留其余', () => {
    const nl = 'She walks forward with a backpack. Her lifted top leaves her chest exposed. The hallway lights flicker on.';
    expect(dropExposureClaims(nl)).toBe('She walks forward with a backpack. The hallway lights flicker on.');
  });

  it('没有露点句时原样返回', () => {
    const nl = 'She steps into the hallway with her backpack.';
    expect(dropExposureClaims(nl)).toBe(nl);
  });
});

describe('事实 → 服装变更（唯一入口）', () => {
  const seg = [{ id: 'P3' }];
  it('穿着事实带状态合成一条 patch', () => {
    const changes = factsToClothingChanges(
      [
        { subject: '温岚', kind: 'wear', value: 'white shirt', evidence: '白衬衫', confidence: 'explicit' },
        { subject: '温岚', kind: 'state', value: 'shirt lift', evidence: '掀起来', confidence: 'explicit' },
      ],
      seg,
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].position).toBe('P3');
    expect(changes[0].pieces?.[0].state).toMatchObject({ location: 'worn', arrangement: 'lifted' });
  });

  it('没有穿着事实时按状态补一条（no bra）', () => {
    const changes = factsToClothingChanges(
      [{ subject: '温岚', kind: 'state', value: 'no bra', evidence: '没穿胸罩', confidence: 'explicit' }],
      seg,
    );
    expect(changes[0].pieces?.[0].state.location).toBe('removed');
  });

  it('unknown 与 scene 不进账本', () => {
    expect(
      factsToClothingChanges(
        [
          { subject: '温岚', kind: 'wear', value: 'shirt', evidence: '', confidence: 'unknown' },
          { subject: 'scene', kind: 'state', value: 'rain', evidence: '', confidence: 'explicit' },
        ],
        seg,
      ),
    ).toHaveLength(0);
  });
});
describe('事实 → 服装变更：件名与状态词', () => {
  const seg = [{ id: 'P1' }];
  it('「shirt lift」不会变成一件独立衣服，件名用类别', () => {
    const changes = factsToClothingChanges(
      [
        { subject: '温岚', kind: 'wear', value: 'white shirt', evidence: '白衬衫', confidence: 'explicit' },
        { subject: '温岚', kind: 'state', value: 'shirt lift', evidence: '掀起来', confidence: 'explicit' },
        { subject: '温岚', kind: 'state', value: 'breasts out', evidence: '露胸', confidence: 'explicit' },
      ],
      seg,
    );
    const pieces = changes[0].pieces ?? [];
    expect(pieces.map((p) => p.id)).toEqual(['shirt']);
    expect(pieces[0].state).toMatchObject({ location: 'worn', arrangement: 'lifted', exposure: 'bare' });
  });
});
