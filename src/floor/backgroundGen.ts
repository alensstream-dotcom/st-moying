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
import { generationSceneSnapshot } from '@/floor/sceneSnapshot';
import { beginGen, clearGen, failGen, getGenRecord, hasActiveGen, pruneGenSlots, setGenPhase, setGenRetry, setQueueAhead, slotKey } from '@/floor/genState';
import { hydrateMessage } from '@/floor/hydrate';
import { isImageMissing } from '@/floor/missingImages';
import { historyEntries, promptHash, readStore, saveImageResult } from '@/floor/storage';
import { activeComfyPreset, settings } from '@/state/settings';
import { beginImage, failImage, finishImage } from '@/state/history';
import { getContext } from '@/st/context';
import { parseImageTags, serializeImageTag } from '@/st/imageTagRegex';

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
let activeJobKey: string | null = null;
const preclaimedKeys = new Set<string>();

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

const YIELD_NOTE = '等待后台批次让位';

function enqueue(job: BackgroundJob, lastError: string, bumpAttempt = true): void {
  readPending();
  const key = jobKey(job);
  const existing = pending.find(item => jobKey(item.job) === key);
  if (existing) {
    const wasYieldPlaceholder = existing.lastError === YIELD_NOTE && existing.attempts === 0;
    existing.job = job;
    if (bumpAttempt && !wasYieldPlaceholder) existing.attempts += 1;
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

function resolveFullTag(job: BackgroundJob): string {
  if (/^<bbi_image\b/i.test(job.tag.trim())) return job.tag;
  const ctx = getContext();
  const mes = ctx?.chat?.[job.messageId]?.mes;
  if (typeof mes === 'string') {
    const raw = parseImageTags(mes)[job.seq];
    if (raw) return raw;
  }
  return serializeImageTag({
    tag: job.prompt || job.tag,
    nl: job.nl,
    negative: job.negative,
    characters: job.characters,
    size: job.size,
  });
}

/**
 * 跑一个槽位。**不校验、不排队、不碰 DOM** —— 调用方负责决定要不要跑。
 *
 * 返回 'ok' 落盘成功 | 'skipped' 当前聊天不是它/后端没配好/前台已跑完 | 'failed' 已进续跑队列。
 */
async function runOne(job: BackgroundJob, signal?: AbortSignal): Promise<'ok' | 'skipped' | 'failed'> {
  if (!backendStatus().configured) return 'skipped';
  if (!chatMatches(job.chatId)) return 'skipped';

  const fullTag = resolveFullTag(job);
  const currentHash = promptHash(fullTag);
  const ctx = getContext();
  const message = ctx?.chat?.[job.messageId];
  // 前台卡片在 300ms 等待窗口内可能已经跑完并落盘:查一次 extra,已有存活成图就无需再跑一遍
  if (message) {
    const existing = historyEntries(readStore(message), job.swipeId, currentHash, job.seq).filter(
      entry => !isImageMissing(entry.path),
    );
    if (existing.length > 0) {
      dropPending(jobKey(job));
      return 'skipped';
    }
  }

  const key = slotKey(job.chatId, job.messageId, job.swipeId, job.seq);
  // 前台卡片正在这个槽位上跑时不接管:beginGen 会 abort 同 key 的 controller,
  // 抢过来等于把用户眼前那次生成掐掉。前台跑了,这张就交给前台。
  //
  // 判定必须看「有没有活的 controller」而不是「有没有 record」:水合或旧相位会留下
  // phase=queued、controller 早已没了的僵尸记录。按 record 判会让这个槽位被永久
  // 挡在门外,表现就是每次都有固定一张图必须手动点一下。
  const running = getGenRecord(key);
  if (running && running.phase !== 'error' && hasActiveGen(key)) {
    console.debug(`[墨影] 后台出图让位：第 ${job.messageId} 楼第 ${job.seq + 1} 张前台正在生成`);
    return 'skipped';
  }
  if (running && running.phase !== 'error') {
    console.debug(
      `[墨影] 后台出图接管僵尸槽位：第 ${job.messageId} 楼第 ${job.seq + 1} 张（phase=${running.phase}，无在途任务）`,
    );
  }
  const naiActive = settings.defaultBackend === 'nai';
  // 必须传 currentHash(promptHash(fullTag)) 而非 job.prompt!
  // 否则随后水合挂载 Card.vue 时,watch(hash, current => reconcileGen(key, current))
  // 会因为 record.hash !== promptHash(props.tag) 当场 abort 掐死后台正在生成的任务!
  const handle = beginGen(key, currentHash, naiActive ? 'queued' : 'generating');

  const seed = decideSeed(settings.defaultBackend);
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

  let generated: Awaited<ReturnType<typeof generateImage>> | undefined;
  const assert = () => {
    const current = getContext(), next = current?.chat[job.messageId];
    const same = next === message || Boolean(message?.send_date && next?.send_date === message.send_date && next.name === message.name);
    if (!chatMatches(job.chatId) || !same || (next?.swipe_id ?? 0) !== job.swipeId
      || parseImageTags(next?.mes ?? '')[job.seq] !== fullTag || handle.signal.aborted) {
      throw new DOMException('聊天、楼层或提示词已变化，旧图片不会写入当前聊天', 'AbortError');
    }
  };
  try {
    assert();
    const scene = generationSceneSnapshot(job.messageId, job.swipeId, job.seq, fullTag);
    const { result, meta } = await generateImage(
      {
        prompt: job.prompt,
        nl: job.nl,
        negative: job.negative,
        characters: job.characters,
        size: job.size,
        seed,
        referenceVibes: scene.referenceVibes,
      },
      handle.signal ?? signal,
      {
        onStart: () => setGenPhase(key, handle.token, 'generating'),
        onQueue: ahead => setQueueAhead(key, handle.token, ahead),
        onRetry: retry => setGenRetry(key, handle.token, retry),
      },
    );
    generated = { result, meta } as Awaited<ReturnType<typeof generateImage>>;
    meta.scene = scene.trace;
    assert();
    await saveImageResult(job.messageId, job.swipeId, job.seq, fullTag, seed, result, meta, assert);
    if (historyId !== null) safeHistory(() => finishImage(historyId));
    clearGen(key, handle.token);
    dropPending(jobKey(job));
    // 落盘后反推界面:前台卡片从 extra 变成 ready,后台回来时一进聊天就已就绪
    const latestCtx = getContext();
    if (latestCtx) hydrateMessage(job.messageId, latestCtx);
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
    enqueue({ ...job, tag: fullTag }, message);
    return 'failed';
  } finally {
    generated?.result.revoke();
  }
}

const activeBatch: BackgroundJob[] = [];

export function isBackgroundGenRunning(): boolean {
  return running || activeBatch.length > 0 || preclaimedKeys.size > 0;
}

/**
 * 在写回消息触发 DOM 水合前预先声明本楼槽位将由 backgroundGen 接管，
 * 防止 applyMessageText 期间挂载的 Card.vue 抢跑并脱离后台持久化队列。
 */
export function preclaimBackgroundSlots(
  chatId: string,
  messageId: number,
  swipeId: number,
  seqs: number[],
): void {
  for (const seq of seqs) {
    preclaimedKeys.add(`${chatId}|${messageId}|${swipeId}|${seq}`);
  }
}

export function clearPreclaimedBackgroundSlots(chatId: string, messageId: number): void {
  const prefix = `${chatId}|${messageId}|`;
  for (const key of Array.from(preclaimedKeys)) {
    if (key.startsWith(prefix)) preclaimedKeys.delete(key);
  }
}

/**
 * 整楼重绘/重写 tag 时清理该楼旧的排队项与在途请求，防旧请求卡死并发闸门。
 */
export function cancelBackgroundFloorJobs(chatId: string, messageId: number): void {
  clearPreclaimedBackgroundSlots(chatId, messageId);
  for (let i = activeBatch.length - 1; i >= 0; i--) {
    if (activeBatch[i].chatId === chatId && activeBatch[i].messageId === messageId) {
      activeBatch.splice(i, 1);
    }
  }
  readPending();
  const next = pending.filter(
    item => !(item.job.chatId === chatId && item.job.messageId === messageId),
  );
  if (next.length !== pending.length) {
    pending = next;
    writePending();
  }
  const swipeId = getContext()?.chat?.[messageId]?.swipe_id ?? 0;
  pruneGenSlots(chatId, messageId, swipeId, 0);
}

/**
 * 判断某个槽位是否已由后台出图模块接管（预声明、在内存队列、正在跑或待续跑）。
 */
export function isBackgroundJobQueued(
  chatId: string,
  messageId: number,
  swipeId: number,
  seq: number,
): boolean {
  const k = `${chatId}|${messageId}|${swipeId}|${seq}`;
  if (preclaimedKeys.has(k) || activeJobKey === k) return true;
  if (activeBatch.some(item => jobKey(item) === k)) return true;
  if (running && readPending().some(item => jobKey(item.job) === k && item.attempts < MAX_RESUME)) {
    return true;
  }
  return false;
}

/**
 * 依次跑一批任务（不并发：NAI 的闸门在 generateImage 里，但后台场景不值得抢）。
 * 同步登记进 activeBatch 并持久化到 pending，无论前台或手机切后台都能无缝连续出图。
 */
export async function runBackgroundGenerations(jobs: BackgroundJob[]): Promise<void> {
  if (!jobs.length) return;
  bindResumeListener();
  for (const job of jobs) {
    const k = jobKey(job);
    preclaimedKeys.delete(k);
    consumeAutoGenerate(job.chatId, job.messageId, job.swipeId, job.seq);
    if (!activeBatch.some(item => jobKey(item) === k)) {
      activeBatch.push(job);
    }
  }
  if (running) {
    for (const job of jobs) enqueue({ ...job, tag: resolveFullTag(job) }, YIELD_NOTE, false);
    return;
  }
  running = true;
  try {
    while (activeBatch.length > 0) {
      const job = activeBatch.shift()!;
      const k = jobKey(job);
      activeJobKey = k;
      try {
        const outcome = await runOne(job);
        if (outcome !== 'ok') {
          console.info(
            `[墨影] 后台出图:第 ${job.messageId} 楼第 ${job.seq + 1} 张 → ${outcome}`,
          );
        }
      } finally {
        if (activeJobKey === k) activeJobKey = null;
      }
    }
  } finally {
    running = false;
    // 如果在跑期间有通过 YIELD_NOTE 入队的等待项,自动接力续跑
    if (readPending().some(item => item.lastError === YIELD_NOTE && item.attempts < MAX_RESUME && chatMatches(item.job.chatId))) {
      setTimeout(() => { void resumePending(); }, 100);
    }
  }
}

/** 页面重新可见时把续跑队列里的任务补一遍。幂等绑定,只挂一次。 */
export function bindResumeListener(): void {
  if (resumeBound || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
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
      const k = jobKey(job);
      const entry = readPending().find(item => jobKey(item.job) === k);
      if (!entry || entry.attempts >= MAX_RESUME) continue;
      // 续跑前同样抢标记:标记若还在,说明前台从没接手过,这次由我们兜住
      consumeAutoGenerate(job.chatId, job.messageId, job.swipeId, job.seq);
      activeJobKey = k;
      try {
        const outcome = await runOne(job);
        if (outcome === 'skipped') {
          const key = slotKey(job.chatId, job.messageId, job.swipeId, job.seq);
          if (!hasActiveGen(key)) dropPending(k);
        }
      } finally {
        if (activeJobKey === k) activeJobKey = null;
      }
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

/** 仅测试用:重置模块级内存状态。 */
export function _resetBackgroundGenForTest(): void {
  pending = [];
  loaded = false;
  running = false;
  activeJobKey = null;
  preclaimedKeys.clear();
  activeBatch.length = 0;
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}
