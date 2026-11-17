import { describe, it, expect } from 'vitest';
import { dedupeFacts, type StoryFact } from '@/autoTag/facts';
import { needsFromFacts } from '@/autoTag/shotCoverage';

const fact = (p: Partial<StoryFact>): StoryFact => ({
  subject: p.subject ?? '温岚',
  kind: p.kind ?? 'wear',
  value: p.value ?? '',
  evidence: p.evidence ?? '',
  confidence: p.confidence ?? 'explicit',
});

describe('事实层：去重与可见性', () => {
  it('同一主语同一值只留一条，explicit 压过 inherited', () => {
    const out = dedupeFacts([
      fact({ value: 'white shirt', confidence: 'inherited' }),
      fact({ value: 'White Shirt', confidence: 'explicit' }),
      fact({ value: 'jeans', confidence: 'inherited' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.value.toLowerCase() === 'white shirt')?.confidence).toBe('explicit');
  });

  it('不同类别的同一个值不算重复', () => {
    const out = dedupeFacts([
      fact({ kind: 'wear', value: 'white shirt' }),
      fact({ kind: 'state', value: 'white shirt' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('动作事实提到手，要求画面装得下手', () => {
    expect(needsFromFacts([fact({ kind: 'action', value: 'her hand pressing against his chest' })]).hands).toBe(true);
  });

  it('动作事实提到小腿，要求下半身入画', () => {
    expect(needsFromFacts([fact({ kind: 'body', value: '她的小腿贴在沙发边' })]).lower).toBe(true);
  });

  it('只有穿着事实时不额外要求构图', () => {
    const needs = needsFromFacts([fact({ kind: 'wear', value: 'white shirt' })]);
    expect(needs).toEqual({ lower: false, upper: false, face: false, hands: false });
  });
});
