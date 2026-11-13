import { describe, expect, it } from 'vitest';
import { diagnoseDistance, distanceLabel, distanceRetryNote, recommendShot, tagDistance } from '@/autoTag/shotGuide';

describe('shotGuide 景别判据', () => {
  it('正文点到阴蒂/穴口时建议下体特写', () => {
    expect(recommendShot('他的指腹碾过她的阴蒂,她整个人绷紧')?.distance).toBe('close');
    expect(recommendShot('指尖探进穴口,湿得一塌糊涂')?.distance).toBe('close');
    expect(recommendShot('穴口')?.tags).toBe('lower body');
  });

  it('胸与乳首分两档:乳首要 close,胸是 upper body', () => {
    expect(recommendShot('他含住她的乳首轻轻吸吮')?.distance).toBe('close');
    expect(recommendShot('她的乳房从衣领里挤出来')?.distance).toBe('upper');
  });

  it('同一句里既写胸又写腰时取更近的一档', () => {
    // 腰臀只算 mid,胸是 upper,取近的。
    expect(recommendShot('他的手从腰肢滑到胸口')?.distance).toBe('upper');
  });

  it('一句里只有动作、没有部位时不硬给结论', () => {
    expect(recommendShot('她点了点头')).toBeNull();
    expect(recommendShot('')).toBeNull();
  });

  it('景别词识别:远景不能被认成近景', () => {
    expect(tagDistance('close-up, upper body')).toBe('close');
    expect(tagDistance('upper body')).toBe('upper');
    expect(tagDistance('cowboy shot')).toBe('mid');
    expect(tagDistance('full body, wide shot')).toBe('far');
    expect(tagDistance('standing')).toBeNull();
  });

  it('过远判定留一档余量', () => {
    const line = '他含住她的乳首';
    // 建议 close:实际 upper 算过,actual cowboy 才报警。
    expect(diagnoseDistance(line, 'upper body')).toBeNull();
    expect(diagnoseDistance(line, 'cowboy shot')?.suggest).toBe('close-up');
    expect(diagnoseDistance(line, 'full body')).not.toBeNull();
  });

  it('实际景别比建议更近时不报警', () => {
    expect(diagnoseDistance('她的胸口起伏', 'close-up')).toBeNull();
  });

  it('正文没点名部位时一律不报警,避免误伤', () => {
    expect(diagnoseDistance('她点了点头', 'full body')).toBeNull();
  });

  it('重试提示逐条引用正文原词与建议词', () => {
    const note = distanceRetryNote([
      { position: 'P2', points: ['阴蒂'], suggest: 'lower body', angle: 'from below', reason: 'r', actual: 'far' },
    ]);
    expect(note).toContain('P2');
    expect(note).toContain('阴蒂');
    expect(note).toContain('lower body');
    expect(note).toContain('只改景别与机位');
  });

  it('档位有中文名,供提示拼装', () => {
    expect(distanceLabel('close')).toBe('局部特写');
    expect(distanceLabel('far')).toBe('全景');
  });

  it('腰臀大腿/跪姿/掀裙等曲线看点建议 cowboy shot,并主动拦截 full body 远景', () => {
    const s1 = '她双膝跪在榻上,自己掀开裙摆露出大腿根,脸颊泛红地仰头望你';
    expect(recommendShot(s1)?.distance).toBe('mid');
    // 允许 cowboy shot 拍全跪姿大腿与绯红脸颊
    expect(diagnoseDistance(s1, '1girl, cowboy shot, kneeling, lifting skirt, from above')).toBeNull();
    // 严禁退化成 full body 远景
    expect(diagnoseDistance(s1, '1girl, full body, kneeling')?.suggest).toBe('cowboy shot');
  });

  it('抚摸/摩挲/抓住手腕/唇/眼神等亲密细节即使带走廊/站在等词也绝不放宽成全身远景', () => {
    const s1 = '她站在走廊窗边,他的指腹摩挲着她泛红的脸颊';
    expect(recommendShot(s1)?.distance).toBe('close');
    expect(diagnoseDistance(s1, '1girl, 1boy, full body')).not.toBeNull();
    expect(diagnoseDistance(s1, '1girl, 1boy, cowboy shot')).not.toBeNull();
    expect(diagnoseDistance(s1, '1girl, 1boy, close-up, caressing cheek')).toBeNull();

    const s2 = '她站在桌前,眼眶泛红,嘴角轻轻抿紧';
    expect(recommendShot(s2)?.distance).toBe('close');
    expect(diagnoseDistance(s2, '1girl, full body')).not.toBeNull();
  });

  it('强解剖焦点(阴蒂/乳首/足交/锁骨)与跪姿/全身词同句时,始终锁定更近特写', () => {
    const line = '她双膝跪在镜前,他的指腹碾过她的阴蒂';
    expect(recommendShot(line)?.distance).toBe('close');
    expect(diagnoseDistance(line, '1girl, 1boy, cowboy shot')).not.toBeNull();
    expect(diagnoseDistance(line, '1girl, 1boy, full body')).not.toBeNull();

    const footLine = '她抬起白皙的足弓与脚趾踩在他胯间';
    expect(recommendShot(footLine)?.distance).toBe('close');
    expect(diagnoseDistance(footLine, '1girl, 1boy, full body')).not.toBeNull();
  });

  it('跨句选位 P(k-1) 建立跪姿/掀裙(mid)、P(k) 写女主潮红眼神时,允许用 cowboy shot 拍全但仍拦截 full body', () => {
    const prev = '她跨坐在他腰间,裙摆滑到大腿根';
    const curr = '她脸颊潮红,眼神迷离地望着你';
    expect(diagnoseDistance(curr, '1girl, 1boy, cowboy shot, straddling', undefined, prev)).toBeNull();
    expect(diagnoseDistance(curr, '1girl, 1boy, full body, straddling', undefined, prev)).not.toBeNull();
  });

  it('支持识别 portrait / lower body 及 V5 characterTags 中的景别', () => {
    expect(tagDistance('portrait, 1girl')).toBe('close');
    expect(tagDistance('lower body, panties')).toBe('close');
    expect(tagDistance('indoors, classroom', ['girl, cowboy shot, from side'])).toBe('mid');
    expect(
      diagnoseDistance('她的乳房从衣领里挤出来', 'indoors', ['girl, upper body']),
    ).toBeNull();
  });

  it('只有神态的句子遇到接触动作时不压成特写,退到 upper body', () => {
    // 前戏里最常出的事:这一句只写了「她脸颊泛红」,规则判 close-up,
    // 本机再按建议硬改成特写——手在胸上那一半全被裁掉,交一张表情特写。
    const line = '她脸颊泛红,眼神迷离';
    const contact = '1girl, 1boy, hand on breast, close-up';
    expect(diagnoseDistance(line, contact, [])?.suggest).toBe('upper body');
    // 没接触的纯粹神态(一个人坐着发怔)照旧给特写。
    expect(diagnoseDistance(line, '1girl, solo, close-up', [])).toBeNull();
    // 接触动作写在角色块里也算。
    expect(diagnoseDistance(line, '1girl, close-up', ['1boy, hand on waist'])).not.toBeNull();
  });
});
