import { getThumb, putStudioImage, thumbKey, type ThumbKind } from '@/data/loreThumbs';
import { decideSeed, generateImage } from '@/generate';
import { settings, type BackendId } from '@/state/settings';
import type { GenerationMeta } from '@/generationMeta';
export interface ThumbTask {
  kind: ThumbKind;
  id: string;
  name: string;
  prompt: string;
  scene?: string;
  genPresetId?: string;
  naiModel?: string;
  backend?: BackendId;
}
export interface ThumbJobState {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  current: string;
  lastError: string;
  lastGeneration?: GenerationMeta;
}
const state: ThumbJobState = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  skipped: 0,
  current: '',
  lastError: '',
};
const listeners = new Set<(s: ThumbJobState) => void>(),
  completed = new Set<(t: ThumbTask) => void>();
let queue: Array<ThumbTask & { force: boolean }> = [],
  timer: ReturnType<typeof setTimeout> | null = null,
  controller: AbortController | null = null,
  epoch = 0,
  failures = 0,
  activeKey = '';
let activeTask: (ThumbTask & { force: boolean }) | null = null;
const snapshot = () => ({ ...state });
function emit() {
  for (const fn of listeners)
    try {
      fn(snapshot());
    } catch {}
}
export function onThumbJobState(fn: (s: ThumbJobState) => void) {
  listeners.add(fn);
  fn(snapshot());
  return () => {
    listeners.delete(fn);
  };
}
export function onThumbTaskDone(fn: (t: ThumbTask) => void) {
  completed.add(fn);
  return () => {
    completed.delete(fn);
  };
}
export function thumbJobState() {
  return snapshot();
}
export function isThumbJobRunning() {
  return state.running;
}
function clearTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
export function stopThumbJob() {
  epoch++;
  clearTimer();
  controller?.abort();
  controller = null;
  activeKey = '';
  activeTask = null;
  queue = [];
  state.running = false;
  state.current = '';
  emit();
}
export function resetThumbJob() {
  stopThumbJob();
  Object.assign(state, { total: 0, done: 0, failed: 0, skipped: 0, lastError: '' });
  failures = 0;
  emit();
}
function finish() {
  clearTimer();
  queue = [];
  state.running = false;
  state.current = '';
  emit();
}
export function startThumbJob(tasks: ThumbTask[], intervalMs: number, force = false) {
  if (!tasks.length) return 0;
  const existing = new Set(queue.map((t) => t.kind + ':' + t.id + ':' + t.prompt));
  if (activeKey) existing.add(activeKey);
  const pending = tasks
    .filter((t) => t.prompt.trim())
    .filter((t) => {
      const key = t.kind + ':' + t.id + ':' + t.prompt;
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    })
    .map((t) => ({
      ...t,
      force,
      backend: t.backend ?? settings.defaultBackend,
      genPresetId: t.genPresetId ?? '',
      naiModel: t.naiModel ?? '',
      scene:
        t.scene ??
        (t.kind === 'face'
          ? 'solo, centered composition'
          : 'solo, full body, standing, looking at viewer, centered composition, simple background'),
    }));
  if (!pending.length) return 0;
  if (state.running) {
    queue.push(...pending);
    state.total += pending.length;
    emit();
    return pending.length;
  }
  epoch++;
  failures = 0;
  queue = pending;
  Object.assign(state, {
    running: true,
    total: pending.length,
    done: 0,
    failed: 0,
    skipped: 0,
    current: '',
    lastError: '',
  });
  emit();
  void runNext(epoch, Math.max(3000, Math.min(120000, Number(intervalMs) || 10000)));
  return pending.length;
}
/** A draft saved while its preview is queued keeps the resulting image under its final ID. */
export function retargetThumbTasks(kind: ThumbKind, oldId: string, newId: string, prompt: string) {
  for (const task of [...queue, ...(activeTask ? [activeTask] : [])])
    if (task.kind === kind && task.id === oldId && task.prompt === prompt) task.id = newId;
  if (activeTask) activeKey = activeTask.kind + ':' + activeTask.id + ':' + activeTask.prompt;
}
async function runNext(ticket: number, interval: number): Promise<void> {
  if (ticket !== epoch || !state.running) return;
  const task = queue.shift();
  if (!task) {
    finish();
    return;
  }
  activeKey = task.kind + ':' + task.id + ':' + task.prompt;
  activeTask = task;
  state.current = task.name;
  emit();
  controller = new AbortController();
  const signal = controller.signal;
  let revoke: (() => void) | undefined;
  try {
    const cached = !task.force ? await getThumb(thumbKey(task.kind, task.id)) : null;
    if (ticket !== epoch) return;
    if (cached?.prompt === task.prompt) {
      state.done++;
      state.skipped++;
      failures = 0;
      emit();
    } else {
      const backend = task.backend ?? 'nai';
      const out = await generateImage(
        {
          prompt: [task.scene, task.prompt].filter(Boolean).join(', '),
          backend,
          characters: [],
          suppressCharacterReference: true,
          genPresetId: task.genPresetId,
          seed: decideSeed(backend, undefined, true),
          size: 'portrait',
          ...(backend === 'nai' && task.naiModel ? { naiModel: task.naiModel } : {}),
        },
        signal,
      );
      revoke = () => out.result.revoke();
      if (ticket === epoch) state.lastGeneration = out.meta;
      if (ticket !== epoch) return;
      const response = await fetch(out.result.url, { signal });
      if (!response.ok) throw new Error('预览图片读取失败 HTTP ' + response.status);
      const blob = await response.blob();
      if (ticket !== epoch) return;
      const storedKey = thumbKey(task.kind, task.id);
      await putStudioImage(storedKey, blob, task.prompt, out.meta);
      if (storedKey !== thumbKey(task.kind, task.id))
        await putStudioImage(thumbKey(task.kind, task.id), blob, task.prompt, out.meta);
      if (ticket !== epoch) return;
      state.done++;
      failures = 0;
      for (const fn of completed)
        try {
          fn(task);
        } catch {}
      emit();
    }
  } catch (error) {
    if (ticket !== epoch) return;
    failures++;
    state.failed++;
    state.lastError = error instanceof Error ? error.message : String(error);
    emit();
    if (failures >= 3) {
      state.lastError += '（连续 3 条失败，已停止；检查渠道、额度或网络后再排队）';
      finish();
      return;
    }
  } finally {
    revoke?.();
    if (ticket === epoch) {
      controller = null;
      activeKey = '';
      activeTask = null;
    }
  }
  if (ticket !== epoch || !state.running) return;
  if (!queue.length) {
    finish();
    return;
  }
  timer = setTimeout(() => {
    void runNext(ticket, interval);
  }, interval);
}
