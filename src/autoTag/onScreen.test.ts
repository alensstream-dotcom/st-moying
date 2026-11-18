import { describe, it, expect } from 'vitest';
import { isNarratedOnly } from './onScreen';

describe('isNarratedOnly', () => {
  it('只有盘算的一段不算画面', () => {
    expect(
      isNarratedOnly('回到书房，李斌点了一根烟，开始思索如何攻略小姨子温岚。心急吃不了热豆腐，得一步步来。通过买奶茶这一点让他想起来。'),
    ).toBe(true);
  });

  it('有当下动作照常放行', () => {
    expect(isNarratedOnly('温岚坐在沙发上，握着奶茶杯瞪了他一眼。')).toBe(false);
  });

  it('没有动作也没有计划词的叙述不当成计划', () => {
    expect(isNarratedOnly('房间里很安静。')).toBe(false);
  });

  it('回忆里带动作词也放行（词表只守最窄的一类）', () => {
    expect(isNarratedOnly('他回忆起她当时推开门的样子。')).toBe(false);
  });
});
