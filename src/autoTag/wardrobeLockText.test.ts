import { describe, expect, it } from 'vitest';
import { presentNames, wardrobeLockText } from './wardrobeLockText';
import type { CharTagEntry } from '../state/charTags';
import type { STMessage } from '../st/context';

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
});
