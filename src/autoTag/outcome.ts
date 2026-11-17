/**
 * 每楼一次的「这一轮到底发生了什么」。
 *
 * 以前只有两种结局：写出 tag（toast 成功）或抛错（toast 失败）。
 * 但真实的结局有五种，混成两种的代价是用户看不出该做什么：
 * - 这楼确实没画面（男主独白、纯对话）→ 什么都不用做；
 * - 模型吐了空计划但被判成失败 → 会重试到次数耗尽，白等十几分钟；
 * - 图有但某一格丢了（引句不在正文里）→ 半成功；
 * - 写进去了但要人看一眼（兜底补图、模型自陈不确定）→ 需复核；
 * - 真的失败（上游拦、截断、渠道死）→ 换渠道。
 *
 * 这份记录只写结论与计数，不存正文：它是给界面和用户看的一句话，
 * 不是第二份账本。
 */
export type FloorOutcomeStatus = 'success' | 'no_frame' | 'partial_success' | 'needs_review' | 'failed';

export interface FloorOutcome {
  v: 1;
  status: FloorOutcomeStatus;
  /** 人话原因（失败时给用户看的那一句）。 */
  reason?: string;
  /** 本轮实际写了几张；没有写盘时为 0。 */
  images: number;
  /** 模型给了几张但被丢掉（引句不锚定、落位冲突等）。 */
  dropped: number;
  /** 这一楼一共发了几次请求。 */
  attempts: number;
  /** 写入时间（ms）。 */
  at: number;
}

export const BBI_OUTCOME_EXTRA_KEY = 'bbiTagOutcome';

/** 失败分类：把各种上游/协议错误压成用户能行动的四类。 */
export function classifyFailure(error: string): { status: FloorOutcomeStatus; reason: string } {
  const text = String(error ?? '');
  if (/超时|timeout|timed out/i.test(text)) {
    return { status: 'failed', reason: '上游超时：这个模型撑不住长请求，换一个变体再试' };
  }
  if (/content_filter|PROHIBITED_CONTENT|内容拦截|被渠道内容过滤/i.test(text)) {
    return { status: 'failed', reason: '上游内容拦截：换渠道或降低本楼露骨写法' };
  }
  if (/截断|truncat/i.test(text)) {
    return { status: 'failed', reason: '输出被截断：模型没写完整份 JSON，重试或换模型' };
  }
  if (/凭据|credential|Unauthorized|401|403/i.test(text)) {
    return { status: 'failed', reason: '渠道凭据失效：换渠道或补号' };
  }
  if (/空 images|空计划/i.test(text)) {
    return { status: 'no_frame', reason: '模型认为这一楼没有值得画的瞬间' };
  }
  return { status: 'failed', reason: text || '未知错误' };
}

import { getContext } from '@/st/context';

/**
 * 单独落一笔结局（成功路径走 applyMessageText 的 extraUpdate，不必多存一次）。
 * 失败/放弃路径本来就不写正文，只能在这里直接改 extra 再存。
 */
export async function recordOutcome(
  floor: number,
  swipeId: number | null,
  chatId: string | undefined,
  outcome: FloorOutcome,
): Promise<void> {
  const ctx = getContext();
  if (!ctx?.saveChat || !chatId) return;
  if (ctx.getCurrentChatId?.() !== chatId) return;
  const message = ctx.chat?.[floor];
  if (!message) return;
  message.extra = { ...(message.extra ?? {}), [BBI_OUTCOME_EXTRA_KEY]: outcome };
  try {
    await ctx.saveChat();
  } catch (error) {
    console.warn('[墨影] 结局记录未保存', error);
  }
}
