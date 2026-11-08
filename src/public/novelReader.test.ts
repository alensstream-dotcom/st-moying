import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { STMessage } from '@/st/context';

const mocks = vi.hoisted(() => ({ plan: vi.fn(), generate: vi.fn(), saveImage: vi.fn(), hydrate: vi.fn(), chatId: 'novel-test', chat: [] as STMessage[] }));
vi.mock('@/autoTag/runner', () => ({ requestNovelFloorTags: mocks.plan }));
vi.mock('@/floor/hydrate', () => ({ hydrateMessage: mocks.hydrate }));
vi.mock('@/generate', () => ({ backendStatus: () => ({ configured: true }), decideSeed: () => 123, generateImage: mocks.generate }));
vi.mock('@/state/settings', () => ({ settings: { enabled: true, defaultBackend: 'nai' } }));
vi.mock('@/st/context', () => ({
  getContext: () => ({ chat: mocks.chat, getCurrentChatId: () => mocks.chatId, saveChat: async () => {} }),
  isAiStoryMessage: (m: STMessage) => Boolean(m && !m.is_user),
}));
vi.mock('@/floor/storage', async importOriginal => {
  const original = await importOriginal<typeof import('@/floor/storage')>();
  return { ...original, saveImageResult: mocks.saveImage };
});

import { novelReader } from './novelReader';
import { appendEntry, promptHash, readStore } from '@/floor/storage';
import { clearAllGen } from '@/floor/genState';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const tag = '<bbi_image><tag>harbor, girl</tag><size>portrait</size></bbi_image>';
const output = () => ({ result: { url: 'data:image/png;base64,YQ==', format: 'png', revoke: vi.fn() }, meta: {}, seed: 123 });

beforeEach(() => {
  vi.clearAllMocks(); clearAllGen(); mocks.chatId = 'novel-test';
  vi.stubGlobal('document', { hidden: true, addEventListener: vi.fn(), querySelector: () => { throw Error('DOM unavailable'); } });
  mocks.chat = [0, 1].map(i => ({ name: 'Novel', is_user: false, is_system: false, mes: '正文' + i, send_date: String(i), extra: {} }));
  mocks.plan.mockImplementation(async (floor: number) => { mocks.chat[floor].mes += tag; return { status: 'tagged' }; });
  mocks.generate.mockImplementation(async () => output());
  mocks.saveImage.mockImplementation(async (floor, swipe, seq, rawTag, seed, _result, _meta, guard) => {
    guard?.();
    const message = mocks.chat[floor];
    const entry = { generationId: 'g1', path: '/user/images/test.png', prompt: rawTag, seed, status: 'ready' as const, createdAt: 1, slotSeq: seq };
    message.extra = { ...message.extra, bbiImage: appendEntry(readStore(message) || {}, swipe, promptHash(rawTag), entry) };
    return entry;
  });
});

describe('headless novel pipeline', () => {
  it('uses persisted appearance references and records the same frame for headless novel images', async () => {
    await novelReader.planFloor(0);
    mocks.chat[0].extra!.bbiCharChanges = { swipe: 0, scene: {
      v: 1, revision: 'saved-source', events: [], rejected: [], frames: [{
        tag, sourceLine: 0, warnings: [], characters: [{ name: '林疏桐', visualBindings: [{
          scope: 'appearance', resolved: { vibe: { id: 'locked-face', dataPath: '/user/files/immutable-face.json' } },
        }] }],
      }],
    } };
    await novelReader.generateFloor(0);
    expect(mocks.generate.mock.calls[0][0].referenceVibes).toEqual([{ id: 'locked-face', dataPath: '/user/files/immutable-face.json' }]);
    const savedMeta = mocks.saveImage.mock.calls[0][6];
    expect(savedMeta.scene.frame.tag).toBe(tag);
    expect(savedMeta.scene.stateSourceValid).toBe(false);
    expect(savedMeta.scene.floor).toBe(0);
  });
  it('plans the next floor while the first floor image is still in flight, without any DOM', async () => {
    const image = deferred<ReturnType<typeof output>>();
    mocks.generate.mockReturnValueOnce(image.promise);
    await novelReader.planFloor(0);
    const generation = novelReader.generateFloor(0);
    await novelReader.planFloor(1);
    expect(mocks.plan.mock.calls.map(x => x[0])).toEqual([0, 1]);
    expect(novelReader.getFloorStatus(0).ready).toBe(0);
    image.resolve(output());
    await expect(generation).resolves.toMatchObject({ status: 'ready', ready: 1 });
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent planning and joins an existing slot job', async () => {
    const planned = deferred<{ status: string }>();
    mocks.plan.mockImplementation(async () => { await planned.promise; mocks.chat[0].mes += tag; return { status: 'tagged' }; });
    const a = novelReader.planFloor(0), b = novelReader.planFloor(0);
    expect(mocks.plan).toHaveBeenCalledOnce(); planned.resolve({ status: 'tagged' }); await Promise.all([a,b]);
    const image = deferred<ReturnType<typeof output>>(); mocks.generate.mockReturnValueOnce(image.promise);
    const c = novelReader.generateFloor(0), d = novelReader.generateFloor(0);
    expect(mocks.generate).toHaveBeenCalledOnce(); image.resolve(output()); await Promise.all([c,d]);
    expect(mocks.saveImage).toHaveBeenCalledOnce();
  });

  it('reuses persisted tags when retrying an image failure instead of calling the LLM again', async () => {
    await novelReader.planFloor(0);
    mocks.generate.mockRejectedValueOnce(Error('503'));
    await expect(novelReader.generateFloor(0)).resolves.toMatchObject({ status: 'failed' });
    await novelReader.planFloor(0);
    await expect(novelReader.generateFloor(0)).resolves.toMatchObject({ status: 'ready' });
    expect(mocks.plan).toHaveBeenCalledOnce();
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });

  it('does not write an old request into a different chat', async () => {
    await novelReader.planFloor(0);
    const image = deferred<ReturnType<typeof output>>(); mocks.generate.mockReturnValueOnce(image.promise);
    const task = novelReader.generateFloor(0); mocks.chatId = 'different-chat'; image.resolve(output());
    await expect(task).rejects.toThrow('聊天');
    expect(mocks.saveImage).not.toHaveBeenCalled();
  });

  it('propagates a tag planning error without starting images or retrying', async () => {
    mocks.plan.mockRejectedValueOnce(Error('invalid plan'));
    await expect(novelReader.planFloor(0)).rejects.toThrow('invalid plan');
    expect(mocks.plan).toHaveBeenCalledOnce(); expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('persists a no-images decision and skips repeat LLM requests for unchanged text', async () => {
    mocks.plan.mockResolvedValueOnce({ status: 'no-images' });
    await expect(novelReader.planFloor(0)).resolves.toMatchObject({ status: 'no-images' });
    await expect(novelReader.planFloor(0)).resolves.toMatchObject({ status: 'no-images' });
    expect(mocks.plan).toHaveBeenCalledOnce();
  });
});
