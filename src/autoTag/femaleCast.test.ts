import { describe, expect, it } from 'vitest';
import type { CharTagEntry } from '@/state/charTags';
import type { IdentityFact } from '@/state/characterIdentity';
import type { TargetSegment } from './clean';
import type { ImageInsertion } from './protocol';
import { femaleCastNames, ensureFemaleSubjects, femaleName } from './femaleCast';
import { diagnoseFemaleSubject } from './castCheck';

function entry(name: string, sex: string, extra: Partial<CharTagEntry> = {}): CharTagEntry {
  return {
    name,
    fields: { sex },
    raw: '',
    nl: '',
    source: 'manual',
    desc: '',
    history: [],
    ...extra,
  } as unknown as CharTagEntry;
}

function segment(id: string, text: string): TargetSegment {
  return { id, text, sourceLine: 0, charOffset: 0 } as unknown as TargetSegment;
}

function image(position: string, tag: string, characters: { name: string; tag: string; nl?: string }[] = []): ImageInsertion {
  return {
    position,
    tag,
    nl: '',
    characters,
    after: '',
    sourceLine: 0,
    charOffset: 0,
    size: 'portrait',
  } as unknown as ImageInsertion;
}

const story = '她坐在床边，风千华解开衬衫扣子。男人推门进来，屋外下着雨。';

const entries = [entry('风千华', '1girl'), entry('周野', '1boy')];
const facts: IdentityFact[] = [];

describe('femaleName', () => {
  it('reads the library sex field', () => {
    expect(femaleName('风千华', entries, facts, story)).toBe(true);
    expect(femaleName('周野', entries, facts, story)).toBe(false);
  });

  it('falls back to the story pronouns for an unprofiled name', () => {
    expect(femaleName('苏晚', entries, facts, '苏晚抬手把头发挽到耳后，她笑了。')).toBe(true);
    expect(femaleName('苏晚', entries, facts, '苏晚抬手把头发挽到耳后，他笑了。')).toBe(false);
  });

  it('lets the library sex field win over a stray pronoun', () => {
    expect(femaleName('周野', entries, facts, '周野坐下，她叹了口气。')).toBe(false);
  });
});

describe('femaleCastNames', () => {
  it('collects library women and identity-female names only', () => {
    const withFact: IdentityFact[] = [
      {
        name: '苏晚',
        gender: 'female',
        heroine: true,
        source: 'story',
        evidence: '她笑了',
        reason: '正文用她指代',
      } as IdentityFact,
    ];
    const names = femaleCastNames(entries, withFact, `${story}苏晚也走了进来，她没说话。`, ['苏晚']);
    expect(names).toContain('风千华');
    expect(names).toContain('苏晚');
    expect(names).not.toContain('周野');
  });
});

describe('ensureFemaleSubjects', () => {
  it('keeps an image that already has a woman', () => {
    const plan = [image('P1', '1girl, bed', [{ name: '风千华', tag: 'girl', nl: 'a woman' }])];
    const result = ensureFemaleSubjects(plan, [segment('P1', story)], entries, facts, story);
    expect(result.images).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.images[0].characters).toHaveLength(1);
  });

  it('attaches the woman named in that segment when the model only drew the man', () => {
    const plan = [image('P1', '1boy, rain, door', [{ name: '周野', tag: 'boy' }])];
    const result = ensureFemaleSubjects(
      plan,
      [segment('P1', '风千华坐在床边，男人推门进来，屋外下着雨。')],
      entries,
      facts,
      story,
    );
    expect(result.dropped).toHaveLength(0);
    const characters = result.images[0].characters ?? [];
    expect(characters.map((item) => item.name)).toContain('风千华');
    expect(result.images[0].tag).toContain('1girl');
    expect(result.attached[0]).toContain('风千华');
  });

  it('uses the last mentioned woman when the segment only says 她', () => {
    const plan = [image('P1', '1boy, rain')];
    const result = ensureFemaleSubjects(
      plan,
      [segment('P1', '雨声里，她坐在床边没动。')],
      entries,
      facts,
      '风千华坐在床边。男人推门进来。雨声里，她坐在床边没动。',
    );
    expect(result.dropped).toHaveLength(0);
    expect(result.images[0].characters?.map((item) => item.name)).toContain('风千华');
  });

  it('drops a male-only image when the segment has no woman at all', () => {
    const plan = [image('P1', '1boy, rain, street', [{ name: '周野', tag: 'boy' }])];
    const result = ensureFemaleSubjects(
      plan,
      [segment('P1', '男人推门进来，屋外下着雨。')],
      entries,
      facts,
      '男人推门进来，屋外下着雨。',
    );
    expect(result.images).toHaveLength(0);
    expect(result.dropped[0]).toContain('没有女性角色');
  });

  it('accepts a bare 1girl base tag as female subject', () => {
    const plan = [image('P2', '1girl, close-up')];
    const result = ensureFemaleSubjects(plan, [segment('P2', '她抬眼看他。')], entries, facts, story);
    expect(result.dropped).toHaveLength(0);
  });
});

describe('diagnoseFemaleSubject', () => {
  const femaleNames = ['风千华'];

  it('accepts a girl count or a female character block', () => {
    expect(diagnoseFemaleSubject('她看他。', image('P1', '1girl'), femaleNames)).toHaveLength(0);
    expect(
      diagnoseFemaleSubject('她看他。', image('P1', '1boy', [{ name: '风千华', tag: 'girl' }]), femaleNames),
    ).toHaveLength(0);
  });

  it('reports a missing woman when the segment names her', () => {
    const gaps = diagnoseFemaleSubject('风千华坐在床边。', image('P1', '1boy'), femaleNames);
    expect(gaps[0].kind).toBe('missing-female');
    expect(gaps[0].detail).toContain('风千华');
  });

  it('reports a missing woman for a pronoun-only segment', () => {
    const gaps = diagnoseFemaleSubject('她坐在床边。', image('P1', '1boy'), femaleNames);
    expect(gaps[0].detail).toContain('女性指代');
  });

  it('reports a background-only segment', () => {
    const gaps = diagnoseFemaleSubject('屋外下着雨。', image('P1', 'rain, street'), femaleNames);
    expect(gaps[0].detail).toContain('没有女性角色在场');
  });
});
