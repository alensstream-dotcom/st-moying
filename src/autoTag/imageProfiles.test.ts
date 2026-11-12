import { describe, expect, it } from 'vitest';

import { emptyCharFields, type CharTagEntry, type CharTagField } from '@/state/charTags';
import type { IdentityFact } from '@/state/characterIdentity';

import { PROVISIONAL_PREFIX, ensureImageProfiles } from './imageProfiles';
import type { ImageInsertion } from './protocol';

function entry(name: string, fields: Partial<Record<CharTagField, string>> = {}): CharTagEntry {
  return {
    name,
    fields: { ...emptyCharFields(), ...fields },
    raw: '',
    nl: '',
    source: 'ai',
    desc: '',
    history: [],
  };
}

function image(
  characters: Array<{ name: string; tag: string; nl?: string }>,
  sourceLine = 0,
): ImageInsertion {
  return {
    position: 'P1',
    sourceLine,
    charOffset: 0,
    tag: '1girl, solo, bedroom',
    nl: '',
    negative: '',
    characters: characters.map((character) => ({
      name: character.name,
      tag: character.tag,
      nl: character.nl ?? '',
    })),
    size: 'portrait',
  };
}

const femaleFact = (name: string, aliases: string[] = []): IdentityFact => ({
  name,
  gender: 'female',
  heroine: true,
  aliases,
  source: 'story',
  evidence: `${name}笑了，她抬起头。`,
  reason: '正文用她指代',
});

describe('ensureImageProfiles 出图即建档', () => {
  it('画面里的女角色没有档案时立刻建档，并把画面里的特征写进去', () => {
    const result = ensureImageProfiles(
      [image([{ name: '苏晚', tag: '1girl, black hair, blue eyes' }], 3)],
      [],
      [],
      3,
      '',
    );
    expect(result.items).toHaveLength(1);
    const op = result.items[0].op;
    expect(op.kind).toBe('new');
    if (op.kind !== 'new') return;
    expect(op.name).toBe('苏晚');
    // hair 里还会被补一个发型（六轴错开），所以只断言原有特征没丢
    expect(op.fields.hair).toContain('black hair');
    expect(op.fields.eyes).toContain('blue eyes');
    expect(op.fields.sex).toBe('1girl');
    expect(result.items[0].sourceLine).toBe(3);
  });

  it('只有指代（少女）时先建占位档案，后面再认领', () => {
    const result = ensureImageProfiles(
      [image([{ name: '少女', tag: '1girl, blonde hair, green eyes' }])],
      [],
      [],
      1,
      '少女抬起头，她笑了。',
    );
    expect(result.items).toHaveLength(1);
    const op = result.items[0].op;
    if (op.kind !== 'new') throw new Error('应建档');
    expect(op.name).toBe(`${PROVISIONAL_PREFIX}1`);
    expect(op.desc).toContain('等真名出现再认领');
  });

  it('后来的真名与占位档案外貌对得上时，改名而不是新建第二条', () => {
    const provisional = entry(`${PROVISIONAL_PREFIX}1`, {
      hair: 'blonde hair',
      eyes: 'green eyes',
    });
    const result = ensureImageProfiles(
      [image([{ name: '林月', tag: '1girl, blonde hair, green eyes' }])],
      [provisional],
      [],
      5,
      '林月笑了。',
    );
    expect(result.items).toHaveLength(1);
    const op = result.items[0].op;
    expect(op.kind).toBe('rename');
    if (op.kind !== 'rename') return;
    expect(op.name).toBe(`${PROVISIONAL_PREFIX}1`);
    expect(op.to).toBe('林月');
  });

  it('外貌对不上的真名不会被错误认领到占位档案', () => {
    const provisional = entry(`${PROVISIONAL_PREFIX}1`, {
      hair: 'blonde hair',
      eyes: 'green eyes',
    });
    const result = ensureImageProfiles(
      [image([{ name: '林月', tag: '1girl, black hair, red eyes' }])],
      [provisional],
      [],
      5,
      '林月笑了。',
    );
    expect(result.items).toHaveLength(1);
    const op = result.items[0].op;
    expect(op.kind).toBe('new');
    if (op.kind !== 'new') return;
    expect(op.name).toBe('林月');
  });

  it('画面里用了同一角色的别的称呼时，把它交给别名表', () => {
    const result = ensureImageProfiles(
      [image([{ name: '晚晚', tag: '1girl, black hair' }])],
      [entry('苏晚', { hair: 'black hair' })],
      [femaleFact('苏晚', ['晚晚'])],
      2,
      '',
    );
    expect(result.items).toHaveLength(0);
    expect(result.aliases).toEqual([['苏晚', '晚晚']]);
  });

  it('男性不建档', () => {
    const result = ensureImageProfiles(
      [image([{ name: '张明', tag: '1boy, male, black hair' }])],
      [],
      [],
      1,
      '',
    );
    expect(result.items).toHaveLength(0);
  });

  it('锁定角色不会被自动覆盖', () => {
    const result = ensureImageProfiles(
      [image([{ name: '苏晚', tag: '1girl, black hair' }])],
      [],
      [],
      1,
      '',
      { locked: new Set(['苏晚']) },
    );
    expect(result.items).toHaveLength(0);
  });

  it('没有角色块的图不产生档案', () => {
    const result = ensureImageProfiles([image([])], [], [], 1, '');
    expect(result.items).toHaveLength(0);
  });

  it('已有档案只补空白外貌字段，不覆盖用户已写的值', () => {
    const saved = entry('苏晚', { hair: 'black hair' });
    const result = ensureImageProfiles(
      [image([{ name: '苏晚', tag: '1girl, red hair, blue eyes' }])],
      [saved],
      [],
      4,
      '',
    );
    expect(result.items).toHaveLength(1);
    const op = result.items[0].op;
    expect(op.kind).toBe('set');
    if (op.kind !== 'set') return;
    expect(op.field).toBe('eyes');
    expect(op.value).toBe('blue eyes');
  });

  it('同一位无名女子出现在多张图里只建一条占位档案', () => {
    const result = ensureImageProfiles(
      [
        image([{ name: '少女', tag: '1girl, blonde hair, green eyes' }], 1),
        image([{ name: '少女', tag: '1girl, blonde hair, green eyes, smile' }], 4),
      ],
      [],
      [],
      1,
      '少女抬起头，她笑了。',
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].op.kind).toBe('new');
  });
});
