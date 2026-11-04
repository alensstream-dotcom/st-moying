import { describe, expect, it } from 'vitest';
import {
  BLOCK_RETRY_NOTE,
  diagnoseBlock,
  neutralizeMessages,
} from '@/autoTag/blockGuard';

describe('渠道拦截识别', () => {
  it('finish_reason 是 content_filter 时直接定性', () => {
    expect(diagnoseBlock('', 'content_filter').blocked).toBe(true);
    expect(diagnoseBlock('{', 'content_filter').blocked).toBe(true);
  });

  it('只回一段中文客气话、没有 JSON 起点时判为拦截', () => {
    expect(diagnoseBlock('抱歉,这段内容涉及成人向描写,我无法继续输出。').blocked).toBe(true);
    expect(diagnoseBlock('由于篇幅限制,以下是概要:').blocked).toBe(true);
    expect(diagnoseBlock('Sorry, the content is too explicit.').blocked).toBe(true);
  });

  it('已经开始写 JSON 就交给解析器,不在这里拦', () => {
    const raw = '抱歉我先说明一下。\n<thinking>\n检查完了\n</thinking>\n{"images":[]}';
    expect(diagnoseBlock(raw).blocked).toBe(false);
  });

  it('空输出不算拦截(交给截断判断,它要报「空输出」)', () => {
    expect(diagnoseBlock('').blocked).toBe(false);
    expect(diagnoseBlock('   ').blocked).toBe(false);
  });

  it('命中的形态写进 reason,便于和历史页里的其它失败区分', () => {
    expect(diagnoseBlock('这段内容被审核拦下了').reason).toContain('拒答散文');
    expect(diagnoseBlock('', 'content_filter').reason).toContain('content_filter');
  });
});

describe('兼容模式改淡系统提示', () => {
  const messages = [
    { role: 'system', content: '道具要绑成词组(brush on pussy、fingers inside her)。' },
    { role: 'system', content: '示例:cum on <部位>、creampie、nipples。' },
    { role: 'user', content: '正文:cum on pussy 也有,这段不动。' },
  ];

  it('把示例词换成中性占位', () => {
    const out = neutralizeMessages(messages);
    expect(out[0].content).toContain('brush on <部位>');
    expect(out[0].content).toContain('fingers inside <部位>');
    expect(out[1].content).toContain('液体 on <部位>');
    expect(out[1].content).not.toContain('creampie');
    expect(out[1].content).not.toContain('nipples');
  });

  it('只改 system,用户消息(正文上下文)原样保留', () => {
    const out = neutralizeMessages(messages);
    expect(out[2].content).toBe(messages[2].content);
  });

  it('不改原数组,重试用完还能回到完整版', () => {
    const out = neutralizeMessages(messages);
    expect(messages[0].content).toContain('pussy');
    expect(out[0].content).not.toContain('pussy');
    expect(out[0].content).not.toBe(messages[0].content);
  });

  it('重试指令要求更短更淡,而不是再表态', () => {
    expect(BLOCK_RETRY_NOTE).toContain('<retry_after_block>');
    expect(BLOCK_RETRY_NOTE).toContain('英文 tag');
    expect(BLOCK_RETRY_NOTE).toContain('三键');
  });
});
