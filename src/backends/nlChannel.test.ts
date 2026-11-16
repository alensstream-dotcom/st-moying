import { describe, expect, it } from 'vitest';

import { clampNlWords } from '@/backends/nai';
import { parseImagePlan } from '@/autoTag/protocol';

// nl 是 4.5 那 512 token 里最占预算的一块,超了 NAI 不报错、从尾部静默丢内容。
// 长度纪律与内容纪律分开管:规范写「Base ≤20 / 角色 ≤26」,这里只兜失控。
describe('nl 词数截断', () => {
  it('合规的句子原样返回,一个字符都不动', () => {
    const nl = 'Her free hand pins the notebook against the desk.';
    expect(clampNlWords(nl, 24)).toBe(nl);
  });

  it('多句超限时按句丢尾,不把中间那句切半', () => {
    const nl = 'One two three four five. Six seven eight nine ten. Eleven twelve thirteen fourteen fifteen.';
    expect(clampNlWords(nl, 10)).toBe('One two three four five. Six seven eight nine ten.');
  });

  it('单句本身就超限时按词硬截,并补回句号', () => {
    const nl = 'one two three four five six seven eight';
    expect(clampNlWords(nl, 4)).toBe('one two three four.');
  });

  it('空白与折行先归一,空串返回空串', () => {
    expect(clampNlWords('  a  b \n c  ', 24)).toBe('a b c');
    expect(clampNlWords('', 24)).toBe('');
    expect(clampNlWords(null as unknown as string, 24)).toBe('');
  });
});

// nl 只吃英文:中文/日文在 T5 里会退化成字节级 token(开销三倍以上还读不懂)。
// 但清空必须只清这一段——抛错会顺着单图 catch 丢掉整张图、顺着角色 catch 丢掉整个角色。
describe('nl 语种校验', () => {
  const segments = [{ id: 'P1', sourceLine: 0, charOffset: 0, text: '第一幕结束' }];

  it('英文 nl 照原样留下', () => {
    const raw = JSON.stringify({
      images: [{ position: 'P1', tag: '1girl, standing', nl: 'She leans back\nagainst the window frame.' }],
    });
    const plan = parseImagePlan(raw, segments, 0, 1);
    expect(plan.images[0].nl).toBe('She leans back against the window frame.');
  });

  it('中文 Base nl 整段丢弃,但图还在', () => {
    const raw = JSON.stringify({
      images: [{ position: 'P1', tag: '1girl, standing', nl: '她背靠着窗框站着' }],
    });
    const plan = parseImagePlan(raw, segments, 0, 1);
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0].tag).toBe('1girl, standing');
    expect(plan.images[0].nl).toBe('');
  });

  it('角色 nl 含中文时只丢这一格 nl,角色本身保留', () => {
    const raw = JSON.stringify({
      images: [
        {
          position: 'P1',
          tag: '1girl, classroom',
          characters: [
            { name: '林夏', tag: '1girl, black hair', nl: '她的手指捏住裙摆' },
            { name: '老师', tag: '1boy, short hair', nl: 'He turns toward the blackboard.' },
          ],
        },
      ],
    });
    const plan = parseImagePlan(raw, segments, 0, 1);
    const characters = plan.images[0].characters;
    expect(characters.map(character => character.name)).toEqual(['林夏', '老师']);
    expect(characters[0].nl).toBe('');
    expect(characters[1].nl).toBe('He turns toward the blackboard.');
  });
});