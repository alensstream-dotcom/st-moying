import { describe, expect, it } from 'vitest';
import { groundScenes, storyGarmentLine, storyGarments } from './storyGarments';

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
  it('一个镜头只留一个场所：客厅段落不把学校带进 Base', () => {
    const text = '她坐在二楼客厅的沙发上一边看选秀节目一边喝奶茶。明天还得回学校。';
    const out = groundScenes('1girl, living room, school, couch, sitting, wide shot', text);
    expect(out).toContain('living room');
    expect(out).not.toContain('school');
    expect(out).toContain('couch');
  });

  it('推开教室门走进去也是「人在教室里」', () => {
    const text = '她推开教室门走进去，在自己的座位上坐下。';
    const out = groundScenes('1girl, house, classroom, school, sitting', text);
    expect(out).toContain('classroom');
    expect(out).not.toContain('house');
  });

  it('楼梯段落不会混进卧室', () => {
    const text = '他站在楼梯下端，看着温岚走上二楼。';
    const out = groundScenes('1girl, 1boy, bedroom, stairs, cowboy shot', text);
    expect(out).toContain('stairs');
    expect(out).not.toContain('bedroom');
  });

  it('家具与房间共存：客厅的沙发不会被裁掉', () => {
    const text = '客厅里，她坐在沙发上。';
    expect(groundScenes('1girl, living room, couch, sitting', text)).toContain('couch');
  });
});
