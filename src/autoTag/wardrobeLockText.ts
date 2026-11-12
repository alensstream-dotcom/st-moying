/**
 * 把「当前着装账本」压成一段短提示，注入聊天上下文（depth=0）。
 *
 * 为什么要有这一层：服装漂移的根源不是渲染，而是**文字模型不知道她穿着什么**。
 * 它在正文里自由改写衣服（长牛仔裤写成短牛仔裤、脱了又自己穿回来），
 * 出图端的账本再准也只能跟着崩。主流做法（SILLYimages / Horae / mvu-helper）
 * 都是把当前 outfit 注入上下文，让写正文的模型照抄。
 */

import type { STMessage } from '../st/context';
import { appearancePolicy } from '../state/appearancePolicy';
import type { CharTagEntry } from '../state/charTags';
import { candidateAliasesForEntry } from './charReuse';
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

/**
 * 最近几条消息里出现过的人名：只对在场角色注入，避免「幽灵换装」。
 *
 * 只认全名不够——正文九成写的是「晚晴」「晚晴小姐」。这里连候选称呼一起认，
 * 否则她明明在场，注入段里却整行缺失，等于没锁。
 */
export function presentNames(chat: readonly STMessage[], entries: readonly CharTagEntry[], tail = 6): string[] {
  const names = new Set<string>();
  if (!Array.isArray(chat) || !chat.length) return [];
  for (const message of chat.slice(-tail)) {
    const text = String(message?.mes ?? '');
    if (!text) continue;
    for (const entry of entries) {
      if (!entry.name) continue;
      if (text.includes(entry.name)) {
        names.add(entry.name);
        continue;
      }
      if (candidateAliasesForEntry(entry).some((alias) => alias && text.includes(alias))) names.add(entry.name);
    }
  }
  return [...names];
}

function render(state: ClothingState, names: readonly string[], entries: readonly CharTagEntry[]): string[] {
  const lines: string[] = [];
  for (const name of names) {
    const record = state.get(name);
    if (!record?.pieces?.length) {
      // 账本里还没有她：这一楼是她的第一次，只能定一次装。不写出来模型就当没这回事，
      // 于是每层重新挑一套——正是衣服乱飘的开端。
      lines.push(`- ${name}：尚未定装（本楼可以按场景决定一套，之后固定沿用）`);
      continue;
    }
    const worn = record.pieces.filter((piece) => piece.state?.location !== 'removed' && piece.state?.location !== 'floor');
    const off = record.pieces.filter((piece) => piece.state?.location === 'removed' || piece.state?.location === 'floor');
    const parts = [...worn.map(describePiece), ...off.map((piece) => `${piece.design || '衣物'}已脱`)];
    // 用户绑定的套装与档案里的固定着装都要点名：这段是写给正文模型的，
    // 不告诉它「这套是钉死的」，它就会照着「更好看」把睡裙写成衬衫。
    const policy = appearancePolicy(name);
    const full = record.suitMode === 'always' || policy?.mode === 'fandom';
    const pinned = full || record.suitMode === 'style' || (policy?.mode === 'manual' && !!policy.fields.outfit);
    const lock = full
      ? '［用户固定整套：只能写穿脱，不许换款式］'
      : pinned
        ? '［款式已固定：要换必须写明确换装动作］'
        : '';
    if (parts.length) lines.push(`- ${name}：${parts.join('、')}${lock}`);
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
  const lines = render(state, names, entries);
  if (!lines.length) return '';
  return [
    '【着装锁定：唯一真源，必须逐字沿用】',
    ...lines,
    '写这一楼正文时，上述人物只穿这些衣物、只处于这些状态。没有明确写下换装/脱下动作前，不得自行更换款式、颜色或穿脱状态（例：上一条写长牛仔裤，就一直写长牛仔裤）。',
    '要脱或要换，必须在这一段里写出动作与衣物；没写动作就当没发生。标了［款式已固定］的人，只写穿脱与半脱，别改廓形、颜色与长度；真要换装就明确写「换上/换成 + 新衣物」。',
  ].join('\n');
}
