import { describe, expect, it } from 'vitest';
import { auditDesign, DESIGN_AUDIT_RULE, DESIGN_CHAIN, DESIGN_TAG_RULE, EMBODIED_BLOCK, thinDesign } from './designGuide';

describe('DESIGN_CHAIN', () => {
  it('covers silhouette, colour, material, pattern and shoes', () => {
    for (const key of ['剪影', '主色', '材质', '纹样', '鞋', '自查']) {
      expect(DESIGN_CHAIN).toContain(key);
    }
  });

  it('tells the model to turn prose into standalone tags', () => {
    expect(DESIGN_TAG_RULE).toMatch(/独立英文标签/);
  });
});

describe('EMBODIED_BLOCK', () => {
  it('requires support, contact and prop anchoring', () => {
    for (const key of ['重心', '接触', '落点']) expect(EMBODIED_BLOCK).toContain(key);
  });
});

describe('auditDesign', () => {
  it('flags a description that is too short', () => {
    expect(auditDesign('红裙子').issues).toContain('描述太短,撑不出轮廓');
  });

  it('flags praise without concrete parts', () => {
    const text = '她穿着一身惊艳绝伦、美丽动人的衣裳，整体而言令人移不开目光，独特魅力扑面而来，是那种一眼万年的风格。';
    const result = auditDesign(text);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('只有赞美词,没有可画细节');
  });

  it('flags design-talk that hides behind "符合设定"', () => {
    const result = auditDesign('这套衣服严格遵循世界观设定，根据身份要求设计');
    expect(result.issues).toContain('偏"设计说明腔",缺具体部件');
  });

  it('passes a concrete description', () => {
    const text =
      '短款立领白衬衫，外层罩一件开到腰际的墨绿马甲，腰间用两道银色扣带收紧；' +
      '下装是高腰阔腿长裤，裤脚压出硬褶，露出一双细跟短靴的鞋头。';
    const result = auditDesign(text);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('thinDesign', () => {
  it('只有两个词的白衬衫黑裙算薄', () => {
    expect(thinDesign('white shirt, black skirt')).toBe(true);
    expect(thinDesign('')).toBe(true);
  });

  it('带剪裁材质颜色的算够用', () => {
    expect(thinDesign('off shoulder black corset top, silk ribbon, long pleated skirt')).toBe(false);
  });

  it('自查口径里写清了至少要能点出哪几类', () => {
    for (const key of ['剪裁', '材质', '颜色分块', '不合格']) expect(DESIGN_AUDIT_RULE).toContain(key);
  });
});
