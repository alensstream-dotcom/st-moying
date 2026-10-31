import { getThumb, putThumb, thumbKey, type ThumbKind } from '@/data/loreThumbs';
import { backendStatus, decideSeed, generateImage } from '@/generate';
import { settings } from '@/state/settings';
import { loreGenPreset } from '@/state/genPresets';

/**
 * 素材批量配图队列。
 *
 * 为什么单独成模块而不是写在页面里：
 * 1) 点完「一键配图」用户会切页去看剧情，组件一卸载队列就没了；状态与定时器放模块级，
 *    切到别的页面回来还能接上。
 * 2) 一次给几百条素材配图必须**串行 + 固定间隔**。并发打 NAI 是主动找 429，密集重复请求
 *    还容易被上游风控;所以这里一次只发一个，两条之间按设置的间隔等。
 * 3) 失败不该中断整批:单条失败记一笔就跳下一条，但连续失败到阈值就自动停——那通常不是
 *    这一条素材的问题，而是密钥/额度/网络坏了，继续打只会把账号打黑。
 */
export interface ThumbTask {
  kind: ThumbKind;
  /** 素材 id(与 loreThumbs 的 key 一致)。 */
  id: string;
  /** 给用户看的名字，用于进度显示。 */
  name: string;
  prompt: string;
}

export interface ThumbJobState {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  /** 正在配的那条的名字。 */
  current: string;
  /** 最近一次失败原因(成功不清空，方便回头看)。 */
  lastError: string;
}

/** 连续失败到这个次数就收手:说明是账号/额度/网络层面的问题，不是单条素材的问题。 */
const MAX_CONSECUTIVE_FAILURES = 3;

const state: ThumbJobState = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  current: '',
  lastError: '',
};

let queue: ThumbTask[] = [];
let cursor = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let cancelled = false;
let consecutiveFailures = 0;

type StateListener = (state: ThumbJobState) => void;
type TaskListener = (task: ThumbTask) => void;

const stateListeners = new Set<StateListener>();
const taskListeners = new Set<TaskListener>();

function snapshot(): ThumbJobState {
  return { ...state };
}

function emitState(): void {
  const next = snapshot();
  for (const listener of stateListeners) listener(next);
}

function emitTask(task: ThumbTask): void {
  for (const listener of taskListeners) listener(task);
}

/** 订阅进度。返回取消订阅函数。 */
export function onThumbJobState(listener: StateListener): () => void {
  stateListeners.add(listener);
  listener(snapshot());
  return () => {
    stateListeners.delete(listener);
  };
}

/** 订阅「某一条配好了」。UI 用它把新图挂到对应卡片上，不必整页重绘。 */
export function onThumbTaskDone(listener: TaskListener): () => void {
  taskListeners.add(listener);
  return () => {
    taskListeners.delete(listener);
  };
}

export function thumbJobState(): ThumbJobState {
  return snapshot();
}

export function isThumbJobRunning(): boolean {
  return state.running;
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function finish(): void {
  clearTimer();
  state.running = false;
  state.current = '';
  queue = [];
  cursor = 0;
  emitState();
}

/** 停掉当前批次(已配好的图保留)。 */
export function stopThumbJob(): void {
  cancelled = true;
  finish();
}

/**
 * 开始一批配图。
 *
 * @param tasks 待配任务；已存在缩略图的会被自动跳过（除非 force）。
 * @param intervalMs 两条之间的间隔；调用方负责从设置里取，这里只兜底下限。
 */
export function startThumbJob(tasks: ThumbTask[], intervalMs: number, force = false): void {
  stopThumbJob();
  cancelled = false;
  consecutiveFailures = 0;
  state.failed = 0;
  state.lastError = '';
  state.done = 0;

  const pending: ThumbTask[] = [];
  for (const task of tasks) {
    if (!task.prompt.trim()) continue;
    pending.push(task);
  }

  if (!pending.length) {
    state.total = 0;
    state.running = false;
    emitState();
    return;
  }

  queue = pending;
  cursor = 0;
  state.total = pending.length;
  state.running = true;
  state.current = pending[0].name;
  emitState();

  const interval = Math.max(3000, Math.floor(intervalMs) || 10000);
  void runNext(interval, force);
}

async function runNext(interval: number, force: boolean): Promise<void> {
  if (cancelled) return;
  if (cursor >= queue.length) {
    finish();
    return;
  }

  const task = queue[cursor];
  cursor += 1;
  state.current = task.name;
  emitState();

  const status = backendStatus();
  if (!status.configured) {
    state.lastError = status.reason || '出图后端未配置';
    finish();
    return;
  }

  try {
    if (!force) {
      const exists = await getThumb(thumbKey(task.kind, task.id));
      if (exists) {
        state.done += 1;
        emitState();
        timer = setTimeout(() => void runNext(interval, force), interval);
        return;
      }
    }
    const preset = loreGenPreset();
    const backend = preset?.backend ?? 'nai';
    const model = settings.autoTag.lore.thumbModel.trim();
    const output = await generateImage({
      prompt: task.prompt,
      backend,
      genPresetId: preset?.id ?? settings.activeGenPreset,
      seed: decideSeed(backend),
      size: 'portrait',
      ...(model ? { naiModel: model } : {}),
    });
    const response = await fetch(output.result.url);
    const blob = await response.blob();
    output.result.revoke();
    await putThumb(thumbKey(task.kind, task.id), blob, task.prompt);
    state.done += 1;
    consecutiveFailures = 0;
    emitTask(task);
    emitState();
  } catch (error) {
    consecutiveFailures += 1;
    state.failed += 1;
    state.lastError = error instanceof Error ? error.message : String(error);
    emitState();
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      state.lastError = `${state.lastError}（连续 ${MAX_CONSECUTIVE_FAILURES} 条失败，已停下；先看密钥/额度/网络）`;
      finish();
      return;
    }
  }

  if (cancelled) return;
  timer = setTimeout(() => void runNext(interval, force), interval);
}

/** 供测试重置。 */
export function resetThumbJob(): void {
  clearTimer();
  cancelled = true;
  queue = [];
  cursor = 0;
  consecutiveFailures = 0;
  state.running = false;
  state.total = 0;
  state.done = 0;
  state.failed = 0;
  state.current = '';
  state.lastError = '';
  emitState();
}
