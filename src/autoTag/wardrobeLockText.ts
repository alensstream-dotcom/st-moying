/**
 * 把「当前着装账本」压成一段短提示，注入聊天上下文（depth=0）。
 *
 * 为什么要有这一层：服装漂移的根源不是渲染，而是**文字模型不知道她穿着什么**。
 * 它在正文里自由改写衣服（长牛仔裤写成短牛仔裤、脱了又自己穿回来），
 * 出图端的账本再准也只能跟着崩。主流做法（SILLYimages / Horae / mvu-helper）
 * 都是把当前 outfit 注入上下文，让写正文的模型照抄。
 */

import type { STMessage } from '../st/context';
import type { CharTagEntry } from '../state/charTags';
import { clothingBefore, type ClothingState } from './outfitTimeline';

const STATE_LABEL: Record<string, string> = {
  removed: '已脱去',
  floor: '落在地上',
  chair: '搭在椅上',
  held: '拿在手里',
  open: '敞开',
  loose: '松垮',
  lifted: '掀起',
  pulled_aside: '拨到一边',
  lowered: '褪下',
  around_waist: '褪到腰际',
  around_ankles: '褪到脚踝',
  off_arm: '单侧离臂',
  rolled_up: '袖子卷起',
  torn: '破损',
  wet: '湿透',
};

/** 一件衣服现在长什么样，用中文短句拼出来。 */
function describePiece(piece: { design: string; state?: Record<string, string> }): string {
  const design = (piece.design || '').trim();
  const labels = Object.keys(piece.state ?? {})
    .map((key) => STATE_LABEL[String(piece.state?.[key])] ?? '')
    .filter(Boolean);
  const uniq = [...new Set(labels)];
  return uniq.length ? `${design || '衣物'}（${uniq.join('、')}）` : design;
}

/** 最近几条消息里出现过的人名：只对在场角色注入，避免「幽灵换装」。 */
export function presentNames(chat: readonly STMessage[], entries: readonly CharTagEntry[], tail = 6): string[] {
  const names = new Set<string>();
  if (!Array.isArray(chat) || !chat.length) return [];
  for (const message of chat.slice(-tail)) {
    const text = String(message?.mes ?? '');
    if (!text) continue;
    for (const entry of entries) if (entry.name && text.includes(entry.name)) names.add(entry.name);
  }
  return [...names];
}

function render(state: ClothingState, names: readonly string[]): string[] {
  const lines: string[] = [];
  for (const name of names) {
    const record = state.get(name);
    if (!record?.pieces?.length) continue;
    const worn = record.pieces.filter((piece) => piece.state?.location !== 'removed' && piece.state?.location !== 'floor');
    const off = record.pieces.filter((piece) => piece.state?.location === 'removed' || piece.state?.location === 'floor');
    const parts = [...worn.map(describePiece), ...off.map((piece) => `${piece.design || '衣物'}已脱`)];
    if (parts.length) lines.push(`- ${name}：${parts.join('、')}`);
  }
  return lines;
}

/**
 * 生成注入文本。没有可注入内容时返回空串（调用方据此清空旧注入）。
 */
export function wardrobeLockText(
  chat: readonly STMessage[],
  entries: readonly CharTagEntry[],
  tail = 6,
): string {
  if (!Array.isArray(chat) || !chat.length || !entries.length) return '';
  let state: ClothingState;
  try {
    state = clothingBefore(chat as STMessage[], chat.length, entries as CharTagEntry[]);
  } catch {
    return '';
  }
  const names = presentNames(chat, entries, tail);
  if (!names.length) return '';
  const lines = render(state, names);
  if (!lines.length) return '';
  return [
    '【着装锁定：唯一真源，必须逐字沿用】',
    ...lines,
    '写这一楼正文时，上述人物只穿这些衣物、只处于这些状态。没有明确写下换装/脱下动作前，不得自行更换款式、颜色或穿脱状态（例：上一条写长牛仔裤，就一直写长牛仔裤）。',
    '要脱或要换，必须在这一段里写出动作与衣物；没写动作就当没发生。',
  ].join('\n');
}
