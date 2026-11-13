import { describe, expect, it, vi } from 'vitest';
import { enforceAppearance } from '@/autoTag/appearanceLock';
import type { ImageInsertion } from '@/autoTag/protocol';
import { emptyCharFields, type CharTagEntry } from '@/state/charTags';

vi.mock('@/st/context', () => ({ getContext: () => ({ chat: [], chatMetadata: {} }) }));

const entry = (over: Partial<CharTagEntry> = {}): CharTagEntry => ({
  name: '苏晚晴',
  fields: emptyCharFields(),
  raw: '',
  nl: '',
  source: 'ai',
  desc: '',
  history: [],
  ...over,
});

const image = (tag: string, characterTag: string): ImageInsertion => ({
  position: 'P1',
  sourceLine: 0,
  charOffset: 10,
  tag,
  nl: '',
  negative: '',
  characters: [{ name: '苏晚晴', tag: characterTag, nl: '' }],
  size: 'portrait',
});

describe('enforceAppearance 用角色库锁死同一身外貌', () => {
  it('结构化字段齐全时两张互相冲突的图收敛到同一套外貌', () => {
    const profile = entry({
      fields: {
        ...emptyCharFields(),
        sex: '1girl',
        hair: 'long silver hair',
        eyes: 'purple eyes',
      },
    });
    const a = image('1girl, black hair, blue eyes, red dress', '1girl, black hair, blue eyes');
    const b = image('1girl, blonde hair, green eyes, school uniform', '1girl, blonde hair, green eyes');
    enforceAppearance(a, [profile], false, true, []);
    enforceAppearance(b, [profile], false, true, []);
    expect(a.characters[0].tag).toBe(b.characters[0].tag);
    expect(a.characters[0].tag).toContain('long silver hair');
    expect(a.characters[0].tag).toContain('purple eyes');
    expect(a.tag).not.toContain('black hair');
    expect(b.tag).not.toContain('blonde hair');
  });

  it('只有 raw、结构化字段全空的老库条目也能锁定', () => {
    const profile = entry({ raw: '1girl, long silver hair, purple eyes' });
    const a = image('1girl, black hair, blue eyes, red dress', '1girl, black hair, blue eyes');
    enforceAppearance(a, [profile], false, true, []);
    expect(a.characters[0].tag).toContain('long silver hair');
    expect(a.characters[0].tag).toContain('purple eyes');
    expect(a.characters[0].tag).not.toContain('black hair');
  });

  it('库里没有这个角色时保持模型原样，不凭空发明外貌', () => {
    const a = image('1girl, black hair, blue eyes', '1girl, black hair, blue eyes');
    enforceAppearance(a, [], false, true, []);
    expect(a.characters[0].tag).toBe('1girl, black hair, blue eyes');
  });

  it('年龄档带出骨架词,同一个人不会一会儿小孩一会儿成人', () => {
    const girl = entry({
      fields: { ...emptyCharFields(), sex: '1girl', age: 'child', hair: 'long black hair' },
    });
    const a = image('1girl, solo, sitting', '1girl, sitting');
    const b = image('1girl, solo, standing', '1girl, standing, tall');
    enforceAppearance(a, [girl], false, true, []);
    enforceAppearance(b, [girl], false, true, []);
    for (const out of [a.characters[0].tag, b.characters[0].tag]) {
      // age 自己的原词 + 骨架词：只写 child 一个词压不住高度与体量。
      expect(out).toContain('child');
      expect(out).toContain('short stature');
      expect(out).toContain('flat chest');
    }
    // 模型在第二张顺手写的 tall 被骨架词替换掉,不能一人一个身高。
    expect(b.characters[0].tag).not.toMatch(/\btall\b/);
    // 姿势(sitting/standing)照旧不同,骨架词必须一模一样。
    expect(a.characters[0].tag.replace(/sitting|standing/g, '')).toBe(
      b.characters[0].tag.replace(/sitting|standing/g, ''),
    );
  });

  it('已经写到 body 里的骨架词不重复', () => {
    const girl = entry({
      fields: { ...emptyCharFields(), sex: '1girl', age: 'child', body: 'flat chest' },
    });
    const a = image('1girl', '1girl');
    enforceAppearance(a, [girl], false, true, []);
    expect(a.characters[0].tag.match(/flat chest/g)).toHaveLength(1);
  });

  it('没有年龄档就不编体型锚', () => {
    // 只在 tag 里写 hair/eyes/body，不谈年龄：不该凭空冒出 short stature 这种断言，
    // 但已有的 body 词（slim figure）必须照旧保留下来。
    const girl = entry({
      fields: { ...emptyCharFields(), sex: '1girl', hair: 'braided hair', body: 'slim figure' },
    });
    const a = image('1girl, braided hair', '1girl, braided hair');
    enforceAppearance(a, [girl], false, true, []);
    expect(a.characters[0].tag).toContain('slim figure');
    expect(a.characters[0].tag).not.toContain('short stature');
  });

  it('档案只写年龄、没写 body 时身高仍然锁住', () => {
    // body 为空不等于不锁：骨架词来源于 age，身高在 nl 与 tag 两侧都要管。
    const girl = entry({
      fields: { ...emptyCharFields(), sex: '1girl', age: 'child', hair: 'long black hair' },
    });
    const a = image('1girl, long black hair, tall woman', '1girl, long black hair, tall woman');
    a.characters[0].nl = 'A tall woman with long black hair.';
    enforceAppearance(a, [girl], true, true, []);
    expect(a.characters[0].nl).toContain('short');
    expect(a.characters[0].tag).not.toMatch(/\btall\b/);
  });

  /**
   * nl 里的身高三张图必须一个说法。
   *
   * 模型每张图顺手写的 a small girl / a tall woman 不会被 tag 侧的骨架词管住——
   * nl 送进 NAI 时分量比 tag 还重。而旧版把整串「small tanned girl」换掉，连 tanned
   * 这种别的信息一起吞了。
   */
  it('nl 里的身高跟着档案走，其余修饰保留', () => {
    const girl = entry({
      fields: { ...emptyCharFields(), sex: '1girl', age: 'child', hair: 'long black hair' },
    });
    const a = image('1girl, long black hair', '1girl, long black hair');
    a.characters[0].nl = 'The tall tanned girl with long black hair smiles.';
    enforceAppearance(a, [girl], true, true, []);
    expect(a.characters[0].nl).toContain('short tanned girl');
    expect(a.characters[0].nl).not.toMatch(/\btall\b/);
  });
});
