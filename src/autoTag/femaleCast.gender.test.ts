import { describe, expect, it } from 'vitest';
import type { CharTagEntry } from '@/state/charTags';
import { femaleStoryFact } from '@/state/characterIdentity';
import {
  ensureFemaleSubjects,
  femaleCastNames,
  femaleName,
  imageHasFemale,
} from './femaleCast';
import { diagnoseFemaleSubject } from './castCheck';

function entry(name: string, sex: string): CharTagEntry {
  return { name, fields: { sex }, raw: '', nl: '', source: 'manual', desc: '', history: [] } as unknown as CharTagEntry;
}

describe('称呼类字眼不是女性证据', () => {
  it('「大小姐」出现在男主句子里时不给男主补女性事实', () => {
    // 第 10 楼实际文案：整楼没有女性在场，只有男主在看别墅里的东西。
    const story = '真田走进别墅的图书馆。但看着这些东西，真田的内心已经默默地记下了那个大小姐的名字。';
    expect(femaleStoryFact('真田', story)).toBeNull();
  });

  it('「大小姐」也不再被当成这一段有女性在场的线索', () => {
    expect(diagnoseFemaleSubject('他记下了那个大小姐的名字。', { tag: '1boy, indoors', characters: [] }, [])).toEqual([
      expect.objectContaining({ kind: 'missing-female' }),
    ]);
  });

  it('紧贴人名的称呼仍然算线索', () => {
    expect(femaleStoryFact('苏晚晴', '苏晚晴小姐抬起头，雨还在下。')?.gender).toBe('female');
  });

  it('普通女性代词不受影响', () => {
    expect(femaleStoryFact('苏晚晴', '苏晚晴抬起头，她的眼里还有未散的红。')?.gender).toBe('female');
  });
});

describe('纯男主图必须被丢弃', () => {
  const entries = [entry('真田', '1boy')];
  const story = '真田走进别墅的图书馆。但看着这些东西，真田的内心已经默默地记下了那个大小姐的名字。';

  it('库里性别为男的角色不会进女性名单', () => {
    expect(femaleCastNames(entries, [], story, ['真田'])).not.toContain('真田');
    expect(femaleName('真田', entries, [], story)).toBe(false);
  });

  it('tag 里只有 1boy 的图判为没有女性主体', () => {
    const image = { position: 'P1', tag: '1boy, indoors, library', characters: [{ name: '真田', tag: '1boy, suit', nl: '' }] };
    expect(imageHasFemale(image, [], entries, [], story)).toBe(false);
    expect(ensureFemaleSubjects([image] as never, [], entries, [], story).images).toHaveLength(0);
  });
});
