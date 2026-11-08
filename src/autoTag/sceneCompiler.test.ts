import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileSceneImage } from './sceneCompiler';
import { parseImagePlan, type ImageInsertion } from './protocol';
import { prepareTargetText } from './clean';
import { applySceneEvents, legacyCharacter, type SceneState } from '@/state/sceneState';
import { emptyCharFields } from '@/state/charTags';
import { buildNaiParameters, generateNaiImage } from '@/backends/nai';
import { settings } from '@/state/settings';
import { requestTraces } from '@/state/requestTrace';
import { strToU8, zipSync } from 'fflate';

function state(): SceneState {
  const c = legacyCharacter({ name: '小雪', fields: { ...emptyCharFields(), hair: 'long black hair', eyes: 'blue eyes' },
    raw: '', nl: '', source: 'ai', history: [], desc: '' }, 'a');
  return applySceneEvents({ characters: [c], warnings: [] }, [
    { kind: 'identity', name: '小雪', sourceLine: 0, evidence: '小雪是女子', gender: 'female', isHeroine: true },
    { kind: 'outfit', name: '小雪', sourceLine: 0, evidence: '小雪穿着外袍与内衫', operation: 'change', garments: [
      { id: 'outer', design: 'blue hanfu, white trim', state: { location: 'on_chair', fastening: 'open' } },
      { id: 'inner', design: 'white shirt', state: { location: 'on_body' } },
    ] },
  ], 'a', 'v1', 0);
}
function image(): ImageInsertion {
  return { position: 'P1', sourceLine: 0, tag: '1girl, blue hanfu, blonde hair, forest, portrait', nl: 'wearing blue hanfu', negative: '', size: 'portrait',
    charOffset: 0,
    characters: [{ name: '小雪', tag: '1girl, blonde hair, green eyes, blue hanfu, closed robe, smile', nl: 'blonde wearing closed robe' }] };
}
afterEach(() => vi.unstubAllGlobals());
describe('scene compiler and real NAI request', () => {
  it('keeps homonymous characters from different works isolated through serialization and v4 captions', () => {
    const s = applySceneEvents({ characters: [], warnings: [] }, ['A', 'B'].map((work, index) => ({ name: '小雪', work, kind: 'identity', sourceLine: 0,
      evidence: '小雪是女子', gender: 'female', appearance: { hair: index ? 'silver hair' : 'black hair', eyes: index ? 'red eyes' : 'blue eyes' } })), 'a', 'v', 0);
    const im = image(); im.characters = ['A', 'B'].map(work => ({ name: '小雪', work, tag: 'blonde hair, standing', nl: '' }));
    compileSceneImage(im, s, true, false);
    expect(im.characters[0].characterId).not.toBe(im.characters[1].characterId);
    expect(im.characters[0].tag).toContain('black hair'); expect(im.characters[1].tag).toContain('silver hair');
    const params = buildNaiParameters({ ...settings.nai, model: 'nai-diffusion-4-5-full' }, { prompt: im.tag, characters: im.characters, seed: 1 });
    const captions = (params.v4_prompt as { caption: { char_captions: Array<{ char_caption: string }> } }).caption.char_captions;
    expect(captions[0].char_caption).not.toContain('silver hair'); expect(captions[1].char_caption).not.toContain('black hair');
  });
  it('removes off-body garment tags and contradictory free NL from the final v4 payload', () => {
    const s = state(), im = image(), before = JSON.stringify(s);
    expect(compileSceneImage(im, s, true, true)).toEqual([]);
    const params = buildNaiParameters({ ...settings.nai, model: 'nai-diffusion-4-5-full', artistPresets: [], activeArtistId: '' }, { prompt: im.tag, nl: im.nl, characters: im.characters, seed: 42 });
    const json = JSON.stringify(params);
    const v4 = params.v4_prompt as { caption: { base_caption: string; char_captions: Array<{ char_caption: string }> } };
    expect(v4.caption.base_caption).toContain('forest');
    expect(v4.caption.base_caption).not.toContain('hair');
    expect(v4.caption.char_captions[0].char_caption).toContain('long black hair');
    expect(v4.caption.char_captions[0].char_caption).toContain('white shirt');
    expect(im.characters[0].tag).not.toContain('blue hanfu');
    expect(im.characters[0].nl).toContain('on chair, not worn');
    expect(json).not.toContain('blonde');
    expect(json).not.toContain('closed robe');
    expect(JSON.stringify(s)).toBe(before);
  });
  it('redraw changes only image randomness and retains the same state/design', () => {
    const s = state(), first = image(), second = image();
    compileSceneImage(first, s, true, false); compileSceneImage(second, s, true, false);
    expect(second).toEqual(first);
    const config = { ...settings.nai, model: 'nai-diffusion-4-5-full' as const };
    const a = buildNaiParameters(config, { prompt: first.tag, characters: first.characters, seed: 1 });
    const b = buildNaiParameters(config, { prompt: second.tag, characters: second.characters, seed: 2 });
    expect({ ...b, seed: 1 }).toEqual(a);
    expect(second.characters[0].nl).toBe('');
  });
  it('applying clothing state cannot alter the stable face or gender', () => {
    const s = state(), c = s.characters[0];
    const next = applySceneEvents(s, [{ kind: 'outfit', operation: 'change', name: c.name, sourceLine: 0, evidence: '小雪换上黑衣', garments: [
      { id: 'coat', design: 'black coat', state: { location: 'on_body' } },
    ] }], 'a', 'v2', 1);
    expect(next.characters[0].baseAppearance).toEqual(c.baseAppearance);
    expect(next.characters[0].identity).toEqual(c.identity);
    expect(next.characters[0].outfit?.outfitInstanceId).not.toBe(c.outfit?.outfitInstanceId);
    expect(c.outfit?.garments[0].design).toBe('blue hanfu, white trim');
  });
  it('drops appearance and default fastening tags from clothing designs before compiling', () => {
    const s = state(), im = image();
    s.characters[0].outfit!.garments = [{ id: 'outer', design: 'closed robe, blonde hair, green eyes, 1girl', state: { location: 'on_body', fastening: 'open' } }];
    compileSceneImage(im, s, true, true);
    expect(im.characters[0].tag).toContain('robe');
    expect(im.characters[0].tag).toContain('open clothes');
    expect(im.characters[0].tag).not.toContain('closed robe');
    expect(im.characters[0].tag).not.toContain('blonde');
    expect(im.characters[0].nl).not.toContain('green eyes');
  });
  it('separates two named characters and explicitly reports unsupported backends', () => {
    const s = state(), im = image();
    const other = JSON.parse(JSON.stringify(s.characters[0]));
    Object.assign(other, { characterId: 'other', name: '小雨', aliases: ['小雨'], baseAppearance: { hair: 'silver hair', eyes: 'red eyes' } });
    s.characters.push(other);
    im.characters.push({ name: '小雨', tag: 'black hair, blue eyes, standing', nl: '' });
    compileSceneImage(im, s, true, false);
    expect(im.characters[0].tag).toContain('long black hair');
    expect(im.characters[0].tag).not.toContain('silver hair');
    expect(im.characters[1].tag).toContain('silver hair');
    expect(im.characters[1].tag).not.toContain('black hair');
    expect(compileSceneImage(im, s, false, false).join()).toContain('不支持独立人物提示');
  });
  it('falls back to a deterministic flat prompt for one character on older backends', () => {
    const im = image();
    compileSceneImage(im, state(), false, false);
    expect(im.tag).toContain('white shirt');
    expect(im.tag).toContain('long black hair');
    expect(im.tag).not.toContain('blue hanfu');
    expect(im.tag).not.toContain('blonde hair');
  });
  it('parses evidence-backed scene events through the actual image-plan protocol', () => {
    const source = '小雪穿着青色外袍。';
    const plan = parseImagePlan(JSON.stringify({ images: [image()], sceneEvents: [{ name: '小雪', kind: 'outfit', position: 'P1', evidence: source, operation: 'patch', garments: [{ id: 'outer', state: { fastening: 'open' } }] }] }), prepareTargetText(source, []).segments, 1, 1);
    expect(plan.sceneEvents?.[0].garments?.[0].state).toEqual({ fastening: 'open' });
  });
  it('captures the exact dispatched JSON (except reference data) with a mocked NAI ZIP response', async () => {
    const im = image(); compileSceneImage(im, state(), true, true);
    const zip = zipSync({ 'image.png': strToU8('mock image') });
    const fetchMock = vi.fn().mockResolvedValue(new Response(zip, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateNaiImage({ ...settings.nai, key: 'SUPER_SECRET', url: 'https://test.invalid', model: 'nai-diffusion-4-5-full', vibes: [], artistPresets: [], activeArtistId: '' }, {
      prompt: im.tag, nl: im.nl, characters: im.characters, seed: 42,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parameters.seed).toBe(42);
    expect(JSON.stringify(body.parameters.v4_prompt)).toContain('white shirt');
    expect(JSON.stringify(body.parameters.v4_prompt)).not.toContain('blonde');
    const expected = JSON.parse(JSON.stringify(body));
    for (const k of Object.keys(expected.parameters)) if (/reference_image/i.test(k)) expected.parameters[k] = '[reference data omitted]';
    expect(result.usage.request).toEqual(expected);
    expect(requestTraces[0].body).toEqual(expected);
    expect(JSON.stringify(result.usage)).not.toContain('SUPER_SECRET');
    expect(result.result.url).toContain('data:image/png;base64,');
  });
});
