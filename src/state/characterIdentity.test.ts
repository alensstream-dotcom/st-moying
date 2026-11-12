import { describe, expect, it } from 'vitest';
import {
  assessIdentityClaims,
  enforceKnownMaleIdentity,
  femaleStoryFact,
  type IdentityFact,
  type IdentitySources,
} from '@/state/characterIdentity';
import { emptyCharFields, type CharTagEntry } from '@/state/charTags';
import type { ImageInsertion } from '@/autoTag/protocol';

const sources = (story: string): IdentitySources => ({ story, card: '', worldbook: '', book: [] });

describe('femaleStoryFact 正文原句取证', () => {
  it('名字所在句只有「她」时判为女性', () => {
    const story = '雨声很轻。苏晚晴抬起头，她的眼里还有未散的红。';
    const fact = femaleStoryFact('苏晚晴', story);
    expect(fact?.gender).toBe('female');
    expect(fact?.source).toBe('story');
    expect(story.includes(fact!.evidence)).toBe(true);
    expect(fact!.evidence).toContain('苏晚晴');
  });

  it('句子里同时出现「他」时不取证，避免把男主或旁观者判成女性', () => {
    expect(femaleStoryFact('陆沉', '陆沉看着她，他没有说话。')).toBeNull();
    expect(femaleStoryFact('赵敏', '张明笑了，赵敏低下头，他转过身。')).toBeNull();
  });

  it('男性指代句直接返回 null', () => {
    expect(femaleStoryFact('陆沉', '陆沉握紧拳头，他终于笑了。')).toBeNull();
  });

  it('正文里没有这个名字时返回 null', () => {
    expect(femaleStoryFact('不存在的人', '苏晚晴抬起头，她的眼里还有未散的红。')).toBeNull();
  });

  it('跳过第一处不合格句子，继续找后面只含「她」的句子', () => {
    const story = '苏晚晴推门进来，他正站在窗边。苏晚晴放下伞，她抖落肩上的雨。';
    const fact = femaleStoryFact('苏晚晴', story);
    expect(fact?.gender).toBe('female');
    expect(fact!.evidence).toContain('她抖落肩上的雨');
  });

  it('补出的事实能通过建档闸门（性别 female、非背景）', () => {
    const story = '苏晚晴抬起头，她的眼里还有未散的红。';
    const fact = femaleStoryFact('苏晚晴', story);
    expect(fact?.gender).toBe('female');
    expect(fact?.background).toBeFalsy();
    // 对照组：模型自己写的「改写证据」不是正文子串，审核会判 unknown。
    const assessed = assessIdentityClaims(
      [
        {
          name: '苏晚晴',
          gender: 'female',
          heroine: false,
          source: 'story',
          evidence: '苏晚晴是这本小说的女主角',
          reason: '模型概括，不是逐字引用',
        },
      ],
      sources(story),
    );
    expect(assessed.find((f) => f.name === '苏晚晴')?.gender).toBe('unknown');
  });
});

describe('enforceKnownMaleIdentity 按主名认档案', () => {
  const man = (name: string): CharTagEntry => ({
    name,
    fields: { ...emptyCharFields(), sex: '1boy', hair: 'short black hair' },
    raw: '',
    nl: '',
    source: 'manual',
    desc: '',
    history: [],
  });
  const facts: IdentityFact[] = [{ name: '陆沉', gender: 'male', heroine: false, source: 'manual', reason: '', evidence: '' }];
  const image = (name: string): ImageInsertion => ({
    position: 'P1',
    tag: '1boy, 1girl',
    nl: '',
    negative: '',
    characters: [{ name, tag: '1boy, long silver hair, breasts', nl: '' }],
    size: 'portrait',
    sourceLine: 0,
    charOffset: 0,
  });

  it('写成称呼（阿沉）时仍认得档案，不会把档案已有的外貌词当女性特征留下', () => {
    const target = image('阿沉');
    enforceKnownMaleIdentity(target, [man('陆沉')], facts, false);
    // 档案里已有的 short black hair 属于他，不该被重新拼进 tag
    expect(target.characters[0].tag).not.toContain('short black hair');
    expect(target.characters[0].tag).toContain('1boy');
  });
});
