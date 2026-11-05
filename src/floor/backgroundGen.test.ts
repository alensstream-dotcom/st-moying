import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateImageMock = vi.fn();
const backendStatusMock = vi.fn(() => ({ configured: true }));
const decideSeedMock = vi.fn(() => 42);
const saveImageResultMock = vi.fn();
const hydrateMessageMock = vi.fn();
const getContextMock = vi.fn();

vi.mock('@/generate', () => ({
  backendStatus: () => backendStatusMock(),
  decideSeed: () => decideSeedMock(),
  generateImage: (...args: unknown[]) => generateImageMock(...args),
}));

vi.mock('@/floor/hydrate', () => ({
  hydrateMessage: (...args: unknown[]) => hydrateMessageMock(...args),
}));

vi.mock('@/st/context', () => ({
  getContext: () => getContextMock(),
}));

vi.mock('@/floor/storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/floor/storage')>();
  return {
    ...actual,
    saveImageResult: (...args: unknown[]) => saveImageResultMock(...args),
  };
});

import {
  _resetBackgroundGenForTest,
  backgroundQueueState,
  cancelBackgroundFloorJobs,
  clearPreclaimedBackgroundSlots,
  isBackgroundJobQueued,
  preclaimBackgroundSlots,
  resumePending,
  runBackgroundGenerations,
  type BackgroundJob,
} from '@/floor/backgroundGen';
import {
  clearGen,
  getGenRecord,
  hasActiveGen,
  reconcileGen,
  slotKey,
} from '@/floor/genState';
import { appendEntry, BBI_IMAGE_EXTRA_KEY, promptHash } from '@/floor/storage';
import { serializeImageTag } from '@/st/imageTagRegex';

function makeFullTag(prompt = '1girl, solo, smile'): string {
  return serializeImageTag({
    tag: prompt,
    nl: 'a girl smiling',
    negative: 'lowres',
    characters: [{ name: '林疏桐', tag: 'black hair, brown eyes', nl: 'young woman' }],
    size: 'portrait',
  });
}

function makeJob(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  const fullTag = makeFullTag(overrides.prompt ?? '1girl, solo, smile');
  return {
    chatId: 'chat-1',
    messageId: 2,
    swipeId: 0,
    seq: 0,
    tag: fullTag,
    prompt: '1girl, solo, smile',
    nl: 'a girl smiling',
    negative: 'lowres',
    characters: [{ name: '林疏桐', tag: 'black hair, brown eyes', nl: 'young woman' }],
    size: 'portrait',
    ...overrides,
  };
}

describe('backgroundGen', () => {
  beforeEach(() => {
    _resetBackgroundGenForTest();
    vi.clearAllMocks();
    vi.stubGlobal('document', {
      hidden: true,
      visibilityState: 'hidden',
      addEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    _resetBackgroundGenForTest();
    clearGen(slotKey('chat-1', 2, 0, 0));
    vi.unstubAllGlobals();
  });

  it('uses promptHash(fullTag) in beginGen so late Card.vue reconcileGen does not abort in-flight background generation', async () => {
    const fullTag = makeFullTag();
    const job = makeJob({ tag: fullTag });
    const key = slotKey(job.chatId, job.messageId, job.swipeId, job.seq);
    const expectedHash = promptHash(fullTag);

    getContextMock.mockReturnValue({
      getCurrentChatId: () => 'chat-1',
      chat: [{}, {}, { mes: `正文\n${fullTag}`, swipe_id: 0, extra: {} }],
    });

    let capturedSignal: AbortSignal | undefined;
    generateImageMock.mockImplementation(async (_req: unknown, signal?: AbortSignal) => {
      capturedSignal = signal;
      // Simulate Card.vue mounting mid-flight and calling reconcileGen(key, promptHash(props.tag))
      reconcileGen(key, expectedHash);
      expect(signal?.aborted).toBe(false);
      expect(hasActiveGen(key)).toBe(true);
      expect(getGenRecord(key)?.hash).toBe(expectedHash);
      return {
        result: { url: 'data:image/png;base64,AAAA', format: 'png', revoke: vi.fn() },
        meta: {},
      };
    });
    saveImageResultMock.mockResolvedValue({ generationId: 'g1', path: '/user/images/1.png' });

    await runBackgroundGenerations([job]);

    expect(capturedSignal?.aborted).toBe(false);
    expect(saveImageResultMock).toHaveBeenCalledTimes(1);
    expect(saveImageResultMock.mock.calls[0][3]).toBe(fullTag);
  });

  it('resolves full serialized <bbi_image> tag from message.mes when job.tag was passed as bare prompt', async () => {
    const fullTag = makeFullTag('1girl,bare_case');
    const job = makeJob({
      tag: '1girl,bare_case',
      prompt: '1girl,bare_case',
    });

    getContextMock.mockReturnValue({
      getCurrentChatId: () => 'chat-1',
      chat: [{}, {}, { mes: `段落\n${fullTag}`, swipe_id: 0, extra: {} }],
    });

    generateImageMock.mockResolvedValue({
      result: { url: 'data:image/png;base64,AAAA', format: 'png', revoke: vi.fn() },
      meta: {},
    });
    saveImageResultMock.mockResolvedValue({ generationId: 'g1', path: '/user/images/1.png' });

    await runBackgroundGenerations([job]);

    expect(saveImageResultMock).toHaveBeenCalledTimes(1);
    expect(saveImageResultMock.mock.calls[0][3]).toBe(fullTag);
  });

  it('skips slot that already has a live image in extra.bbiImage (e.g. completed by foreground Card.vue during 300ms delay)', async () => {
    const fullTag = makeFullTag();
    const job = makeJob({ tag: fullTag });
    const hash = promptHash(fullTag);
    const store = appendEntry({}, 0, hash, {
      generationId: 'g-existing',
      path: '/user/images/already.png',
      prompt: fullTag,
      seed: 1,
      status: 'ready',
      createdAt: 1000,
      slotSeq: 0,
    });

    getContextMock.mockReturnValue({
      getCurrentChatId: () => 'chat-1',
      chat: [{}, {}, { mes: fullTag, swipe_id: 0, extra: { [BBI_IMAGE_EXTRA_KEY]: store } }],
    });

    await runBackgroundGenerations([job]);

    expect(generateImageMock).not.toHaveBeenCalled();
    expect(saveImageResultMock).not.toHaveBeenCalled();
  });

  it('drops pending entry when resumePending sees the slot is already ready in extra', async () => {
    const fullTag = makeFullTag();
    const job = makeJob({ tag: fullTag });
    const hash = promptHash(fullTag);

    const msg: Record<string, unknown> = { mes: fullTag, swipe_id: 0, extra: {} };
    getContextMock.mockReturnValue({
      getCurrentChatId: () => 'chat-1',
      chat: [{}, {}, msg],
    });

    // First run fails -> enqueued into pending
    generateImageMock.mockRejectedValueOnce(new Error('network down'));
    await runBackgroundGenerations([job]);
    expect(backgroundQueueState().count).toBe(1);

    // Before resumePending runs, foreground finishes and writes extra
    msg.extra = {
      [BBI_IMAGE_EXTRA_KEY]: appendEntry({}, 0, hash, {
        generationId: 'g-ready',
        path: '/user/images/ready.png',
        prompt: fullTag,
        seed: 1,
        status: 'ready',
        createdAt: 2000,
        slotSeq: 0,
      }),
    };

    await resumePending();
    expect(backgroundQueueState().count).toBe(0);
    expect(generateImageMock).toHaveBeenCalledTimes(1);
  });

  it('marks preclaimed and queued multi-slot jobs in isBackgroundJobQueued and does not inflate attempts on yield', async () => {
    const fullTag0 = makeFullTag('1girl, slot0');
    const fullTag1 = makeFullTag('1girl, slot1');
    const job0 = makeJob({ seq: 0, tag: fullTag0, prompt: '1girl, slot0' });
    const job1 = makeJob({ seq: 1, tag: fullTag1, prompt: '1girl, slot1' });

    getContextMock.mockReturnValue({
      getCurrentChatId: () => 'chat-1',
      chat: [{}, {}, { mes: `${fullTag0}\n${fullTag1}`, swipe_id: 0, extra: {} }],
    });

    preclaimBackgroundSlots('chat-1', 2, 0, [0, 1]);
    expect(isBackgroundJobQueued('chat-1', 2, 0, 0)).toBe(true);
    expect(isBackgroundJobQueued('chat-1', 2, 0, 1)).toBe(true);
    clearPreclaimedBackgroundSlots('chat-1', 2);
    expect(isBackgroundJobQueued('chat-1', 2, 0, 0)).toBe(false);

    let resolveFirst!: () => void;
    const firstGate = new Promise<void>(r => {
      resolveFirst = r;
    });

    generateImageMock.mockImplementationOnce(async () => {
      expect(isBackgroundJobQueued('chat-1', 2, 0, 0)).toBe(true);
      await firstGate;
      expect(isBackgroundJobQueued('chat-1', 2, 0, 1)).toBe(true);
      return {
        result: { url: 'data:image/png;base64,AAAA', format: 'png', revoke: vi.fn() },
        meta: {},
      };
    });
    generateImageMock.mockResolvedValueOnce({
      result: { url: 'data:image/png;base64,BBBB', format: 'png', revoke: vi.fn() },
      meta: {},
    });
    saveImageResultMock.mockResolvedValue({ generationId: 'g1', path: '/user/images/1.png' });

    const p0 = runBackgroundGenerations([job0]);
    const p1 = runBackgroundGenerations([job1]);
    expect(backgroundQueueState().count).toBe(1);

    resolveFirst();
    await Promise.all([p0, p1]);
    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(backgroundQueueState().count).toBe(0);
  });

  it('cancelBackgroundFloorJobs clears queued and preclaimed jobs for that floor', () => {
    preclaimBackgroundSlots('chat-1', 2, 0, [0, 1]);
    expect(isBackgroundJobQueued('chat-1', 2, 0, 0)).toBe(true);
    cancelBackgroundFloorJobs('chat-1', 2);
    expect(isBackgroundJobQueued('chat-1', 2, 0, 0)).toBe(false);
  });
});
