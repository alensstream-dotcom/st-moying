import { describe, expect, it } from 'vitest';

import { lockedFields } from './appearancePolicy';
import { imageAppearance } from './characterStudio';
import { emptyCharFields, type CharTagEntry } from './charTags';

function entry(fields: Partial<CharTagEntry['fields']> = {}): CharTagEntry {
  return {
    name: '林晚晴',
    fields: { ...emptyCharFields(), ...fields },
    raw: '',
    nl: '',
    source: 'ai',
    desc: '',
    history: [],
  };
}

describe('lockedFields', () => {
  it('只锁有值的字段，空字段不写进 policy', () => {
    const fields = lockedFields(entry({ hair: 'long black hair', eyes: '   ' }));
    expect(fields).toEqual({ hair: 'long black hair' });
    expect(Object.hasOwn(fields, 'eyes')).toBe(false);
  });

  it('服装不进外貌锁', () => {
    expect(lockedFields(entry({ hair: 'long hair', outfit: 'white shirt' }))).not.toHaveProperty(
      'outfit',
    );
  });
});

describe('imageAppearance', () => {
  it('图里没有同人身份 tag 时保留原有 fandom', () => {
    const next = imageAppearance(entry({ fandom: 'tifa (ff7)', hair: 'black' }), '1girl, black hair');
    expect(next.fields.fandom).toBe('tifa (ff7)');
    expect(next.fields.hair).toBe('black hair');
  });

  it('图里带同人身份 tag 时以图为准', () => {
    const next = imageAppearance(entry({ fandom: 'old' }), 'tifa (ff7), black hair');
    expect(next.fields.fandom).toBe('tifa (ff7)');
  });
});
