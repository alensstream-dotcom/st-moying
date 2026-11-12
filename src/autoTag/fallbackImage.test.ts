import { describe, expect, it } from 'vitest';
import { fallbackImage, isDrawWorthy } from './fallbackImage';
import type { CharTagEntry } from '../state/charTags';
import type { TargetSegment } from './clean';

function entry(name: string, hair = 'black hair', nl = ''): CharTagEntry {
  return {
    name,
    fields: {
      fandom: '',
      sex: '1girl',
      age: 'young adult',
      hair,
      eyes: 'brown eyes',
      skin: '',
      body: '',
      extra: '',
      outfit: 'white shirt, long jeans',
    },
    raw: '',
    nl,
    source: 'ai',
    desc: '',
    history: [],
  } as CharTagEntry;
}

const segment = (id: string, text: string, sourceLine: number, charOffset: number): TargetSegment =>
  ({ id, text, sourceLine, charOffset }) as TargetSegment;

describe('fallbackImage', () => {
  it('认出值得出图的情节', () => {
    expect(isDrawWorthy('她靠过来亲吻他的嘴角。')).toBe(true);
    expect(isDrawWorthy('他们做爱到很晚。')).toBe(true);
    expect(isDrawWorthy('她走进房间，坐下喝茶。')).toBe(false);
  });

  it('挑点名了在场女性的句子，并带上她的档案 tag', () => {
    const segments = [
      segment('P1', '雨声很轻。', 0, 4),
      segment('P2', '林晚晴解开衬衫的扣子。', 0, 24),
      segment('P3', '她低头笑了一下。', 1, 9),
    ];
    const image = fallbackImage('林晚晴解开衬衫的扣子。', segments, [entry('林晚晴')]);
    expect(image?.position).toBe('P2');
    expect(image?.sourceLine).toBe(0);
    expect(image?.charOffset).toBe(24);
    expect(image?.tag).toContain('1girl');
    expect(image?.tag).toContain('black hair');
    expect(image?.characters[0]).toMatchObject({ name: '林晚晴' });
    expect(image?.size).toBe('portrait');
  });

  it('没有点名角色时退回含「她」的句子', () => {
    const segments = [segment('P1', '雨声很轻。', 0, 4), segment('P2', '她解开了扣子。', 0, 9)];
    const image = fallbackImage('她解开了扣子。', segments, [entry('林晚晴')]);
    expect(image?.position).toBe('P2');
    expect(image?.characters).toEqual([]);
  });

  it('没有可用的正文段时返回 null', () => {
    expect(fallbackImage('正文', [], [entry('林晚晴')])).toBeNull();
  });
});
