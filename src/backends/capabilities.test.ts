import { describe, expect, it } from 'vitest';
import { fitCaptionBudget, resolveNaiCapabilities } from './capabilities';
import { buildNaiParameters, globalStyleOnly } from './nai';
import { settings } from '@/state/settings';
describe('NAI capability boundary and prompt budgets', () => {
  it('prevents a global style recipe from imposing one face or wardrobe on every character', () => {
    expect(globalStyleOnly('artist:example, black hair, blue eyes, 1girl, robe, watercolor')).toBe('artist:example, watercolor');
  });
  it('cannot enable unsupported character prompts and permits an explicit proxy downgrade', () => {
    expect(resolveNaiCapabilities('nai-diffusion-3', { characters: 'auto', vibes: 'auto', maxPromptChars: 0 }).characters).toBe(false);
    const caps = resolveNaiCapabilities('nai-diffusion-4-5-full', { characters: 'off', vibes: 'off', maxPromptChars: 0 });
    const params = buildNaiParameters({ ...settings.nai, model: 'nai-diffusion-4-5-full' }, { prompt: 'scene', characters: [{ name: 'x', tag: 'black hair', nl: '' }], seed: 1, capabilities: caps });
    expect((params.v4_prompt as { caption: { char_captions: unknown[] } }).caption.char_captions).toEqual([]);
  });
  it('trims scene surplus before characters and records discarded phrases', () => {
    const result = fitCaptionBudget('forest, sunlight, fog, many trees, landscape, extra atmosphere, distant mountains, cloudy sky', ['girl, black hair, blue eyes, hanfu'], 100);
    expect(result.characters).toEqual(['girl, black hair, blue eyes, hanfu']);
    expect(result.base.length + result.characters[0].length).toBeLessThanOrEqual(100);
    expect(result.removed.length).toBeGreaterThan(0);
  });
  it('rejects a budget that would discard character or key garment state', () => {
    expect(() => fitCaptionBudget('scene', ['x'.repeat(160)], 100)).toThrow('完整人物');
    expect(fitCaptionBudget('scene', ['long character description'], 0).removed).toEqual([]);
  });
});
