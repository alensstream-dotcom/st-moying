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
});
