import { describe, expect, it } from 'vitest';

import { nlRepairMessages, parseNlReply, repairMessages } from '@/autoTag/repair';

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
  it('补一句自然语言只带这一格的最小信息', () => {
    const messages = nlRepairMessages({
      name: '温岚',
      segment: '她坐在客厅沙发上喝奶茶。',
      outfitLine: '- 温岚：t-shirt（穿着）；skirt（穿着）',
      frameAction: '她端着杯子小口吸',
      focus: '奶茶与她的侧脸',
    });
    const text = messages[0].content;
    expect(text).toContain('温岚');
    expect(text).toContain('客厅沙发');
    expect(text).toContain('t-shirt');
    expect(text).toContain('定格动作');
    expect(text).toContain('{"nl":"…"}');
    expect(text).not.toContain('<Menu>');
    // 只要一句话：不该把整套契约塞进来。
    expect(text.length).toBeLessThan(1200);
  });

  it('解析单句回复：裸 JSON、带解释、代码围栏都能取到', () => {
    expect(parseNlReply('{"nl":"She lifts the cup to her lips."}')).toBe('She lifts the cup to her lips.');
    expect(parseNlReply('好的：{"nl":"She leans back on the couch."}')).toBe('She leans back on the couch.');
    expect(parseNlReply('```json\n{"nl":"He sets the case down."}\n```')).toBe('He sets the case down.');
    expect(parseNlReply('没有 JSON 的废话')).toBe('');
  });
});
