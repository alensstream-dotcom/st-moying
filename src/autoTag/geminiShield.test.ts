import { describe, expect, it } from 'vitest';
import {
  repairQuote,
  repairQuotes,
  shieldMessages,
  shieldStory,
  shieldText,
  shieldWithMap,
  storyPart,
  unshieldText,
} from '@/autoTag/geminiShield';

const STORY = [
  '她把他的裤子扯下来，手掌包住那根阴茎，低头含了进去。',
  '舌头沿着柱身舔弄，喉咙被顶得发出闷响，唾液顺着嘴角流下来。',
  '他按住她的后脑，抽送得越来越深，最后射在她嘴里，她咽了下去。',
].join('\n\n');

const USER = `【角色固定外貌库】\n- 苏晚: 1girl, long black hair\n\n--- 目标正文｜Char ---\n${STORY}`;

describe('geminiShield: 输入侧屏蔽', () => {
  it('把不同写法的男根词都换掉(JJ / 鸡巴 / 肉棒 / 阴茎 / 那根东西)', () => {
    for (const word of ['JJ', 'jj', '鸡巴', '鸡儿', '肉棒', '阴茎', '阳具', '那根东西', '男根']) {
      const out = shieldText(`他握着她的${word}。`);
      expect(out, word).not.toContain(word);
      expect(out, word).toContain('那一根');
    }
  });

  it('把行为、体液、女阴、胸部词换掉', () => {
    const raw = '抽送着插了进去，精液射在里面，小穴和乳房都湿透了。';
    const out = shieldText(raw);
    for (const word of ['抽送', '插了进去', '精液', '射在', '小穴', '乳房']) {
      expect(out, word).not.toContain(word);
    }
  });

  it('只动目标正文那一段，档案与账本原样保留', () => {
    const { content, story } = shieldStory(USER);
    expect(content).toContain('- 苏晚: 1girl, long black hair');
    expect(content).toContain('--- 目标正文｜Char ---');
    expect(content).not.toContain('阴茎');
    expect(story?.source).toBe(STORY);
    expect(storyPart(USER)).toBe(STORY);
  });

  it('system 消息也要清:规范里的英文举例会单独触发拦截', () => {
    const { messages } = shieldMessages([
      { role: 'system', content: 'tag 用短词直写(cum on stomach、creampie、panties pulled aside)' },
      { role: 'user', content: USER },
    ]);
    expect(messages[0].content).not.toMatch(/creampie|cum on stomach|panties pulled aside/);
    expect(messages[1].content).not.toContain('阴茎');
  });

  it('整条 user 消息都清:上一楼正文与实拍 tag 同样会顶回请求', () => {
    const user = `【上一楼】她把他的肉棒含进嘴里。\n${USER}`;
    const { messages } = shieldMessages([{ role: 'user', content: user }]);
    expect(messages[0].content).not.toContain('肉棒');
    expect(messages[0].content).toContain('那一根');
  });
});

describe('geminiShield: 引用还原', () => {
  it('把模型抄的屏蔽版句子映射回原文句子', () => {
    const { story } = shieldStory(USER);
    const quoted = shieldText('她低头含了进去，喉咙被顶得发出闷响。');
    // 这一句不在原文里(原文是「舌头沿着柱身舔弄，喉咙被顶得…」),只能退到按词近似还原
    expect(repairQuote(quoted, story)).toBe('她低头舔弄，喉咙被抽送发出闷响。');
    // 屏蔽版原样引用能精确还原
    const shielded = story!.text.split('\n\n')[1]?.replace(' ⟦P2⟧', '') ?? '';
    expect(story!.source).toContain(repairQuote(shielded, story));
  });

  it('还原后必须是原文的逐字子串(服装账本的 evidence 靠这个)', () => {
    const { story } = shieldStory(USER);
    const piece = story!.text.slice(story!.text.indexOf('她的'), story!.text.indexOf('她的') + 20);
    const fixed = repairQuote(piece, story);
    expect(story!.source).toContain(fixed);
  });

  it('只改 after/evidence/subjectEvidence 三个键,其它字段原样', () => {
    const { story } = shieldStory(USER);
    const shieldedQuote = shieldText('手掌包住那根阴茎');
    const json = `{"images":[{"position":"P1","after":"${shieldedQuote}","tag":"1girl, solo","extra":"${shieldedQuote}"}]}`;
    const fixed = repairQuotes(json, story);
    expect(fixed).toContain('手掌包住那根阴茎');
    // extra 不是引用字段,不该被改
    expect(fixed.split('"extra"')[1]).toContain(shieldedQuote);
  });

  it('没有 story 时原样返回,不做任何猜测', () => {
    expect(repairQuote('任何句子', null)).toBe('任何句子');
    expect(repairQuotes('{"images":[]}', null)).toBe('{"images":[]}');
  });

  it('unshieldText 做近似还原(修不回原文时的兜底)', () => {
    expect(unshieldText('她握住那一根')).toContain('阴茎');
    expect(unshieldText('凑近了')).toContain('舔弄');
  });
});

describe('geminiShield: 下标映射', () => {
  it('屏蔽后的每个字符都能映射回原文位置', () => {
    const { text, source, map } = shieldWithMap('他握着JJ，她低头含了进去。');
    expect(map).toHaveLength(text.length + 1);
    expect(map[map.length - 1]).toBe(source.length);
    // 单调不减
    for (let i = 1; i < map.length; i += 1) expect(map[i]).toBeGreaterThanOrEqual(map[i - 1] ?? 0);
  });

  it('取最长命中:同类相邻词不会各换一半', () => {
    // 「那根阴茎」里「那根」不是词表项,「阴茎」整体被换
    expect(shieldText('那根阴茎')).toBe('那根那一根');
    // 「整根没入」只换「没入」,「整根」不是词表项
    expect(shieldText('整根没入')).toBe('整根贴了上去');
  });
});
