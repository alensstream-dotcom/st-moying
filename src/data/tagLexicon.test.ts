import { describe, expect, it } from 'vitest';
import { TAG_LEXICON, inLexicon, lexiconMenuBlock } from '@/data/tagLexicon';

const KEYS = [
  'camera',
  'light',
  'scene',
  'clothing',
  'appearance',
  'body',
  'expression',
  'pose',
  'interaction',
  'prop',
] as const;

describe('tag lexicon', () => {
  it('keeps every class populated', () => {
    for (const key of KEYS) {
      expect(TAG_LEXICON[key].length, key).toBeGreaterThan(20);
    }
    expect(TAG_LEXICON.clothing.length).toBeGreaterThan(2000);
    expect(TAG_LEXICON.pose.length).toBeGreaterThan(250);
    expect(TAG_LEXICON.interaction.length).toBeGreaterThan(300);
    expect(TAG_LEXICON.scene.length).toBeGreaterThan(300);
  });

  it('holds only plain english tags', () => {
    const all = KEYS.flatMap((key) => TAG_LEXICON[key]);
    for (const tag of all) {
      expect(tag, tag).toBe(tag.toLowerCase());
      expect(tag, tag).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/);
      expect(tag, tag).not.toContain('_');
      expect(tag.length, tag).toBeLessThanOrEqual(48);
    }
    expect(all.length).toBe(new Set(all).size);
  });

  it('keeps the noise out', () => {
    const all = KEYS.flatMap((key) => TAG_LEXICON[key]);
    for (const junk of ['anime coloring', 'ass', 'ayastyle', 'official art', 'greyscale']) {
      expect(all, junk).not.toContain(junk);
    }
    expect(all.some((tag) => /style$/.test(tag))).toBe(false);
  });

  it('still carries the words the pipeline relies on', () => {
    for (const word of [
      'school uniform',
      'sailor collar',
      'pleated skirt',
      'thighhighs',
      'looking at viewer',
      'all fours',
      'against wall',
      'upper body',
    ]) {
      expect(inLexicon(word), word).toBe(true);
    }
    expect(inLexicon('hand on own head')).toBe(false);
  });

  it('renders a menu that fits the prompt budget', () => {
    const menu = lexiconMenuBlock();
    expect(menu).toContain('<Menu>');
    expect(menu).toContain('</Menu>');
    for (const key of KEYS) expect(menu).toContain(`[${key}]`);
    expect(menu.length).toBeGreaterThan(8000);
    expect(menu.length).toBeLessThan(26000);
    expect(lexiconMenuBlock()).toBe(menu);
  });
});
describe('floor retrieval', () => {
  it('picks the exact words the floor text names', async () => {
    const { retrieveLexiconWords, lexiconMenuBlock } = await import('@/data/tagLexicon');
    const words = retrieveLexiconWords('她套着开襟衫，里面是吊带，头发扎成双马尾。', 40);
    expect(words).toContain('cardigan');
    expect(words).toContain('camisole');
    expect(words).toContain('twintails');
  });



describe('tag normalisation', () => {
  it('splits a compound the backend cannot read', async () => {
    const { normaliseLexiconTag } = await import('@/data/tagLexicon');
    expect(normaliseLexiconTag('long hair, long straight hair, brown eyes')).toBe(
      'long hair, straight hair, brown eyes',
    );
    // black hair 不在表内（发色属角色档案），拆不动就原样留着——不猜。
    expect(normaliseLexiconTag('black long hair')).toBe('black long hair');
  });

  it('keeps a compound it cannot split cleanly', async () => {
    const { normaliseLexiconTag } = await import('@/data/tagLexicon');
    const awkward = 'blue pleated lantern skirt';
    expect(normaliseLexiconTag(awkward)).toBe(awkward);
  });

  it('keeps only one shot scale', async () => {
    const { normaliseLexiconTag } = await import('@/data/tagLexicon');
    expect(normaliseLexiconTag('1girl, cowboy shot, from above, full body')).toBe(
      '1girl, cowboy shot, from above',
    );
    expect(normaliseLexiconTag('upper body, full body, classroom')).toBe('upper body, classroom');
    expect(normaliseLexiconTag('portrait, close-up, blush')).toBe('portrait, blush');
  });

  it('drops repeats without reordering', async () => {
    const { normaliseLexiconTag } = await import('@/data/tagLexicon');
    expect(normaliseLexiconTag('arched back, blush, arched back, blush')).toBe('arched back, blush');
  });
});

describe('base echo', () => {
  it('drops what the single character block already owns', async () => {
    const { stripBaseEcho } = await import('@/data/tagLexicon');
    const base = '1girl, bedroom, night, dim lighting, on bed, arched back, legs apart, cowboy shot';
    const character = '1girl, black hair, arched back, legs apart, blush';
    expect(stripBaseEcho(base, [character])).toBe(
      '1girl, bedroom, night, dim lighting, on bed, cowboy shot',
    );
  });

  it('leaves multi character and empty cases alone', async () => {
    const { stripBaseEcho } = await import('@/data/tagLexicon');
    const base = '2girls, classroom, sitting';
    expect(stripBaseEcho(base, ['1girl, sitting', '1girl, sitting'])).toBe(base);
    expect(stripBaseEcho(base, [])).toBe(base);
  });
});

  it('never lets camera or light follow the floor text', async () => {
    const { retrieveLexiconWords, lexiconMenuBlock } = await import('@/data/tagLexicon');
    const floor = '傍晚的教室，光从窗户斜着落进来，她低头写字，从上方看得到发顶。';
    const words = retrieveLexiconWords(floor, 400);
    expect(words.length).toBeGreaterThan(0);
    expect(words.some((word) => TAG_LEXICON.camera.includes(word))).toBe(false);
    expect(words.some((word) => TAG_LEXICON.light.includes(word))).toBe(false);

    const menu = lexiconMenuBlock(floor);
    const cameraLine = menu.split('\n').find((line) => line.startsWith('[camera]')) ?? '';
    const lightLine = menu.split('\n').find((line) => line.startsWith('[light]')) ?? '';
    expect(cameraLine.split('：')[1].split(', ').length).toBe(TAG_LEXICON.camera.length);
    expect(lightLine.split('：')[1].split(', ').length).toBe(TAG_LEXICON.light.length);
  });

  it('tells the model camera and light are its own call', () => {
    const menu = lexiconMenuBlock('她坐在教室里。');
    expect(menu).toContain('你判断后自选');
    expect(menu).toContain('不要因为正文没写');
  });

  it('adds the retrieved line only when the floor mentions something', async () => {
    const { lexiconMenuBlock } = await import('@/data/tagLexicon');
    const plain = lexiconMenuBlock();
    const withFloor = lexiconMenuBlock('白色水手领制服衬衫扣到第二颗，蓝格纹百褶裙。');
    expect(plain).not.toContain('[from this floor]');
    expect(withFloor).toContain('[from this floor]');
    expect(withFloor).toContain('sailor collar');
    expect(withFloor.length).toBeGreaterThan(plain.length);
  });
});
