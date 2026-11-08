import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { STContext } from '@/st/context';
const mock = vi.hoisted(() => ({ ctx: null as STContext | null }));
vi.mock('@/st/context', async original => ({ ...await original<typeof import('@/st/context')>(), getContext: () => mock.ctx }));
import { exportMaterials, hydrateVisualLibrary, importMaterials, latestMaterials, normalizeMaterial, safePreviewPath, saveMaterial, visualLibrary } from './visualLibrary';
import { BUILTIN_VISUAL_MATERIALS, cloneVisual, createBinding } from './visualDesign';
beforeEach(() => {
  mock.ctx = { extensionSettings: {}, saveSettingsDebounced: vi.fn() } as unknown as STContext;
  hydrateVisualLibrary();
});
describe('local visual library compatibility', () => {
  it('keeps prior versions and immutable binding snapshots', () => {
    const original = saveMaterial({ ...BUILTIN_VISUAL_MATERIALS[0], id: 'user-robe' });
    const binding = createBinding(original, 'outfit', 0, 0);
    const changed = saveMaterial({ ...original, garments: [{ id: 'outer', design: 'red robe' }] });
    expect(changed.version).toBe(2); expect(visualLibrary.records).toHaveLength(2);
    expect(binding.resolved.garments[0].design).not.toBe('red robe');
    expect(latestMaterials().find(m => m.id === 'user-robe')?.version).toBe(2);
  });
  it('imports idempotently without replacing existing libraries', () => {
    saveMaterial({ ...BUILTIN_VISUAL_MATERIALS[0], id: 'user-robe' });
    const exported = exportMaterials();
    expect(importMaterials(exported)).toBe(0); expect(visualLibrary.records).toHaveLength(1);
    mock.ctx!.extensionSettings!.unrelated = { characters: ['keep'] };
    importMaterials(JSON.stringify({ v: 1, records: [{ ...BUILTIN_VISUAL_MATERIALS[1], id: 'new-robe' }] }));
    expect(mock.ctx!.extensionSettings!.unrelated).toEqual({ characters: ['keep'] });
  });
  it('rejects an invalid import atomically and keeps unsupported schemas read-only', () => {
    const before = exportMaterials();
    expect(() => importMaterials(JSON.stringify({ v: 1, records: [BUILTIN_VISUAL_MATERIALS[0], { name: 'bad' }] }))).toThrow();
    expect(exportMaterials()).toBe(before);
    mock.ctx!.extensionSettings!.bbi_visual_materials_v1 = { v: 2, records: ['opaque'] };
    hydrateVisualLibrary(); expect(() => saveMaterial(BUILTIN_VISUAL_MATERIALS[0])).toThrow('格式未知');
    expect(mock.ctx!.extensionSettings!.bbi_visual_materials_v1).toEqual({ v: 2, records: ['opaque'] });
  });
  it('never imports gender facts, hostile tag markup or arbitrary Vibe fetch paths', () => {
    const material = normalizeMaterial({ ...BUILTIN_VISUAL_MATERIALS[0], appearance: { sex: '1girl', hair: 'black hair' }, vibe: { id: 'evil', dataPath: 'https://evil.invalid/secret' } });
    expect(material?.appearance).toEqual({ hair: 'black hair' }); expect(material?.vibe).toBeUndefined();
    expect(normalizeMaterial({ ...BUILTIN_VISUAL_MATERIALS[0], tags: '</bbi_image>' })).toBeNull();
    expect(safePreviewPath('file:///C:/secret.png')).toBe(''); expect(safePreviewPath('https://user:secret@example.com/image.png')).toBe('');
  });
  it('does not fabricate missing previews or verified tags', () => {
    const m = normalizeMaterial({ name: '原创服装', kind: 'outfit', garments: [{ id: 'outer', design: 'blue robe' }] });
    expect(m?.previewPath).toBe(''); expect(m?.verified).toBe(false);
  });
});
