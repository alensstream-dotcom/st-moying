import { describe, expect, it } from 'vitest';
import {
  diagnoseMonotonousShots,
  diagnoseShot,
  monotonousShotRetryNote,
  shotRetryNote,
} from '@/autoTag/shotCheck';

describe('diagnoseShot', () => {
  it('景别与机位都有时不算缺项', () => {
    const diag = diagnoseShot('1girl, close-up, from above, soft lighting, red eyes');
    expect(diag.missing).toEqual([]);
    expect(diag.softOnly).toBe(false);
  });

  it('只有景别没有机位:报缺机位', () => {
    expect(diagnoseShot('1girl, cowboy shot, soft lighting').missing).toEqual(['机位']);
  });

  it('只有机位没有景别:报缺景别', () => {
    expect(diagnoseShot('1girl, from behind, soft lighting').missing).toEqual(['景别']);
  });

  it('两样都没有:两条都报', () => {
    expect(diagnoseShot('1girl, black pantyhose, classroom').missing).toEqual(['景别', '机位']);
  });

  it('景别与机位拆在角色 tag 里也算数(V5 的常见写法)', () => {
    const diag = diagnoseShot('2girls, classroom, window light', ['a, from_above, upper body']);
    expect(diag.missing).toEqual([]);
  });

  it('pov 与 first_person_view 都算机位', () => {
    expect(diagnoseShot('1girl, pov_hands, cowboy shot, dim lighting').missing).toEqual([]);
    expect(diagnoseShot('1girl, first_person_view, full body, dim lighting').missing).toEqual([]);
  });

  it('下划线与空格写法都认', () => {
    expect(diagnoseShot('1girl, close_up, from_below, rim_lighting').missing).toEqual([]);
  });

  it('只差光线时标成软缺项,不算错', () => {
    const diag = diagnoseShot('1girl, upper body, from side');
    expect(diag.missing).toEqual(['光线']);
    expect(diag.softOnly).toBe(true);
  });

  it('空 tag 会同时报缺景别与机位', () => {
    expect(diagnoseShot('').missing).toEqual(['景别', '机位']);
  });
});

describe('shotRetryNote', () => {
  it('把缺的项写进提示,并给出可照抄的词表', () => {
    const note = shotRetryNote(['景别', '机位']);
    expect(note).toContain('景别 与 机位');
    expect(note).toContain('close-up');
    expect(note).toContain('from above');
    expect(note).toContain('不许为了让构图好看而改剧情');
  });

  it('只缺一项时不点名另一项', () => {
    const note = shotRetryNote(['机位']);
    expect(note).toContain('没有交代机位');
    expect(note).not.toContain('景别 与');
  });
});

describe('diagnoseMonotonousShots 同楼构图雷同检查', () => {
  it('同楼出现两张 upper body + from front 证件照连拍时报警', () => {
    const gaps = diagnoseMonotonousShots([
      { position: 'P2', tag: '1girl, upper body, from front, classroom' },
      { position: 'P6', tag: '1girl, upper body, straight-on, corridor' },
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.signature).toBe('upper+front');
    expect(gaps[0]?.positions).toEqual(['P2', 'P6']);
    expect(monotonousShotRetryNote(gaps)).toContain('<shot_variety_retry>');
  });

  it('景别或机位拉开层次时不报警', () => {
    const gaps = diagnoseMonotonousShots([
      { position: 'P2', tag: '1girl, full body, from behind, courtyard' },
      { position: 'P6', tag: '1girl, 1boy, cowboy shot, from side, across table' },
      { position: 'P9', tag: '1girl, close-up, from above, tears' },
    ]);
    expect(gaps).toEqual([]);
  });
});
