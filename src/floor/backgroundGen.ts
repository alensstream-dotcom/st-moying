/**
 * 后台出图：不依赖楼层卡片渲染的生成通道。
 *
 * 为什么需要它（真机故障，不是理论问题）：
 * 原来的自动出图是一条「写正文 → MESSAGE_EDITED → 楼层重渲染 → 卡片 onMounted 消费标记 →
 * 卡片自己发请求」的链条（见 floor/autoGenerate.ts 的文件头）。链条第二环起全靠 DOM：
 * 手机类酒馆客户端（TauriTavern 这类 WebView 壳）把应用切到后台后不再渲染楼层、也不再执行
 * 挂载钩子，标记就永远没人消费 —— 表现正是「正文能在后台生成，图不会」，或者更糟：
 * 标记被消费在已经销毁的组件上，请求发出去了但没有组件接收结果，用户回来只看到一条错误。
 *
 * 本模块把链条切断在「写正文」之后：runner 写盘成功就地把每个新槽位交给这里，用
 * generateImage + saveImageResult 直接落盘，再由 hydrateMessage 反推给界面。全程只碰
 * 数据与网络，不碰 vnode、不碰 shadow root，后台与前台走的是同一份逻辑。
 *
 * 与卡片的分工（避免双跑）：
 * - runner 写盘前照旧给每个槽位挂标记（前台的即时性来自它）。
 * - 本模块开跑前先 consumeAutoGenerate：谁先拿到标记谁跑。前台卡片几乎总在同一轮
 *   microtask 之后才挂载，所以前台仍是卡片跑（有排队/退避/取消按钮），拿不到标记的
 *   headless 直接让位；后台没人挂载，标记留在这里被取走。
 * - 落盘成功后 hydrateMessage 让卡片从 extra 恢复成 ready，后台跑出来的图和前台跑出来的
 *   在界面上没有任何区别。
 *
 * 断点续跑：后台失败最常见的两种原因是「切后台断网」与「WebView 被系统冻结」，两者都不是
 * 配置错误。故失败不判死：任务进 pending 队列（落 localStorage，WebView 被杀也不丢），
 * 页面重新可见时自动重试，最多 MAX_RESUME 次，避免坏配置无限循环。
 */

import type { ImageCharacterPrompt } from '@/autoTag/protocol';
import type { Orientation } from '@/backends/size';
import { backendStatus, decideSeed, generateImage } from '@/generate';
import { consumeAutoGenerate } from '@/floor/autoGenerate';
import { beginGen, clearGen, failGen, getGenRecord, setGenPhase, slotKey } from '@/floor/genState';
import { hydrateMessage } from '@/floor/hydrate';
import { saveImageResult } from '@/floor/storage';
import { activeComfyPreset, settings } from '@/state/settings';
import { beginImage, failImage, finishImage } from '@/state/history';
import { getContext } from '@/st/context';

/** 一个待生成槽位的全部输入。与 ImageTagContent 同形,外加楼层坐标。 */
export interface BackgroundJob {
  chatId: string;
  messageId: number;
  swipeId: number;
  seq: number;
  tag: string;
  prompt: string;
  nl: string;
  negative: string;
  characters: ImageCharacterPrompt[];
  size: Orientation;
}

const PENDING_KEY = 'moying_image_bg_pending';
/** 同一槽位最多续跑几次。后台断网常常一次就好,配置错则一次都不该反复打后端。 */
const MAX_RESUME = 3;
/** 队列上限:手机内存紧张,没必要为一个楼存几十个待办。 */
const PENDING_CAP = 24;

interface PendingEntry {
  job: BackgroundJob;
  attempts: number;
  /** 最近一次失败原因,留着给用户看,不用翻控制台。 */
  lastError: string;
  at: number;
}

let pending: PendingEntry[] = [];
let loaded = false;
let running = false;
let resumeBound = false;

function readPending(): PendingEntry[] {
  if (loaded) return pending;
  loaded = true;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) {
      pending = parsed.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const entry = item as Partial<PendingEntry>;
        const job = entry.job as BackgroundJob | undefined;
        if (!job || typeof job.messageId !== 'number' || typeof job.seq !== 'number') return [];
        return [{
          job,
          attempts: Number(entry.attempts) || 0,
          lastError: typeof entry.lastError === 'string' ? entry.lastError : '',
          at: Number(entry.at) || 0,
        }];
      });
    }
  } catch {
    pending = [];
  }
  return pending;
}

function writePending(): void {
  try {
    if (!pending.length) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-PENDING_CAP)));
  } catch {
    // 隐私模式/配额满:内存里这份仍然有效,只是重启后丢
  }
}

function enqueue(job: BackgroundJob, lastError: string): void {
  readPending();
  const key = jobKey(job);
  const existing = pending.find(item => jobKey(item.job) === key);
  if (existing) {
    existing.attempts += 1;
    existing.lastError = lastError;
    existing.at = Date.now();
  } else {
    pending.push({ job, attempts: 0, lastError, at: Date.now() });
  }
  writePending();
}

function jobKey(job: BackgroundJob): string {
  return `${job.chatId}|${job.messageId}|${job.swipeId}|${job.seq}`;
}

function dropPending(key: string): void {
  readPending();
  const next = pending.filter(item => jobKey(item.job) !== key);
  if (next.length !== pending.length) {
    pending = next;
    writePending();
  }
}

/** 当前打开的是不是这个任务所属的聊天。落盘/水合都只对「当前聊天」有意义。 */
function chatMatches(chatId: string): boolean {
  return (getContext()?.getCurrentChatId?.() ?? '') === chatId;
}

function safeHistory<T>(run: () => T): T | null {
  try {
    return run();
  } catch (error) {
    console.warn('[墨影] 后台出图埋点失败:', error);
    return null;
  }
}

/**
 * 跑一个槽位。**不校验、不排队、不碰 DOM** —— 调用方负责决定要不要跑。
 *
 * 返回 'ok' 落盘成功 | 'skipped' 当前聊天不是它/后端没配好 | 'failed' 已进续跑队列。
 */
async function runOne(job: BackgroundJob, signal?: AbortSignal): Promise<'ok' | 'skipped' | 'failed'> {
  if (!backendStatus().configured) return 'skipped';
  if (!chatMatches(job.chatId)) return 'skipped';

  const key = slotKey(job.chatId, job.messageId, job.swipeId, job.seq);
  // 前台卡片正在这个槽位上跑时不接管:beginGen 会 abort 同 key 的 controller,
  // 抢过来等于把用户眼前那次生成掐掉。前台跑了,这张就交给前台。
  const running = getGenRecord(key);
  if (running && running.phase !== 'error') return 'skipped';
  const handle = beginGen(key, job.prompt, 'queued');

  const seed = decideSeed(settings.defaultBackend);
  const naiActive = settings.defaultBackend === 'nai';
  const historyId = safeHistory(() =>
    beginImage({
      backend: naiActive ? 'nai' : 'comfyui',
      model: naiActive ? settings.nai.model : activeComfyPreset().name,
      prompt: job.prompt,
      nl: job.nl,
      negative: job.negative,
      characters: job.characters,
      seed,
      size: job.size,
      floor: job.messageId,
      seq: job.seq,
    }),
  );

  try {
    setGenPhase(key, handle.token, 'generating');
    const { result, meta } = await generateImage(
      {
        prompt: job.prompt,
        nl: job.nl,
        negative: job.negative,
        characters: job.characters,
        size: job.size,
        seed,
      },
      handle.signal ?? signal,
    );
    await saveImageResult(job.messageId, job.swipeId, job.seq, job.tag, seed, result, meta);
    result.revoke();
    if (historyId !== null) safeHistory(() => finishImage(historyId));
    clearGen(key, handle.token);
    dropPending(jobKey(job));
    // 落盘后反推界面:前台卡片从 extra 变成 ready,后台回来时一进聊天就已就绪
    const ctx = getContext();
    if (ctx) hydrateMessage(job.messageId, ctx);
    return 'ok';
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    const message = error instanceof Error ? error.message : String(error);
    if (historyId !== null) safeHistory(() => failImage(historyId, message, aborted));
    if (aborted) {
      clearGen(key, handle.token);
      return 'skipped';
    }
    failGen(key, handle.token, message);
    enqueue(job, message);
    return 'failed';
  }
}

/**
 * 依次跑一批任务（不并发：NAI 的闸门在 generateImage 里，但后台场景不值得抢）。
 * 每个任务先抢标记：抢不到说明前台卡片已经在跑，直接让位。
 */
export async function runBackgroundGenerations(jobs: BackgroundJob[]): Promise<void> {
  if (!jobs.length) return;
  bindResumeListener();
  // 先摘掉这批槽位的自动生成标记:从此由后台负责到底。
  //
  // 旧做法是「抢标记,抢不到就让位给前台卡片」,结果第一张图经常卡住 ——
  // 前台卡片在重渲染时先一步消费了标记,但它自己的相位判定(shouldAutoGenerate)
  // 只放行 pending/stale;只要该槽位还留着上一次的结果或被判成 error,标记就被
  // 吃掉而没人跑,谁也等不到下一次自动触发,用户只能手动点一下。
  // 现在改成:标记一律先摘,前台别再来抢;后台跑完用 hydrateMessage 把卡片推到 ready,
  // 失败则进续跑队列并让卡片显示错误 —— 两条路都有结果,不再有「没人生成也没人报错」。
  for (const job of jobs) {
    consumeAutoGenerate(job.chatId, job.messageId, job.swipeId, job.seq);
  }
  if (running) {
    // 已有后台批次在跑:把新任务并进队列,由可见性钩子接力,避免两条链同时压 NAI
    for (const job of jobs) enqueue(job, '等待后台批次让位');
    return;
  }
  running = true;
  try {
    for (const job of jobs) {
      // runOne 内部会用 getGenRecord 判断前台是否正在这个槽位上跑,是则让位不双跑
      await runOne(job);
    }
  } finally {
    running = false;
  }
}

/** 页面重新可见时把续跑队列里的任务补一遍。幂等绑定,只挂一次。 */
export function bindResumeListener(): void {
  if (resumeBound || typeof document === 'undefined') return;
  resumeBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void resumePending();
  });
  // 首次加载也可能带着上次被杀时的队列
  void resumePending();
}

/** 手动/自动续跑:可在设置页或调试时直接调用。 */
export async function resumePending(): Promise<void> {
  readPending();
  if (!pending.length || running) return;
  const batch = pending
    .filter(item => item.attempts < MAX_RESUME && chatMatches(item.job.chatId))
    .map(item => item.job);
  if (!batch.length) return;
  running = true;
  try {
    for (const job of batch) {
      const entry = readPending().find(item => jobKey(item.job) === jobKey(job));
      if (!entry || entry.attempts >= MAX_RESUME) continue;
      // 续跑前同样抢标记:标记若还在,说明前台从没接手过,这次由我们兜住
      consumeAutoGenerate(job.chatId, job.messageId, job.swipeId, job.seq);
      await runOne(job);
    }
  } finally {
    running = false;
    // 彻底放弃的任务:清出队列,免得每次切前台都重扫一遍
    const survivors = readPending().filter(item => item.attempts < MAX_RESUME);
    if (survivors.length !== pending.length) {
      pending = survivors;
      writePending();
    }
  }
}

/** 诊断用:还剩多少待续跑任务,最近一次失败原因是什么。 */
export function backgroundQueueState(): { count: number; lastError: string } {
  const items = readPending();
  return { count: items.length, lastError: items[items.length - 1]?.lastError ?? '' };
}
