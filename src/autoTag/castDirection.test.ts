import { describe, expect, it } from 'vitest';
import { diagnoseDirection } from './castCheck';

const characters = (...items: Array<[string, string]>) => items.map(([name, tag]) => ({ name, tag }));

describe('施受方向', () => {
  it('正文是女主主动,却把 source# 挂在男主块上 → 报警', () => {
    const gaps = diagnoseDirection(
      '她主动跨坐上去，双手按住他的胸口。',
      characters(['林晚晴', 'girl, large breasts, target#held down, blush'], ['陆沉', '1boy, source#pinning her wrists']),
      ['陆沉'],
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].detail).toContain('施受方向反了');
  });

  it('女主自己挂 source# 时视为正确,不报警', () => {
    const gaps = diagnoseDirection(
      '她主动跨坐上去，双手按住他的胸口。',
      characters(['林晚晴', 'girl, source#straddling him, hands on his chest'], ['陆沉', '1boy, lying on back']),
      ['陆沉'],
    );
    expect(gaps).toEqual([]);
  });

  it('正文没写谁主动时不猜', () => {
    const gaps = diagnoseDirection(
      '两人纠缠在一起。',
      characters(['林晚晴', 'girl, target#held down'], ['陆沉', '1boy, source#pressing']),
      ['陆沉'],
    );
    expect(gaps).toEqual([]);
  });

  it('单人图不会触发方向判定', () => {
    const gaps = diagnoseDirection(
      '她主动俯下身。',
      characters(['林晚晴', 'girl, source#kneeling']),
      ['陆沉'],
    );
    expect(gaps).toEqual([]);
  });
});
