import { describe, expect, it } from 'vitest';

import { harvestOutfit } from '@/autoTag/outfitHarvest';
import { auditDesign } from '@/data/designGuide';

describe('harvestOutfit', () => {
  it('takes the garment out of the character block, not the scene tags', () => {
    const out = harvestOutfit({
      tag: '1girl, indoors, wooden floor, sunlight, from above',
      characters: [{ name: '林晚晴', tag: '1girl, off shoulder, black corset top, long skirt, lace trim' }],
    });
    expect(out.wearer).toBe('林晚晴');
    expect(out.name).toBe('林晚晴 · 这身');
    expect(out.tags).toContain('black corset top');
    expect(out.tags).not.toContain('wooden floor');
    expect(out.pieces).toBeGreaterThan(0);
  });

  it('falls back to the base tag when the image has no character blocks', () => {
    const out = harvestOutfit({ tag: '1girl, white shirt, pleated skirt, thighhighs' }, '雨夜那身');
    expect(out.name).toBe('雨夜那身');
    expect(out.tags).toContain('white shirt');
    expect(out.wearer).toBe('');
  });

  it('classifies a single-garment outfit into its slot', () => {
    expect(harvestOutfit({ tag: '1girl, red bra, lace' }).slot).toBe('underwear');
    expect(harvestOutfit({ tag: '1girl, black thighhighs' }).slot).toBe('hosiery');
    expect(harvestOutfit({ tag: '1girl, white shirt' }).slot).toBe('top');
    expect(harvestOutfit({ tag: '1girl, pleated skirt' }).slot).toBe('bottom');
  });

  it('keeps a mixed outfit as a full set', () => {
    expect(harvestOutfit({ tag: '1girl, white shirt, pleated skirt' }).slot).toBe('full');
  });

  it('guesses era and category from the garment words', () => {
    const ancient = harvestOutfit({ tag: '1girl, chinese clothes, hanfu, wide sleeves, red dress' });
    expect(ancient.era).toBe('ancient');
    expect(ancient.category).toBe('eastern');

    const fantasy = harvestOutfit({ tag: '1girl, plate armor, cape' });
    expect(fantasy.era).toBe('fantasy');
    expect(fantasy.category).toBe('fantasy');
  });

  it('returns no pieces when there is nothing to harvest', () => {
    const out = harvestOutfit({ tag: '1girl, solo, indoors' });
    expect(out.pieces).toBe(0);
    expect(out.tags).toBe('');
  });

  it('merges several characters without duplicating tags', () => {
    const out = harvestOutfit({
      characters: [
        { name: '甲', tag: '1girl, white shirt' },
        { name: '乙', tag: '1girl, white shirt, black skirt' },
      ],
    });
    expect(out.tags.match(/white shirt/g)).toHaveLength(1);
    expect(out.tags).toContain('black skirt');
  });
});

describe('auditDesign', () => {
  it('passes a description with real structure', () => {
    const text =
      '短款立领外套,肩线收窄,袖口缀一圈细银链;内搭黑色缎面吊带,下接线面宽摆短裙,裙摆随步伐起褶,配黑色细跟短靴。';
    expect(auditDesign(text).ok).toBe(true);
  });

  it('rejects a short blurb', () => {
    expect(auditDesign('白衬衫').ok).toBe(false);
  });

  it('rejects praise without parts', () => {
    const issues = auditDesign('这一身美丽动人、惊艳绝伦、令人移不开目光,整体而言非常独特魅力,宛若仙子。').issues;
    expect(issues.some((x) => x.includes('赞美'))).toBe(true);
  });

  it('rejects a design-notes voice with no concrete parts', () => {
    const issues = auditDesign('严格遵循世界观设定,为了突出角色的身份,根据要求做了取舍。').issues;
    expect(issues.some((x) => x.includes('设计说明腔'))).toBe(true);
  });
});
