import { describe, expect, it } from 'vitest';
import { storyGarmentLine, storyGarments } from './storyGarments';

describe('storyGarments', () => {
  it('reads a uniform from statement-style prose', () => {
    const text = '林夏坐在靠窗的位置抄昨天的笔记，白色水手领制服衬衫扣到第二颗，蓝格纹百褶裙平整地铺在椅面上，长袜与皮鞋穿得整齐。';
    const got = storyGarments(text);
    expect(got).toContain('pleated skirt');
    expect(got).toContain('shirt');
    expect(got).toContain('loafers');
  });

  it('reads a swimsuit from a change-of-clothes line', () => {
    expect(storyGarments('她换上黑色的连体竞泳泳衣，肩带在背后打了个交叉。')).toContain('swimsuit');
  });

  it('returns nothing for prose without garments', () => {
    expect(storyGarments('她抬头看向窗外的蝉鸣，指尖在桌面上敲了两下。')).toEqual([]);
    expect(storyGarmentLine('她抬头看向窗外。')).toBe('');
  });

  it('renders the prompt line with the text-over-ledger rule', () => {
    const line = storyGarmentLine('蓝格纹百褶裙压在课桌边缘。');
    expect(line).toContain('【本楼正文衣物】');
    expect(line).toContain('以本楼正文为准');
  });
});
