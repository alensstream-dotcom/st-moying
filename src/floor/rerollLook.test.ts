import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 重掷人物形象要真的改变出图结果。
 *
 * 这里不测「随机数够不够随机」，只测三条会让人以为功能坏了的行为：
 * ①掷完档案变了；②掷完 appearancePolicy 也变了（否则出图端被旧快照/旧 policy 盖回去）；
 * ③原本显式写了「完全跟随剧情」的角色，掷完必须变成 manual，不然重掷被 story 模式原地吞掉。
 */

const chatMetadata: Record<string, unknown> = {};

vi.mock('@/st/context', () => ({
  getContext: () => ({
    chat: [],
    chatMetadata,
    saveMetadataDebounced: () => {},
    getCurrentChatId: () => 'chat-1',
  }),
}));

const store = new Map<string, ReturnType<typeof makeEntry>>();

function makeEntry(name: string, fields: Record<string, string>) {
  return {
    name,
    fields: {
      fandom: '',
      sex: '1girl',
      age: '',
      hair: '',
      eyes: '',
      skin: '',
      body: '',
      extra: '',
      outfit: '',
      ...fields,
    },
    raw: '',
    nl: '',
    source: 'ai' as const,
    desc: '',
    history: [],
  };
}

vi.mock('@/state/charTags', async () => {
  const actual = await vi.importActual<typeof import('@/state/charTags')>('@/state/charTags');
  return {
    ...actual,
    charTagLib: {
      get entries() {
        return [...store.values()];
      },
    },
    findCharTag: (name: string) => store.get(name),
    upsertCharTag: (entry: ReturnType<typeof makeEntry>, oldName?: string) => {
      if (oldName && oldName !== entry.name) store.delete(oldName);
      store.set(entry.name, { ...entry });
      return true;
    },
    recomputeCharTags: () => {},
  };
});

vi.mock('@/state/characterStudio', () => ({
  lookSettings: (name: string) => ({ name, reference: false, strength: 0.6, fidelity: 0.5, history: [] }),
  saveLook: () => {},
}));

import { rerollCharacterLook } from './rerollLook';
import { appearancePolicy, setAppearancePolicy } from '@/state/appearancePolicy';

describe('rerollCharacterLook', () => {
  beforeEach(() => {
    store.clear();
    for (const key of Object.keys(chatMetadata)) delete chatMetadata[key];
  });

  it('掷完档案真的变了', () => {
    store.set('苏晚', makeEntry('苏晚', { hair: 'black hair', eyes: 'blue eyes' }));
    const summary = rerollCharacterLook('苏晚', '');
    expect(summary.changed).toBe(true);
    const after = store.get('苏晚')!;
    expect(after.fields.hair).not.toBe('black hair');
    expect(summary.text).toContain('苏晚');
  });

  it('正文写死的轴不动', () => {
    store.set('苏晚', makeEntry('苏晚', { hair: 'black hair', eyes: 'blue eyes' }));
    rerollCharacterLook('苏晚', '她有一头乌黑的长发。');
    expect(store.get('苏晚')!.fields.hair).toContain('black hair');
  });

  it('掷完把新值写进 appearancePolicy，否则出图端会用旧快照盖回去', () => {
    store.set('苏晚', makeEntry('苏晚', { hair: 'black hair', eyes: 'blue eyes' }));
    rerollCharacterLook('苏晚', '');
    const policy = appearancePolicy('苏晚');
    expect(policy).toBeDefined();
    expect(policy!.mode).toBe('manual');
    expect(policy!.fields.hair).toBe(store.get('苏晚')!.fields.hair);
  });

  it('原本写着「完全跟随剧情」的角色，掷完必须提成 manual', () => {
    store.set('苏晚', makeEntry('苏晚', { hair: 'black hair', eyes: 'blue eyes' }));
    setAppearancePolicy('苏晚', { mode: 'story', fields: {} }, store.get('苏晚')!);
    rerollCharacterLook('苏晚', '');
    expect(appearancePolicy('苏晚')!.mode).toBe('manual');
  });

  it('已有的 manual 覆盖值会保留，只合并重掷的轴', () => {
    store.set('苏晚', makeEntry('苏晚', { hair: 'black hair', eyes: 'blue eyes' }));
    setAppearancePolicy('苏晚', { mode: 'manual', fields: { skin: 'pale skin' } }, store.get('苏晚')!);
    rerollCharacterLook('苏晚', '');
    const policy = appearancePolicy('苏晚')!;
    expect(policy.fields.skin).toBe('pale skin');
    expect(policy.fields.hair).toBe(store.get('苏晚')!.fields.hair);
  });

  it('没有档案时报错而不是静默失败', () => {
    expect(() => rerollCharacterLook('陌生人', '')).toThrow('还没有档案');
  });

  it('所有轴都被正文写死时报错并列出分类', () => {
    store.set(
      '苏晚',
      makeEntry('苏晚', {
        hair: 'black hair, long straight hair',
        eyes: 'blue eyes, round eyes',
        body: 'slender',
        extra: 'hairpin',
      }),
    );
    // 六个轴全部在正文里给了：发色（乌黑）、发型（长发）、瞳色（蓝）、眼形（圆眼）、
    // 体型（苗条）、发饰（发夹）。这时候没有可以掷的东西，必须报错而不是乱改。
    const story = '她有一头乌黑的长发，一双圆圆的蓝色眼睛，身材苗条，鬓边别着一枚发夹。';
    expect(() => rerollCharacterLook('苏晚', story)).toThrow('写死');
  });

  it('正文只写发色不写发型时，发型仍然可以掷', () => {
    store.set('苏晚', makeEntry('苏晚', { hair: 'black hair, long straight hair' }));
    rerollCharacterLook('苏晚', '她有一头黑色的长发。');
    const after = store.get('苏晚')!.fields.hair;
    // 发色被正文锁住；发型正文只给了方向（长），字面对照匹配不到具体款式，
    // 但类别 guard 会保住它——不能把长发掷成短发。
    expect(after).toContain('black hair');
    expect(after).toContain('long straight hair');
  });
});
