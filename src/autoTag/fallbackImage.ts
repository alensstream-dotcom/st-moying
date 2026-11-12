/**
 * 「0 张图」兜底。
 *
 * 用户遇到的三类生图失败里，最伤的是「AI 输出 0 张图片」：整楼什么都没出，
 * 阅读器干等、批量队列判失败。而这通常发生在**最该出图的那一楼**——
 * NSFW 段落里模型被内容过滤劝退，或它觉得「没什么好画的」。
 *
 * 这里做最后一道保险：只要正文里有值得画的内容，就按账本和正文自己拼一张。
 * 拼出来的构图故意用最中性的一档（上半身、正面、柔光），因为它不是最优解，
 * 只是「总比空手好」的解——有重试次数时轮不到它。
 */

import type { TargetSegment } from './clean';
import type { CharTagEntry } from '../state/charTags';
import type { ImageInsertion } from './protocol';

/** 值得出图的情节标记。命中一个就认为这一楼不该交白卷。 */
export const DRAW_WORTHY =
  /(?:做爱|性交|交合|交欢|亲吻|接吻|舌吻|吻住|吻上|爱抚|抚摸|插入|抽插|高潮|射精|内射|口交|舔|骑乘|跨坐|呻吟|赤裸|裸体|全裸|乳头|乳房|内裤|大腿|搂|抱紧|压在|跨在)/;

export function isDrawWorthy(source: string): boolean {
  return DRAW_WORTHY.test(String(source ?? ''));
}

/** 用档案字段拼一个角色 tag；字段全空时退回 raw。 */
function characterTag(entry: CharTagEntry): string {
  const fields = entry.fields ?? ({} as CharTagEntry['fields']);
  const parts = [fields.hair, fields.eyes, fields.skin, fields.body, fields.extra]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  if (!parts.length) return String(entry.raw ?? '').trim();
  return parts.join(', ');
}

/**
 * 从候选句里挑最像「画面事件」的一句，并拼出可用的 ImageInsertion。
 *
 * 优先挑点名了在场女性的句子（这样服装/外貌锁都还能生效），
 * 其次挑含「她」的句子，最后退回最后一段。
 */
export function fallbackImage(
  source: string,
  segments: readonly TargetSegment[],
  entries: readonly CharTagEntry[],
): ImageInsertion | null {
  if (!Array.isArray(segments) || !segments.length) return null;
  const known = entries.filter((entry) => entry?.name);
  const named = (text: string): CharTagEntry | undefined =>
    known.find((entry) => text.includes(entry.name));
  const pool = [...segments].reverse();
  const segment =
    pool.find((item) => named(item.text)) ?? pool.find((item) => /她/.test(item.text)) ?? pool[pool.length - 1];
  if (!segment) return null;

  const entry = named(segment.text);
  const who = entry ? characterTag(entry) : '';
  const characters = entry
    ? [{ name: entry.name, tag: who || '1girl', nl: String(entry.nl ?? '').trim() }]
    : [];

  return {
    position: segment.id,
    sourceLine: segment.sourceLine,
    charOffset: segment.charOffset,
    tag: ['1girl', 'solo', who, 'upper body', 'from front', 'soft lighting']
      .filter(Boolean)
      .join(', '),
    nl: '',
    negative: '',
    characters,
    size: 'portrait',
  };
}

/** 兜底时给用户看的说明（console/toast 用）。 */
export function fallbackNote(source: string): string {
  const hint = String(source ?? '').match(DRAW_WORTHY)?.[0] ?? '';
  return hint ? `模型没给画面，已按「${hint}」这处情节自行补一张` : '模型没给画面，已按正文自行补一张';
}
