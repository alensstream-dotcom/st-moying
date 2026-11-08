import { describe, expect, it } from 'vitest';
import { applyVisualBinding, BUILTIN_VISUAL_MATERIALS, cloneVisual, createBinding, defaultWorld, fillWorldDefaults, inferWorld, rollMaterial, searchMaterials } from './visualDesign';
import { legacyCharacter, type SceneState } from './sceneState';
import { emptyCharFields } from './charTags';
import type { VisualMaterial } from './visualTypes';
const person = () => legacyCharacter({ name: '小雪', fields: { ...emptyCharFields(), hair: 'black hair', eyes: 'blue eyes' }, raw: '', nl: '', source: 'manual', desc: '', history: [] }, 'chat');
const state = (): SceneState => ({ characters: [person()], warnings: [] });
describe('world defaults and local material binding', () => {
  it('infers cultivation/historical/modern worlds from card text', () => {
    expect(inferWorld('仙俠宗門')).toBe('xianxia'); expect(inferWorld('现代校园')).toBe('modern'); expect(inferWorld('古代江湖')).toBe('historical');
  });
  it('creates persistent ancient design snapshots on first unknown outfit, then never rematches', () => {
    const s = state(), world = { ...defaultWorld(), setting: 'xianxia' as const };
    fillWorldDefaults(s, world, BUILTIN_VISUAL_MATERIALS, 0);
    expect(s.characters[0].outfit?.design).toContain('hanfu');
    expect(s.characters[0].visualBindings?.[0].version).toBe(1);
    const before = cloneVisual(s);
    fillWorldDefaults(s, { ...world, wardrobeDefaults: 'missing' }, [], 10);
    expect(s).toEqual(before);
  });
  it('never overrides an explicitly dressed modern traveller in a cultivation world', () => {
    const s = state(); s.characters[0].outfit = { outfitInstanceId: 'explicit', design: 'modern jacket', garments: [], provenance: '原文：穿现代外套' };
    fillWorldDefaults(s, { ...defaultWorld(), setting: 'xianxia' }, BUILTIN_VISUAL_MATERIALS, 0);
    expect(s.characters[0].outfit.design).toBe('modern jacket');
  });
  it('clothing-only application keeps face and identity and can preserve partial garment state', () => {
    const c = person(); applyVisualBinding(c, createBinding(BUILTIN_VISUAL_MATERIALS[0], 'outfit', 0, 0), 'change');
    c.outfit!.garments[0].state = { location: 'on_chair', fastening: 'open', leftSleeve: 'off_arm' };
    const before = cloneVisual(c);
    const material = { ...cloneVisual(BUILTIN_VISUAL_MATERIALS[0]), appearance: { hair: 'blonde hair' } };
    applyVisualBinding(c, createBinding(material, 'outfit', 1, 2, 3), 'preserve');
    expect(c.baseAppearance).toEqual(before.baseAppearance); expect(c.identity).toEqual(before.identity);
    expect(c.outfit?.garments[0].state).toEqual(before.outfit?.garments[0].state);
  });
  it('old binding captures design version and is detached from later template edits', () => {
    const material = cloneVisual(BUILTIN_VISUAL_MATERIALS[0]);
    const b = createBinding(material, 'outfit', 0, 0); material.version = 2; material.garments[0].design = 'jeans';
    expect(b.resolved.garments[0].design).toContain('hanfu'); expect(b.version).toBe(1);
  });
  it('filters by era before rolling and returns a real preview or explicit empty path', () => {
    expect(rollMaterial(BUILTIN_VISUAL_MATERIALS, { kind: 'outfit', setting: 'xianxia', query: 'JK' }, 0)).toBeUndefined();
    const results = searchMaterials(BUILTIN_VISUAL_MATERIALS, { kind: 'outfit', setting: 'xianxia', query: '仙俠' });
    expect(results).toHaveLength(2); expect(results[0].material.previewPath).toBe(''); expect(results[0].reason).toContain('无预览');
    expect(rollMaterial(BUILTIN_VISUAL_MATERIALS, { kind: 'outfit', setting: 'xianxia' }, 0)?.id)
      .not.toBe(rollMaterial(BUILTIN_VISUAL_MATERIALS, { kind: 'outfit', setting: 'xianxia' }, 1)?.id);
  });
  it('resolves aliases and requires work disambiguation for homonyms', () => {
    const materials: VisualMaterial[] = ['A', 'B'].map(work => ({ ...cloneVisual(BUILTIN_VISUAL_MATERIALS[0]), id: `char_${work}`, kind: 'character', name: '雪儿', aliases: ['Xue', '雪兒'], work, previewPath: '/user/images/real.png' }));
    expect(rollMaterial(materials, { kind: 'character', query: '雪兒' }, 0)).toBeUndefined();
    expect(rollMaterial(materials, { kind: 'character', query: 'Xue', work: 'B' }, 0)?.id).toBe('char_B');
  });
});
