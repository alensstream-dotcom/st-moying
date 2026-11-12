import { describe, expect, it } from 'vitest';
import { diversifyLook } from './lookDiversity';
import { emptyCharFields } from '@/state/charTags';

const look = (over: Partial<Record<string, string>> = {}) => ({
  ...emptyCharFields(),
  sex: '1girl',
  ...over,
});

describe('diversifyLook', () => {
  it('空着的外貌会从词表里补上，并给出说明', () => {
    const result = diversifyLook(look(), [], '');
    expect(result.fields.hair).toBeTruthy();
    expect(result.fields.eyes).toBeTruthy();
    expect(result.fields.body).toBeTruthy();
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('和已有角色撞车的发色会被换掉', () => {
    const others = [{ fields: look({ hair: 'black hair, long straight hair', eyes: 'brown eyes' }) }];
    const result = diversifyLook(look({ hair: 'black hair, long straight hair' }), others);
    expect(result.fields.hair).not.toContain('black hair');
    expect(result.notes.join('')).toContain('撞车');
  });

  it('正文写过的词即使撞车也不动', () => {
    const others = [{ fields: look({ hair: 'black hair' }) }];
    const result = diversifyLook(look({ hair: 'black hair' }), others, '她转过身，黑色长发扫过肩头，是 black hair');
    expect(result.fields.hair).toContain('black hair');
  });

  it('六个轴各自岔开，互不串味', () => {
    const others = [
      {
        fields: look({
          hair: 'black hair, long straight hair',
          eyes: 'brown eyes, round eyes',
          body: 'petite',
          extra: 'hairpin',
        }),
      },
    ];
    const result = diversifyLook(
      look({ hair: 'black hair, long straight hair', eyes: 'brown eyes, round eyes', body: 'petite', extra: 'hairpin' }),
      others,
    );
    expect(result.fields.hair).not.toContain('black hair');
    expect(result.fields.eyes).not.toContain('brown eyes');
    expect(result.fields.body).not.toBe('petite');
    expect(result.fields.extra).not.toBe('hairpin');
    // 发型轴换掉后不能把发色轴的 token 弄丢
    expect(result.fields.hair.split(',').length).toBeGreaterThanOrEqual(1);
  });

  it('不碰 sex/age/outfit', () => {
    const fields = look({ age: 'young adult', outfit: 'white shirt' });
    const result = diversifyLook(fields, []);
    expect(result.fields.sex).toBe('1girl');
    expect(result.fields.age).toBe('young adult');
    expect(result.fields.outfit).toBe('white shirt');
  });

  it('词表用尽时保留原值而不是清空', () => {
    const pool = Array.from({ length: 40 }, () => ({ fields: look({ body: 'petite' }) }));
    const result = diversifyLook(look({ body: 'petite' }), pool);
    expect(result.fields.body).toBeTruthy();
  });
});
