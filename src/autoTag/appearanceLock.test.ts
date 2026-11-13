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
});
