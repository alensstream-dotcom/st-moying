import { describe, expect, it } from 'vitest';
import { castRetryNote, countPresentNames, diagnoseCast, diagnoseContact, diagnosePropTarget, readCounts } from './castCheck';

describe('readCounts', () => {
  it('读出女性与男性人数', () => {
    expect(readCounts('1girl, 2boys, nude')).toEqual({ girls: 1, boys: 2 });
  });

  it('同一性别的多段人数相加', () => {
    expect(readCounts('2girls, 1girl, 3boys')).toEqual({ girls: 3, boys: 3 });
  });

  it('只有单人时另一性别为 0', () => {
    expect(readCounts('solo, 1girl')).toEqual({ girls: 1, boys: 0 });
  });

  it('词中夹带不算人数(girlfriend)', () => {
    expect(readCounts('1girl, girlfriend')).toEqual({ girls: 1, boys: 0 });
  });
});

describe('countPresentNames', () => {
  it('只数正文里真的出现的名字', () => {
    expect(countPresentNames('林夏按住苏晚的手', ['林夏', '苏晚', '陈青'])).toBe(2);
  });

  it('同一名字出现多次只算一个人', () => {
    expect(countPresentNames('林夏看看林夏', ['林夏'])).toBe(1);
  });

  it('空名字不参与计数', () => {
    expect(countPresentNames('林夏', ['', '林夏'])).toBe(1);
  });
});

describe('diagnoseCast', () => {
  it('正文写两个男人、画面只有 1boy 时报警', () => {
    const gaps = diagnoseCast('两个男人一前一后把她夹住', '1girl, 1boy', [], [], true);
    expect(gaps[0]?.kind).toBe('wrong-count');
    expect(gaps[0]?.detail).toContain('多男同场');
  });

  it('正文写两根肉棒、画面没有 boy 时报警', () => {
    const gaps = diagnoseCast('两根肉棒同时进出', '1girl, solo', [], [], true);
    expect(gaps.some(gap => gap.kind === 'wrong-count')).toBe(true);
  });

  it('已有 1boy 时「两只手」也算可疑,提醒确认', () => {
    const gaps = diagnoseCast('两只手按在她腰上', '1girl, 1boy', [], [], true);
    expect(gaps.some(gap => gap.detail.includes('两只手'))).toBe(true);
  });

  it('单人画面里「两只手」不报警(可能只是她自己的手)', () => {
    expect(diagnoseCast('两只手撑着床沿', '1girl', [], [], true)).toEqual([]);
  });

  it('人数写够时对多男不报警', () => {
    expect(diagnoseCast('两个男人一前一后把她夹住', '1girl, 2boys', [], [], true)).toEqual([]);
  });

  it('单人普通场景不误报', () => {
    expect(diagnoseCast('她一个人坐在窗边', '1girl', [], [], true)).toEqual([]);
  });

  it('正文点名两人、画面只有一人时报警(双人变自慰)', () => {
    const gaps = diagnoseCast('林夏俯身吻住苏晚', '1girl', [], ['林夏', '苏晚'], true);
    expect(gaps.some(gap => gap.kind === 'wrong-count')).toBe(true);
  });

  it('角色块数多于人数 tag 时报警', () => {
    const gaps = diagnoseCast('两人相拥', '1girl', [
      { name: '林夏', tag: 'black hair' },
      { name: '苏晚', tag: 'red hair' },
    ], [], true);
    expect(gaps.some(gap => gap.detail.includes('角色块'))).toBe(true);
  });

  it('角色块 tag 全空时算是缺人', () => {
    const gaps = diagnoseCast('两人相拥', '2girls', [
      { name: '林夏', tag: 'black hair' },
      { name: '苏晚', tag: '' },
    ], [], true);
    expect(gaps.some(gap => gap.kind === 'missing-actor')).toBe(true);
  });

  it('单人协议下不查角色块', () => {
    const gaps = diagnoseCast('两人相拥', '2girls', [
      { name: '林夏', tag: '' },
      { name: '苏晚', tag: '' },
    ], [], false);
    expect(gaps).toEqual([]);
  });

  it('多人角色块只写单边 source# 缺 target# 配对时报警(运动关系不闭合)', () => {
    const gaps = diagnoseCast(
      '他从背后揉捏她的胸口',
      '1girl, 1boy',
      [
        { name: '林夏', tag: 'girl, large breasts, blush' },
        { name: '男主', tag: 'boy, faceless male, pov hands, source#grabbing breasts' },
      ],
      [],
      true,
    );
    expect(gaps.some(gap => gap.kind === 'contact-unbound' && gap.detail.includes('source#'))).toBe(true);
  });

  it('多人角色块 source# 与 target# 成对出现时通过', () => {
    const gaps = diagnoseCast(
      '他从背后揉捏她的胸口',
      '1girl, 1boy',
      [
        { name: '林夏', tag: 'girl, large breasts, target#grabbed, blush' },
        { name: '男主', tag: 'boy, faceless male, pov hands, source#grabbing breasts' },
      ],
      [],
      true,
    );
    expect(gaps).toEqual([]);
  });
});

describe('diagnosePropTarget', () => {
  it('正文用毛笔在阴部写字、tag 只有毛笔没有落点时报警', () => {
    const gaps = diagnosePropTarget('她用毛笔在她阴部上慢慢写字', '1girl, nude, holding brush, brush');
    expect(gaps[0]?.kind).toBe('prop-without-target');
    expect(gaps[0]?.detail).toContain('毛笔');
  });

  it('写了落点就不报警', () => {
    expect(diagnosePropTarget('毛笔在她阴部上写字', '1girl, brush on pussy, spread pussy')).toEqual([]);
  });

  it('正文写了用毛笔写字,虽有毛笔和部位但孤立并列无绑定词时报警(contact-unbound)', () => {
    const gaps = diagnosePropTarget('毛笔在她阴部上写字', '1girl, brush, pussy');
    expect(gaps[0]?.kind).toBe('contact-unbound');
  });

  it('NAI V5 道具与部位分属不同角色块且带绑定或 source#/target# 时通过', () => {
    expect(
      diagnosePropTarget('他用毛笔在她小腹上写字', '1girl, 1boy, calligraphy brush on belly', [
        'girl, belly, target#written on, trembling',
        'boy, faceless male, pov hands, holding calligraphy brush, source#writing on body',
      ]),
    ).toEqual([]);
  });

  it('扩展道具表:红绳捆绑、手铐铐住、红酒滴落均能校验落点与绑定', () => {
    expect(diagnosePropTarget('红绳紧紧缠上她的手腕', '1girl, red rope')).toHaveLength(1);
    expect(diagnosePropTarget('红绳紧紧缠上她的手腕', '1girl, red rope around wrists')).toEqual([]);
    expect(diagnosePropTarget('冰凉的红酒滴落在她的乳沟里', '1girl, wine dripping on cleavage, breasts')).toEqual([]);
  });

  it('正文有道具但 tag 压根没画道具时不管(可能这格没入画)', () => {
    expect(diagnosePropTarget('她握着毛笔', '1girl, sitting')).toEqual([]);
  });

  it('正文没写道具时不管', () => {
    expect(diagnosePropTarget('她坐在窗边', '1girl, holding brush')).toEqual([]);
  });

  it('鞭子落在臀上时通过', () => {
    expect(diagnosePropTarget('鞭子落在她的臀上', '1girl, whip on hip')).toEqual([]);
  });

  it('冰块划过胸口只画冰块算错', () => {
    expect(diagnosePropTarget('冰块沿着她的锁骨划过', '1girl, ice cube')).toHaveLength(1);
  });
});

describe('diagnoseContact', () => {
  it('手与胸都在、却没有任何绑定词时报警', () => {
    const gaps = diagnoseContact('她的手按在她的胸口上', '1girl, hand, breasts, upper body');
    expect(gaps[0]?.kind).toBe('contact-unbound');
    expect(gaps[0]?.detail).toContain('按在');
  });

  it('写成词组就算绑定成立', () => {
    expect(diagnoseContact('她的手按在她的胸口上', '1girl, hand on breast, upper body')).toEqual([]);
  });

  it('绑定词写在角色块里也算', () => {
    expect(
      diagnoseContact('她的手按在她的胸口上', '1girl, hand, breasts', [
        'girl, her hand pressing his chest',
      ]),
    ).toEqual([]);
  });

  it('NAI V5 手与身体部位分属不同角色块且无任何绑定词或 source#/target# 时报警', () => {
    const gaps = diagnoseContact('他的大手按在她的胸口揉捏', '1girl, 1boy', [
      'girl, large breasts, blush',
      'boy, faceless male, pov hands',
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.kind).toBe('contact-unbound');
  });

  it('正文没有接触动词时不管', () => {
    expect(diagnoseContact('她站在窗边看着雨', '1girl, hand, breasts')).toEqual([]);
  });

  it('画面里缺手或缺身体时不报警——那是别的问题', () => {
    expect(diagnoseContact('毛笔划过她的锁骨', '1girl, brush, collarbone')).toEqual([]);
    expect(diagnoseContact('毛笔划过她的锁骨', '1girl, hand, window')).toEqual([]);
  });
});

describe('castRetryNote', () => {
  it('把缺口写进话术并要求重开 thinking', () => {
    const note = castRetryNote([{ kind: 'wrong-count', detail: '只有 1 个 boy' }]);
    expect(note).toContain('<cast_retry>');
    expect(note).toContain('只有 1 个 boy');
    expect(note).toContain('毛笔' in {} ? '' : '道具');
    expect(note).toContain('直接从 <thinking> 开始');
  });

  it('接触类缺口额外给绑定词与取景两条改法', () => {
    const note = castRetryNote([{ kind: 'contact-unbound', detail: '手与胸并排' }]);
    expect(note).toContain('接触绑定');
    expect(note).toContain('绑定词');
    expect(note).toContain('close-up + hand focus');
  });

  it('没有接触类缺口时不啰嗦绑定词', () => {
    const note = castRetryNote([{ kind: 'wrong-count', detail: '只有 1 个 boy' }]);
    expect(note).not.toContain('close-up + hand focus');
  });
});
