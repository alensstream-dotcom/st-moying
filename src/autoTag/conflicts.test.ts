import { describe, it, expect } from 'vitest';
import { collapseAttributes, resolveTagConflicts } from '@/autoTag/conflicts';

describe('同一属性互斥', () => {
  it('短袖与长袖同屏时，以正文为准', () => {
    const out = resolveTagConflicts('1girl, white shirt, short sleeves, long sleeves', '她穿着一件白色短袖衬衣');
    expect(out.tag).toContain('short sleeves');
    expect(out.tag).not.toContain('long sleeves');
    expect(out.notes.join()).toContain('袖长');
  });

  it('正文写长袖时留长袖', () => {
    const out = resolveTagConflicts('white shirt, short sleeves, long sleeves', '白色长袖衬衣');
    expect(out.tag).toContain('long sleeves');
    expect(out.tag).not.toContain('short sleeves');
  });

  it('同一件衣服不会同时写穿着与脱下', () => {
    const out = resolveTagConflicts('1girl, shirt, no shirt, jeans', '她穿着白衬衫');
    expect(out.tag).not.toContain('no shirt');
    expect(out.tag).toContain('shirt');
  });

  it('有男方时不会写 solo', () => {
    const out = resolveTagConflicts('solo, 1girl, 1boy, couch', '他从后面抱住她');
    expect(out.tag).not.toContain('solo');
  });

  it('身上写着衣服且正文没有裸露时去掉裸体词', () => {
    const out = resolveTagConflicts('1girl, white shirt, jeans, naked', '她穿着白衬衫和牛仔裤');
    expect(out.tag).not.toContain('naked');
  });

  it('正文确实写了裸露时保留裸体词', () => {
    const out = resolveTagConflicts('1girl, naked, lying on bed', '她赤裸地躺在床上');
    expect(out.tag).toContain('naked');
  });

  it('没有冲突时不改一个字', () => {
    const tag = '1girl, couch, upper body, white shirt, jeans';
    const out = resolveTagConflicts(tag, '她坐在沙发上');
    expect(out.tag).toBe(tag);
    expect(out.notes).toEqual([]);
  });
});
describe('同类属性合并', () => {
  it('四种头发只留一个，正文点名的优先', () => {
    const out = collapseAttributes(
      '1girl, long hair, brown hair, wavy hair, blonde hair, twin tails',
      '她是一头长直的黑发',
    );
    expect(out.tag).not.toContain('blonde hair');
    expect(out.tag).not.toContain('wavy hair');
    expect(out.tag).toContain('long hair');
    expect(out.notes.length).toBeGreaterThan(0);
  });

  it('体型不会同时写纤细与丰满', () => {
    const out = collapseAttributes('1girl, slender, curvy, tall', '她身材纤细');
    expect(out.tag).toBe('1girl, slender, tall');
  });

  it('没有冲突时不动', () => {
    const tag = '1girl, long hair, black hair, brown eyes';
    expect(collapseAttributes(tag, '').tag).toBe(tag);
  });
});
