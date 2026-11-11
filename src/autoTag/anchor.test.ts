import { describe, expect, it } from 'vitest';

import { prepareTargetText } from '@/autoTag/clean';
import { injectImageTags, parseImagePlan } from '@/autoTag/protocol';

const STORY = [
  '雨声很轻。她站在窗前，指尖贴着玻璃。远处传来脚步声。',
  '',
  '门开了，他提着湿透的外套走进来。',
].join('\n');

const target = prepareTargetText(STORY, []);

function plan(image: Record<string, unknown>) {
  return parseImagePlan(
    JSON.stringify({ images: [{ tag: '1girl, window', ...image }] }),
    target.segments,
    1,
    3,
  );
}

describe('anchor resolution for images[].after', () => {
  it('locates a verbatim sentence and snaps the position to it', () => {
    const parsed = plan({ position: 'P9', after: '她站在窗前，指尖贴着玻璃。' });
    expect(parsed.images[0].position).toBe('P2');
    expect(parsed.images[0].charOffset).toBe(target.segments[1].charOffset);
  });

  it('tolerates a quote that drags along the trailing position marker', () => {
    const parsed = plan({ position: 'P1', after: '雨声很轻。⟦P1⟧' });
    expect(parsed.images[0].position).toBe('P1');
  });

  it('ignores punctuation and full-width/half-width differences', () => {
    const parsed = plan({ position: 'P3', after: '雨声很轻,她站在窗前指尖贴着玻璃' });
    expect(parsed.images[0].position).toBe('P2');
  });

  it('anchors after the last segment when the quote spans two sentences', () => {
    const parsed = plan({ position: 'P1', after: '她站在窗前，指尖贴着玻璃。远处传来脚步声。' });
    expect(parsed.images[0].position).toBe('P3');
  });

  it('falls back to the model position when the quote is not in the text', () => {
    const parsed = plan({ position: 'P2', after: '她回忆起了那段并不存在的往事。' });
    expect(parsed.images[0].position).toBe('P2');
    expect(parsed.images[0].scene?.quote).toBe('她回忆起了那段并不存在的往事。');
  });

  it('still rejects a plan whose position is absent from the target', () => {
    expect(() => plan({ position: 'P99', after: '同样不存在的一句话。' })).toThrow('不在目标正文可选位置中');
  });

  it('prefers the model position when the quote occurs more than once', () => {
    const repeated = prepareTargetText('她笑了。风吹过。她笑了。', []);
    const parsed = parseImagePlan(
      JSON.stringify({ images: [{ position: 'P3', after: '她笑了。', tag: '1girl' }] }),
      repeated.segments,
      1,
      3,
    );
    expect(parsed.images[0].position).toBe('P3');
  });

  it('injects the tag right after the anchored sentence, not at line end', () => {
    const parsed = plan({ position: 'P1', after: '雨声很轻。' });
    const output = injectImageTags(STORY, parsed.images);
    expect(output).toContain('雨声很轻。\n\n<bbi_image>');
    expect(output.indexOf('<bbi_image>')).toBeLessThan(output.indexOf('她站在窗前'));
  });
});

describe('per-image tolerance in multi-image plans', () => {
  it('keeps the images that land when one entry has an unusable position', () => {
    const parsed = parseImagePlan(
      JSON.stringify({
        images: [
          { position: 'P99', after: '这一句并不存在于目标正文里。', tag: '1girl' },
          { position: 'P2', after: '她站在窗前，指尖贴着玻璃。', tag: '1girl, window' },
        ],
      }),
      target.segments,
      1,
      3,
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].position).toBe('P2');
  });

  it('skips a malformed entry instead of failing the whole floor', () => {
    const parsed = parseImagePlan(
      JSON.stringify({ images: ['不是对象', { position: 'P1', after: '雨声很轻。', tag: '1girl' }] }),
      target.segments,
      1,
      3,
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].position).toBe('P1');
  });
});
