import { describe, expect, it } from 'vitest';
import { CANDIDATE_FLOOR, parseCandidates, pruneByCandidates, rankCandidates, scoreCandidate } from '@/autoTag/candidates';

const seg = new Set(['P1', 'P2', 'P3', 'P4']);

const make = (position: string, over: Partial<Record<string, number>> = {}) => ({
  position,
  action: '她在门口回头',
  visible: 3,
  value: 2,
  novelty: 2,
  drawable: 3,
  unsure: 0,
  ...over,
});

describe('候选打分', () => {
  it('权重按 可见3/价值3/新意2/可画1/不确定-3 计', () => {
    expect(scoreCandidate(make('P1') as never)).toBe(9 + 6 + 4 + 3 - 0);
  });

  it('自评为不确定的候选被压下去', () => {
    const sure = make('P1');
    const unsure = make('P2', { unsure: 3 });
    const ranked = rankCandidates(parseCandidates([unsure, sure], seg));
    expect(ranked[0].position).toBe('P1');
  });

  it('位置不在目标段里的候选整条丢掉', () => {
    expect(parseCandidates([make('P9')], seg)).toHaveLength(0);
  });

  it('同一位置重复只留第一条', () => {
    expect(parseCandidates([make('P1'), make('P1', { value: 0 })], seg)).toHaveLength(1);
  });

  it('低分落点被淘汰，高分留下', () => {
    const candidates = parseCandidates([make('P1'), make('P2', { visible: 0, value: 0, novelty: 0, drawable: 0, unsure: 3 })], seg);
    const { images, dropped } = pruneByCandidates([{ position: 'P1' }, { position: 'P2' }], candidates, 3);
    expect(images.map((i) => i.position)).toEqual(['P1']);
    expect(dropped[0].position).toBe('P2');
    expect(CANDIDATE_FLOOR).toBeGreaterThan(0);
  });

  it('不在候选表里的落点也算没论证过', () => {
    const { images } = pruneByCandidates([{ position: 'P3' }], parseCandidates([make('P1')], seg), 3);
    expect(images).toHaveLength(0);
  });

  it('没有候选时原样放行（模型没走这条路就不删图）', () => {
    const { images } = pruneByCandidates([{ position: 'P1' }, { position: 'P2' }], [], 3);
    expect(images).toHaveLength(2);
  });

  it('超上限按分数留高的', () => {
    const candidates = parseCandidates([make('P1', { value: 1 }), make('P2', { value: 3 })], seg);
    const { images } = pruneByCandidates([{ position: 'P1' }, { position: 'P2' }], candidates, 1);
    expect(images.map((i) => i.position)).toEqual(['P2']);
  });
});
