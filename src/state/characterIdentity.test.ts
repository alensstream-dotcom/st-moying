import { describe, expect, it } from 'vitest';
import { assessIdentityClaims, femaleStoryFact, type IdentitySources } from '@/state/characterIdentity';

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
