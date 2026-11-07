import { requestNovelFloorTags } from '@/autoTag/runner';
import { clearAutoGenerateForFloor } from '@/floor/autoGenerate';
import { beginGen, clearGen, failGen, getGenRecord, hasActiveGen, isCurrentGen, setGenPhase, setGenRetry, setQueueAhead, slotKey } from '@/floor/genState';
import { hydrateMessage } from '@/floor/hydrate';
import { latestEntry, promptHash, readStore, saveImageResult } from '@/floor/storage';
import { backendStatus, decideSeed, generateImage } from '@/generate';
import { settings } from '@/state/settings';
import { beginImage, failImage, finishImage, safeHistory } from '@/state/history';
import { getContext, isAiStoryMessage, type STMessage } from '@/st/context';
import { parseImageTagContent, parseImageTags, stripImageTags } from '@/st/imageTagRegex';

/** The batch interface owns no component and never waits for a render frame. */
const planning = new Map<string, Promise<PlanResult>>();
const generating = new Map<string, Promise<void>>();
const dirty = new Set<number>();

interface PlanResult { status: 'tagged' | 'no-images'; tagCount: number }

function capture(floor: number) {
  const ctx = getContext();
  const chatId = ctx?.getCurrentChatId?.();
  const message = ctx?.chat[floor];
  if (!ctx || !chatId || !Number.isInteger(floor) || floor < 0 || !isAiStoryMessage(message)) {
    throw new Error('当前聊天或目标剧情楼层不可用');
  }
  const swipe = message.swipe_id ?? 0;
  const assert = () => {
    const current = getContext();
    const next = current?.chat[floor];
    const same = next === message || Boolean(message.send_date && next?.send_date === message.send_date && next.name === message.name);
    if (current?.getCurrentChatId?.() !== chatId || !same || (next?.swipe_id ?? 0) !== swipe) {
      throw new Error('聊天、楼层或 swipe 已变化，已放弃旧任务写入');
    }
    return next as STMessage;
  };
  return { ctx, chatId, message, swipe, assert };
}

function refresh(): void {
  if (document.hidden) return;
  const ctx = getContext();
  if (!ctx) return;
  for (const floor of dirty) {
    try { hydrateMessage(floor, ctx); } catch (e) { console.warn('[柏宝绘] 显示刷新失败，已保存的图片不受影响', e); }
  }
  dirty.clear();
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', refresh);

function floorStatus(floor: number) {
  const at = capture(floor);
  const tags = parseImageTags(at.message.mes);
  const store = readStore(at.message);
  const slots = tags.map((tag, seq) => {
    const entry = latestEntry(store, at.swipe, promptHash(tag), seq);
    const running = getGenRecord(slotKey(at.chatId, floor, at.swipe, seq));
    const phase = entry?.status === 'ready' && entry.path ? 'ready' : running?.phase || 'pending';
    return { seq, phase, error: running?.error || '' };
  });
  return { tagCount: tags.length, ready: slots.filter(s => s.phase === 'ready').length, slots };
}

async function planFloor(floor: number): Promise<PlanResult> {
  const at = capture(floor);
  const key = `${at.chatId}|${floor}|${at.swipe}`;
  const existing = planning.get(key);
  if (existing) return existing;
  const tags = parseImageTags(at.message.mes);
  // Reuse persisted tags after stop/reload. Image failures must never invoke the LLM again.
  if (tags.length) {
    tags.forEach(tag => { if (!parseImageTagContent(tag).tag.trim()) throw new Error('已有 tag 无有效提示词，请先手动修正'); });
    return { status: 'tagged', tagCount: tags.length };
  }
  const sourceHash = promptHash(stripImageTags(at.message.mes));
  const previous = at.message.extra?.bbiNovelPlan as { status?: string; sourceHash?: string } | undefined;
  if (previous?.status === 'no-images' && previous.sourceHash === sourceHash) return { status: 'no-images', tagCount: 0 };
  const task = (async (): Promise<PlanResult> => {
    const result = await requestNovelFloorTags(floor);
    const current = at.assert();
    const savedTags = parseImageTags(current.mes);
    if (result.status === 'tagged' && !savedTags.length) throw new Error('tag 未保存，已停止本楼任务');
    savedTags.forEach(tag => { if (!parseImageTagContent(tag).tag.trim()) throw new Error('生成的 tag 没有有效提示词'); });
    current.extra = { ...current.extra, bbiNovelPlan: { v: 1, status: result.status, sourceHash, tagCount: savedTags.length } };
    await at.ctx.saveChat();
    dirty.add(floor);
    return { status: result.status, tagCount: savedTags.length };
  })();
  planning.set(key, task);
  try { return await task; } finally { if (planning.get(key) === task) planning.delete(key); }
}

function runSlot(floor: number, seq: number, rawTag: string): Promise<void> {
  const at = capture(floor);
  const slot = slotKey(at.chatId, floor, at.swipe, seq);
  const key = `${slot}|${promptHash(rawTag)}`;
  const active = generating.get(key);
  if (active) return active;
  const history = latestEntry(readStore(at.message), at.swipe, promptHash(rawTag), seq);
  if (history?.status === 'ready' && history.path) return Promise.resolve();
  const owned = getGenRecord(slot);
  // A card/manual request may already own it. Do not cancel that request or duplicate it.
  if ((owned?.phase === 'queued' || owned?.phase === 'generating') && hasActiveGen(slot)) {
    return Promise.reject(new Error('本槽位已有其他生成任务，请等待完成后续跑'));
  }
  const content = parseImageTagContent(rawTag);
  if (!content.tag.trim()) return Promise.reject(new Error('提示词为空'));
  const { signal, token } = beginGen(slot, promptHash(rawTag), settings.defaultBackend === 'nai' ? 'queued' : 'generating');
  const assert = () => {
    const message = at.assert();
    if (signal.aborted || !isCurrentGen(slot, token) || parseImageTags(message.mes)[seq] !== rawTag) {
      throw new Error('图片任务已取消或提示词已改变，已放弃旧结果写入');
    }
  };
  const task = (async () => {
    const seed = decideSeed(settings.defaultBackend);
    const status = backendStatus();
    const historyId = safeHistory(() => beginImage({
      backend: settings.defaultBackend === 'nai' ? 'nai' : 'comfyui', model: status.model || '',
      prompt: content.tag, nl: content.nl, negative: content.negative, characters: content.characters,
      seed, size: content.size, floor, seq,
    }));
    let output: Awaited<ReturnType<typeof generateImage>> | undefined;
    try {
      assert();
      output = await generateImage({ prompt: content.tag, nl: content.nl, negative: content.negative, characters: content.characters, size: content.size, seed }, signal, {
        onStart: () => setGenPhase(slot, token, 'generating'),
        onQueue: ahead => setQueueAhead(slot, token, ahead),
        onRetry: retry => setGenRetry(slot, token, retry),
      });
      assert();
      await saveImageResult(floor, at.swipe, seq, rawTag, seed, output.result, output.meta, assert);
      if (historyId !== null) safeHistory(() => finishImage(historyId));
      clearGen(slot, token);
      dirty.add(floor);
    } catch (error) {
      if (historyId !== null) safeHistory(() => failImage(historyId, error instanceof Error ? error.message : String(error), signal.aborted));
      failGen(slot, token, error instanceof Error ? error.message : String(error));
      throw error;
    } finally { output?.result.revoke(); }
  })();
  generating.set(key, task);
  void task.finally(() => { if (generating.get(key) === task) generating.delete(key); }).catch(() => {});
  return task;
}

async function generateFloor(floor: number) {
  const at = capture(floor);
  const status = backendStatus();
  if (!settings.enabled || !status.configured) throw new Error(status.reason || '柏宝绘已停用');
  const tags = parseImageTags(at.message.mes);
  if (!tags.length) throw new Error('本楼没有已保存的 tag，请先生成 tag');
  // Prevent a later Card.onMounted from consuming an old auto-generation flag.
  clearAutoGenerateForFloor(at.chatId, floor);
  const results = await Promise.allSettled(tags.map((tag, seq) => runSlot(floor, seq, tag)));
  const failures = results.flatMap((result, seq) => result.status === 'rejected' ? [{ seq, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : []);
  at.assert();
  return { status: failures.length ? 'failed' as const : 'ready' as const, failures, ...floorStatus(floor) };
}

export const novelReader = Object.freeze({ version: 1 as const, planFloor, generateFloor, getFloorStatus: floorStatus, refresh });
