import { describe, expect, it } from 'vitest';
import { buildCharReuseBlock, findCharReuse } from '@/autoTag/charReuse';
import { emptyCharFields, type CharTagEntry } from '@/state/charTags';

const entry = (name: string, fields: Partial<CharTagEntry['fields']>): CharTagEntry => ({
  name,
  fields: { ...emptyCharFields(), ...fields },
  raw: '',
  nl: '',
  source: 'ai',
  desc: '',
  history: [],
});

describe('建档角色直接复用', () => {
  it('正文外形与档案逐项对上时点名认人', () => {
    const entries = [entry('小雪', { hair: 'silver hair, long hair', eyes: 'purple eyes', body: 'elf, slim' })];
    const reuse = findCharReuse(entries, '银白长发、紫瞳的精灵少女抬起头');
    expect(reuse.map(item => item.name)).toEqual(['小雪']);
    expect(reuse[0].dimensions).toContain('发色');
    expect(reuse[0].dimensions).toContain('瞳色');
  });

  it('瞳色撞了就当另一个人,不认', () => {
    const entries = [entry('小雪', { hair: 'silver hair, long hair', eyes: 'gold eyes', body: 'elf' })];
    expect(findCharReuse(entries, '银白长发紫瞳的精灵')).toEqual([]);
  });

  it('只对上发色瞳色两维不够,至少三维才认人', () => {
    const entries = [entry('小雪', { hair: 'silver hair', eyes: 'purple eyes' })];
    expect(findCharReuse(entries, '银白长发紫瞳')).toEqual([]);
  });

  it('三维里必须含发色或瞳色,光凭种族体格不认人', () => {
    // 精灵 + 丰腴 + 泪痣凑够三维,但发色瞳色都没对上。
    const entries = [entry('某人', { body: 'elf, voluptuous', extra: 'mole' })];
    expect(findCharReuse(entries, '粉发蓝瞳的精灵')).toEqual([]);
  });

  it('命中维度多的排在前面', () => {
    const entries = [
      entry('甲', { hair: 'white hair', eyes: 'purple eyes', body: 'elf' }),
      entry('乙', { hair: 'white hair', eyes: 'purple eyes', body: 'elf, slim, tall', extra: 'mole' }),
    ];
    const reuse = findCharReuse(entries, '银白长发紫瞳的高个精灵，眼下有痣');
    expect(reuse.map(item => item.name)).toEqual(['乙', '甲']);
  });

  it('outfit 不参与认人,否则换一件衣服就认不出', () => {
    const entries = [entry('小雪', { hair: 'silver hair, long hair', eyes: 'purple eyes', outfit: 'school uniform' })];
    expect(findCharReuse(entries, '银白长发紫瞳的精灵')).toHaveLength(1);
  });

  it('渲染块写明「别重建档」,空名单不占上下文', () => {
    const block = buildCharReuseBlock([{ name: '小雪', dimensions: '发色、瞳色、种族', matched: 3 }]);
    expect(block).toContain('小雪');
    expect(block).toContain('发色、瞳色、种族');
    expect(block).toContain('field:"new"');
    expect(buildCharReuseBlock([])).toBe('');
  });
});
