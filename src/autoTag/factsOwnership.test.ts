import { describe, it, expect } from 'vitest';
import { gateFactOwnership, type StoryFact } from '@/autoTag/facts';

const fact = (p: Partial<StoryFact>): StoryFact => ({
  subject: p.subject ?? '温岚',
  kind: p.kind ?? 'state',
  value: p.value ?? '',
  evidence: p.evidence ?? '',
  confidence: p.confidence ?? 'explicit',
});

describe('事实归属闸门', () => {
  it('别人身上挂着她的内裤时，这条事实不算她的', () => {
    const out = gateFactOwnership(
      [fact({ value: 'undergarment and stockings removed', evidence: '依旧还保持着充血状态的肉棒上挂着黏糊糊的小姨子的内裤和丝袜。' })],
      ['温岚'],
    );
    expect(out).toHaveLength(0);
  });

  it('她自己的脱衣动作保留', () => {
    const out = gateFactOwnership([fact({ value: 'shirt removed', evidence: '温岚解开扣子，把衬衫脱下放在椅背上。' })], ['温岚']);
    expect(out).toHaveLength(1);
  });

  it('代词指她且没有别人当主语时保留', () => {
    const out = gateFactOwnership([fact({ value: 'skirt lifted', evidence: '她掀起裙摆，靠在洗手台边。' })], ['温岚']);
    expect(out).toHaveLength(1);
  });

  it('他动手、她的名字只是领属时不保留', () => {
    const out = gateFactOwnership([fact({ value: 'bra pulled down', evidence: '他伸手把温岚的胸罩拉下来。' })], ['温岚']);
    expect(out).toHaveLength(0);
  });

  it('地点与身体事实不经过闸门', () => {
    const out = gateFactOwnership([fact({ kind: 'place', value: 'house', evidence: '孤男寡女同处一个房子内' })], ['温岚']);
    expect(out).toHaveLength(1);
  });
});
