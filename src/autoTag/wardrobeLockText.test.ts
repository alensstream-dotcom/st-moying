import { describe, expect, it, vi } from 'vitest';
import { presentNames, wardrobeLockText } from './wardrobeLockText';
import type { CharTagEntry } from '../state/charTags';
import type { STMessage } from '../st/context';

const policies: Record<string, unknown> = {};
vi.mock('@/st/context', () => ({
  getContext: () => ({
    chat: [],
    chatMetadata: { bbiAppearancePolicies: policies },
    saveMetadataDebounced: () => {},
  }),
}));

function entry(name: string, outfit: string): CharTagEntry {
  return {
    name,
    fields: {
      fandom: '',
      sex: '1girl',
      age: 'young adult',
      hair: 'black hair',
      eyes: 'brown eyes',
      skin: '',
      body: '',
      extra: '',
      outfit,
    },
    raw: '',
    nl: '',
    source: 'ai',
    desc: '',
    history: [],
  } as CharTagEntry;
}

const msg = (mes: string): STMessage => ({ mes, is_user: false }) as STMessage;

describe('wardrobeLockText', () => {
  it('把在场角色的当前穿着写进注入文本', () => {
    const chat = [msg('林晚晴站在门口。'), msg('林晚晴走过来坐下。')];
    const text = wardrobeLockText(chat, [entry('林晚晴', 'white shirt, long jeans')]);
    expect(text).toContain('着装锁定');
    expect(text).toContain('林晚晴');
    expect(text).toContain('white shirt');
    expect(text).toContain('long jeans');
    expect(text).toContain('不得自行更换');
  });

  it('只注入最近出现过的角色', () => {
    const chat = [msg('林晚晴站在门口。'), msg('雨下了一整夜。')];
    const names = presentNames(chat, [entry('林晚晴', 'long jeans'), entry('苏晴', 'red dress')], 1);
    expect(names).toEqual([]);
    const text = wardrobeLockText(chat, [entry('林晚晴', 'long jeans')], 1);
    expect(text).toBe('');
  });

  it('没有角色库时不注入', () => {
    expect(wardrobeLockText([msg('林晚晴站在门口。')], [])).toBe('');
  });

  it('正文只写称呼（晚晴）也算在场', () => {
    const chat = [msg('晚晴站在门口。')];
    expect(presentNames(chat, [entry('林晚晴', 'long jeans')])).toEqual(['林晚晴']);
    expect(wardrobeLockText(chat, [entry('林晚晴', 'long jeans')])).toContain('long jeans');
  });
});

describe('固定着装的标注', () => {
  it('档案里写了固定着装就标款式已固定,并让模型明确写换装', () => {
    const text = wardrobeLockText([msg('林晚晴站在门口。')], [entry('林晚晴', 'navy sailor uniform')]);
    expect(text).toContain('款式已固定');
    expect(text).toContain('换上/换成');
  });

  it('没有固定着装的角色不打锁定标注，但要提示尚未定装', () => {
    const text = wardrobeLockText([msg('林晚晴站在门口。')], [entry('林晚晴', '')]);
    // 结尾两行是通用说明，一定会提到「款式已固定」，所以只查这个人那一行。
    const line = text.split('\n').find((item) => item.startsWith('- 林晚晴'));
    expect(line).toBe('- 林晚晴：尚未定装（本楼可以按场景决定一套，之后固定沿用）');
  });

  it('点图固定形象（manual 且锁了 outfit）也标款式已固定', () => {
    for (const key of Object.keys(policies)) delete policies[key];
    policies['林晚晴'] = { mode: 'manual', fields: { hair: 'black hair', outfit: 'navy sailor uniform' } };
    const text = wardrobeLockText([msg('林晚晴站在门口。')], [entry('林晚晴', '')]);
    expect(text).toContain('款式已固定');
  });
});
