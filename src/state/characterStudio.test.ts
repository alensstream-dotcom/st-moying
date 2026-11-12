import { describe, expect, it } from 'vitest';
import { imageAppearance } from './characterStudio';
import { emptyCharFields, type CharTagEntry } from './charTags';

/**
 * 点「固定形象」时把图里的原始 tag 拆成档案字段。
 *
 * 饰物（发带/发夹/眼镜/项链）容易被当成头发或干脆丢掉：进 hair 会污染发色发型，
 * 被丢掉则用户点完固定形象发带就没了。它们统一进 extra。
 */
const entry = (): CharTagEntry => ({
  name: '林晚晴',
  fields: emptyCharFields(),
  raw: '',
  nl: '',
  source: 'manual',
  desc: '',
  history: [],
});

describe('imageAppearance 字段归类', () => {
  it('饰物进 extra，不污染发色发型', () => {
    const out = imageAppearance(
      entry(),
      '1girl, long black hair, blue eyes, hair ribbon, hairpin, glasses, silver necklace',
    );
    expect(out.fields.hair).toBe('long black hair');
    expect(out.fields.eyes).toBe('blue eyes');
    expect(out.fields.extra).toContain('hair ribbon');
    expect(out.fields.extra).toContain('glasses');
    expect(out.fields.extra).toContain('silver necklace');
    expect(out.fields.hair).not.toContain('hair ribbon');
  });

  it('一个词只落进第一个命中的字段，不重复归类', () => {
    const out = imageAppearance(entry(), '1girl, hair ribbon, hairpin');
    expect(out.fields.hair).not.toContain('hairpin');
  });
});
