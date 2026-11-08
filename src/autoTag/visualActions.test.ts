import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ generate: vi.fn(), upload: vi.fn(), revoke: vi.fn(), completion: vi.fn(), loadVibe: vi.fn(), saveVibe: vi.fn(), seed: 100 }));
vi.mock('@/generate', () => ({ backendStatus: () => ({ configured: true }), decideSeed: () => ++mock.seed, generateImage: mock.generate }));
vi.mock('@/st/images', () => ({ uploadUserImage: mock.upload }));
vi.mock('@/api/client', () => ({ requestViaMainApi: mock.completion, requestCompletion: mock.completion }));
vi.mock('@/backends/vibeStore', async original => ({ ...await original<typeof import('@/backends/vibeStore')>(), loadVibeData: mock.loadVibe, saveVibeFiles: mock.saveVibe }));
import { createVisualDesign, drawVisualPreview, freezeVisualReference } from './visualActions';
import { BUILTIN_VISUAL_MATERIALS, cloneVisual } from '@/state/visualDesign';
beforeEach(() => {
  vi.clearAllMocks(); mock.generate.mockResolvedValue({ result: { url: 'data:image/png;base64,AAAA', format: 'png', revoke: mock.revoke } });
  mock.upload.mockResolvedValue('/user/images/real-generated-preview.png');
});
describe('material creation and preview execution', () => {
  it('redraws a fixed design with only a new image seed and saves an actual returned preview', async () => {
    const selected = cloneVisual(BUILTIN_VISUAL_MATERIALS[0]), before = JSON.stringify(selected);
    const a = await drawVisualPreview(selected), b = await drawVisualPreview(selected);
    expect(a.material.id).toBe(selected.id); expect(b.material.garments).toEqual(selected.garments);
    expect(a.imageSeed).not.toBe(b.imageSeed); expect(a.material.previewPath).toBe('/user/images/real-generated-preview.png');
    expect(mock.upload.mock.calls[0][2]).toBe('AAAA'); expect(JSON.stringify(selected)).toBe(before);
    expect(mock.revoke).toHaveBeenCalledTimes(2);
  });
  it('does not fabricate a preview or alter the selected material after an upload failure', async () => {
    const selected = cloneVisual(BUILTIN_VISUAL_MATERIALS[0]); mock.upload.mockRejectedValue(new Error('upload unavailable'));
    await expect(drawVisualPreview(selected)).rejects.toThrow('upload unavailable');
    expect(selected.previewPath).toBe(''); expect(mock.revoke).toHaveBeenCalled();
  });
  it('marks generated material tags unverified and discards invented source/preview links', async () => {
    mock.completion.mockResolvedValue(JSON.stringify({ name: '新衣', kind: 'outfit', garments: [{ id: 'outer', design: 'blue robe' }], previewPath: 'https://imaginary.invalid/image.png', verified: true, source: 'imaginary database' }));
    const material = await createVisualDesign('蓝色仙侠长袍', 'outfit', 'xianxia');
    expect(material.previewPath).toBe(''); expect(material.verified).toBe(false); expect(material.source).toContain('LLM');
  });
  it('freezes Vibe data into a new immutable material reference without overwriting the original', async () => {
    const reference = { id: 'vibe_user', name: '定妆', dataPath: '/user/files/original.json', thumbnailPath: '', modelKeys: [], fingerprint: '', hasImage: true, strength: 0.6, enabled: true, group: '' };
    const data = { image: 'bytes', thumbnail: '', encodings: { 'v4-5full': { encoding: 'encoded', infoExtracted: 1 } } };
    mock.loadVibe.mockResolvedValue(data); mock.saveVibe.mockResolvedValue({ dataPath: '/user/files/frozen.json', thumbnailPath: '' });
    const frozen = await freezeVisualReference(reference);
    expect(frozen.dataPath).toBe('/user/files/frozen.json'); expect(frozen.id).toMatch(/^material_ref_/);
    expect(mock.saveVibe.mock.calls[0][1]).toBeNull(); expect(reference.dataPath).toBe('/user/files/original.json');
    expect(await freezeVisualReference(frozen)).toEqual(frozen); expect(mock.saveVibe).toHaveBeenCalledTimes(1);
  });
});
