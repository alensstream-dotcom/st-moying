import { describe, expect, it } from 'vitest';
import {
  buildCharReuseBlock,
  candidateAliasesForEntry,
  findCharAliases,
  findCharReuse,
  normalizePlanCharacters,
  resolveCanonicalCharName,
} from '@/autoTag/charReuse';
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

describe('同人异称归并（尊称/简称/关系称呼 → 档案主名）', () => {
  it('把姓氏+尊称与直呼其名唯一归并回已建档角色主名（如风阿姨/千华 → 风千华）', () => {
    const entries = [
      entry('风千华', {
        age: 'mature female',
        hair: 'long black hair',
        eyes: 'amber eyes',
        body: 'voluptuous, wide hips',
      }),
    ];
    expect(candidateAliasesForEntry(entries[0])).toEqual(
      expect.arrayContaining(['风阿姨', '风姨', '风姐', '风夫人', '风妈妈', '千华', '千华姐']),
    );
    expect(resolveCanonicalCharName('风阿姨', entries)).toBe('风千华');
    expect(resolveCanonicalCharName('千华', entries)).toBe('风千华');
    expect(resolveCanonicalCharName('风千华', entries)).toBe('风千华');
    expect(resolveCanonicalCharName('三年级队长', entries)).toBe('三年级队长');
  });

  it('同姓多角色时不盲猜姓氏尊称，但名字简称仍唯一归并', () => {
    const entries = [
      entry('风千华', { hair: 'long black hair', eyes: 'amber eyes' }),
      entry('风铃', { hair: 'short pink hair', eyes: 'blue eyes' }),
    ];
    // 两个姓风的角色，「风姐」无法唯一区分时不强行合到某一人身上
    expect(resolveCanonicalCharName('风姐', entries)).toBe('风姐');
    // 但「千华」唯一指向「风千华」
    expect(resolveCanonicalCharName('千华', entries)).toBe('风千华');
  });

  it('扫描正文里的同源别称并生成强约束提示块', () => {
    const entries = [
      entry('风千华', { hair: 'long black hair', eyes: 'amber eyes' }),
    ];
    const hits = findCharAliases(entries, '风阿姨轻轻叹了口气，你叫了声千华姐，她回头看向你。');
    expect(hits).toEqual([
      {
        name: '风千华',
        aliases: expect.arrayContaining(['风阿姨', '千华姐']),
      },
    ]);
    const block = buildCharReuseBlock([], hits);
    expect(block).toContain('【本段正文同人异称归并】');
    expect(block).toContain('风阿姨');
    expect(block).toContain('风千华');
  });

  it('normalizePlanCharacters 将别称改回主名，并在模型因换称呼乱编外貌时用档案字段修正', () => {
    const entries = [
      entry('风千华', {
        age: 'mature female',
        hair: 'long black hair, hime cut',
        eyes: 'purple eyes',
        body: 'voluptuous, wide hips',
      }),
    ];
    const images = [
      {
        characters: [
          {
            name: '风阿姨',
            // 模拟模型把「风阿姨」当成未建档角色，自己乱写了 brown hair, brown eyes 且漏了体型
            tag: 'girl, short brown hair, brown eyes, white apron, smiling, looking at viewer',
          },
        ],
      },
    ];
    normalizePlanCharacters(images, entries);
    expect(images[0].characters[0].name).toBe('风千华');
    expect(images[0].characters[0].tag).toContain('long black hair');
    expect(images[0].characters[0].tag).toContain('hime cut');
    expect(images[0].characters[0].tag).toContain('purple eyes');
    expect(images[0].characters[0].tag).toContain('mature female');
    expect(images[0].characters[0].tag).toContain('voluptuous');
    expect(images[0].characters[0].tag).not.toContain('short brown hair');
    expect(images[0].characters[0].tag).not.toContain('brown eyes');
    expect(images[0].characters[0].tag).toContain('white apron');
  });
});
