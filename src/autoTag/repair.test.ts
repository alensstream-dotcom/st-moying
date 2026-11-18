import { describe, expect, it } from 'vitest';

import { repairMessages } from '@/autoTag/repair';

describe('局部修复的请求体', () => {
  it('只带这一格的段落、穿着与错误，不带整份契约或词表', () => {
    const messages = repairMessages({
      segment: '她把信递过去，指尖擦到他的掌心。',
      position: 'P3',
      badQuote: '她轻轻放下信封',
      error: 'after 不是原文里逐字存在的句子（这一格因此被挡掉）。',
      outfitLine: 'white shirt, jeans',
      frameAction: '她伸手接住信封的近侧边缘',
      focus: '信封交接',
    });
    expect(messages).toHaveLength(2);
    const [system, user] = messages;
    expect(system.role).toBe('system');
    const text = system.content;
    expect(text).toContain('P3');
    expect(text).toContain('她把信递过去');
    expect(text).toContain('white shirt, jeans');
    expect(text).toContain('她轻轻放下信封');
    expect(text).toContain('她伸手接住信封的近侧边缘');
    // 契约与词表不进这条路径：它要回答的只是一个很窄的问题。
    expect(text).not.toContain('<Menu>');
    expect(text).not.toContain('<Secret>');
    expect(user.content).toContain('只输出 JSON');
  });

  it('没有上一次的引句时不留空行占位', () => {
    const messages = repairMessages({ segment: '她坐在窗边。', position: 'P1', error: '景别装不下手部动作' });
    expect(messages[0].content).not.toContain('上一次写的引句');
    expect(messages[0].content).toContain('景别装不下手部动作');
  });
});