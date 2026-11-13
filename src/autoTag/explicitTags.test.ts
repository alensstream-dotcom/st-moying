import { describe, expect, it } from 'vitest';
import { appendExplicitTags, explicitSentence, explicitTagsFor, storyOffset } from '@/autoTag/explicitTags';

describe('本地露骨 tag 补齐(gemini 档专用)', () => {
  it('口交句子补出 fellatio / penis', () => {
    const tags = explicitTagsFor('她低下头，含了进去，舌头绕着柱身舔了一圈。');
    expect(tags).toContain('fellatio');
    expect(tags).toContain('penis');
  });

  it('深喉单独补 deepthroat', () => {
    expect(explicitTagsFor('他按住她的后脑，几乎顶到喉咙最里面。')).toContain('deepthroat');
  });

  it('射在嘴里补 cum in mouth', () => {
    expect(explicitTagsFor('最后射在她嘴里，她咽了下去。')).toContain('cum in mouth');
  });

  it('隔着衣服揉胸不补 breast play(否定语境判据)', () => {
    const tags = explicitTagsFor('他隔着衬衫揉着她的胸口，指腹压着布料底下那一点。');
    expect(tags).not.toContain('breast play');
    expect(tags).not.toContain('nipples');
  });

  it('直接揉胸补 breast play', () => {
    const tags = explicitTagsFor('掌心直接覆上她的乳房，指尖掐住乳尖捻了捻。');
    expect(tags).toContain('breast play');
    expect(tags).toContain('nipples');
  });

  it('手指插进头发不补 fingering(需要下半身语境)', () => {
    const tags = explicitTagsFor('陆沉的手插进她的黑发里，指缝间漏出几缕，按着她的后脑。');
    expect(tags).not.toContain('fingering');
    expect(tags).not.toContain('pussy');
  });

  it('手指插进体内才补 fingering', () => {
    const tags = explicitTagsFor('手指探进她体内，两指并拢，往深处按。');
    expect(tags).toContain('fingering');
    expect(tags).toContain('pussy');
  });

  it('插入 / 内射各补各的,不互相污染', () => {
    const sex = explicitTagsFor('他扶着肉棒，抵在湿滑的入口上，慢慢推进去。');
    expect(sex).toContain('vaginal sex');
    const cum = explicitTagsFor('他就着她弓起的姿势射进去，全灌在最里面。');
    expect(cum).toContain('creampie');
    expect(cum).not.toContain('fellatio');
  });

  it('后入按动作词判定,只写姿势不补 doggystyle', () => {
    expect(explicitTagsFor('她从后面抱住他，下巴搁在肩上。')).not.toContain('doggystyle');
    expect(explicitTagsFor('他从后面插入，抽送得越来越快。')).toContain('doggystyle');
  });

  it('模型已经写过的词不重复追加', () => {
    const tags = explicitTagsFor('她含了进去。', '1girl, fellatio, penis');
    expect(tags).not.toContain('fellatio');
    expect(tags).not.toContain('penis');
  });

  it('最多补 6 条,避免稀释主体', () => {
    const text = '她含了进去，他射在她嘴里，她咽了下去；手指插进去，抽送，最后射进去，灌在最里面。';
    expect(explicitTagsFor(text).length).toBeLessThanOrEqual(6);
  });

  it('appendExplicitTags 追加在末尾并清理尾逗号', () => {
    expect(appendExplicitTags('1girl, solo, ', ['fellatio'])).toBe('1girl, solo, fellatio');
    expect(appendExplicitTags('', ['fellatio'])).toBe('fellatio');
    expect(appendExplicitTags('1girl', [])).toBe('1girl');
  });

  it('storyOffset 把行内偏移折算成全局偏移', () => {
    const story = '第一行。\n第二行很长。\n第三行。';
    expect(storyOffset(story, 0, 0)).toBe(0);
    expect(storyOffset(story, 1, 0)).toBe('第一行。\n'.length);
    expect(storyOffset(story, 2, 4)).toBe('第一行。\n第二行很长。\n第三行。'.length);
    expect(storyOffset(story, 9, 0)).toBe('第一行。\n第二行很长。\n'.length);
  });

  // 这条是上游实测踩到的误判:取「前后 120 字窗口」会把邻句的动作算进来。
  it('只取这一句,不把邻句的动作算进来', () => {
    const story = '他走过来，把风衣脱下来搭在椅背上。\n\n他低头吻她，另一只手把那件衬衫抽走。';
    const first = explicitSentence(story, 0, story.indexOf('搭在椅背上') + 1);
    expect(first).toContain('风衣');
    expect(first).not.toContain('吻');
    expect(explicitTagsFor(first)).not.toContain('kiss');

    const second = explicitSentence(story, 2, 5);
    expect(second).toContain('吻');
    expect(explicitTagsFor(second)).toContain('kiss');
  });

  it('句尾偏移正落在句号上时仍取到整句', () => {
    const story = '她跪下去，含了进去。他站在旁边。';
    const at = story.indexOf('。') + 1;
    expect(explicitSentence(story, 0, at)).toBe('她跪下去，含了进去。');
  });
});
