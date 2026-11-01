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
});
