import { describe, expect, it } from 'vitest';
import {
  adjacentPositionNote,
  adjacentPositions,
  duplicatePositionNote,
  duplicatePositions,
} from '@/autoTag/positionCheck';

describe('positionCheck 落位重复', () => {
  it('两个地址一样就算重复', () => {
    expect(duplicatePositions([{ position: 'P3' }, { position: 'P9' }, { position: 'P3' }], 12)).toEqual([
      'P3',
    ]);
  });

  it('同一个地址出现三次只报一次', () => {
    expect(duplicatePositions([{ position: 'P2' }, { position: 'P2' }, { position: 'P2' }], 12)).toEqual([
      'P2',
    ]);
    expect(duplicatePositionNote(['P2']).includes('P2')).toBe(true);
  });

  it('全都不同时不报', () => {
    expect(duplicatePositions([{ position: 'P1' }, { position: 'P4' }], 12)).toEqual([]);
  });

  it('位置不够分时允许重叠', () => {
    // 只有两段却要三张图,重复是必然的,不算错。
    expect(duplicatePositions([{ position: 'P1' }, { position: 'P1' }, { position: 'P2' }], 2)).toEqual(
      [],
    );
  });

  it('位置恰好等于图数时仍然查重', () => {
    expect(duplicatePositions([{ position: 'P1' }, { position: 'P1' }], 2)).toEqual(['P1']);
  });

  it('空位置跳过', () => {
    expect(duplicatePositions([{ position: '' }, { position: '' }, { position: 'P1' }], 5)).toEqual([]);
  });

  it('补救指令要求保张数、只挪位置', () => {
    const note = duplicatePositionNote(['P4']);
    expect(note).toContain('张数不变');
    expect(note).toContain('P4');
    expect(note).toContain('<position_retry>');
  });

  it('句数充裕时拦截紧邻的前后两句(如 P5 与 P6)', () => {
    expect(adjacentPositions([{ position: 'P5' }, { position: 'P6' }], 12)).toEqual([
      ['P5', 'P6'],
    ]);
    expect(adjacentPositions([{ position: 'P2' }, { position: 'P7' }], 12)).toEqual([]);
    // 句数较少(< 8)时允许相邻句
    expect(adjacentPositions([{ position: 'P2' }, { position: 'P3' }], 5)).toEqual([]);
    const note = adjacentPositionNote([['P5', 'P6']]);
    expect(note).toContain('P5 与 P6');
    expect(note).toContain('<position_retry>');
  });
});
