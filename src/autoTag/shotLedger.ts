import type { STMessage } from '@/st/context';
import { parseImageTagContent } from '@/st/imageTagRegex';
import { extractShotSignature } from './shotCheck';

/**
 * 画面账本（跨楼层「已经画过什么」）。
 *
 * 现实问题：内部上下文只带最近几楼，超出窗口的图模型根本看不见，于是同一体位、
 * 同一机位被反复画；反过来「这楼的情欲瞬间已经出过图了」这件事它也无从判断，
 * 只能一遍遍重画同一个瞬间。
 *
 * 数据源和 anchorLedger 一样刻意不新建存储：直接用各楼层 clothing frames 里已经
 * 下发过的 tag。删楼、换 swipe 之后账本自然失效，不需要额外清理逻辑。
 *
 * 输出给规划模型的是**去重签名**（体位/机位/景别 + 接触词），不是完整 tag：
 * 完整 tag 会诱导模型照抄，签名只负责告诉它「这些已经画过了」。
 */

/** 一条已出图记录。 */
export interface ShotEntry {
  floor: number;
  /** 该图所在正文那一句（截断），让模型知道「这一格画的是哪一段」。 */
  scene: string;
  /** 取景签名：景别+机位，如 `upper body / from side`。 */
  signature: string;
  /** 动作签名：接触词组，如 `hand on breast`、`panties aside`。 */
  action: string;
}

/** 只看最近这么多楼：更早的画面与当前剧情基本不相干，带进来只会占 token。 */
const LOOKBACK = 12;

/** 账本上限，超出后保留最近的。 */
const MAX_ENTRIES = 24;

const MAX_TEXT = 80;

/** 从一条完整 tag 里抽出「看得见的骨架」：去掉外貌、服装款式与质量词。 */
const DROP_TOKEN =
  /^(?:1girl|2girls|3girls|1boy|2boys|3boys|\d+\+\d+|solo|multiple girls|multiple boys|group|best quality|highres|absurdres|masterpiece|detailed|cinematic|soft lighting|depth of field|blurry background|looking at viewer|looking away|looking at another|facing viewer|facing away|in profile)$/i;

/** 这些词说明「这一格在做什么」，比景别更有去重价值。 */
const ACTION_HINT =
  /\b(?:hand|hands|finger|fingers|arm|arms|mouth|tongue|lips|kiss\w*|suck\w*|lick\w*|bite|grab\w*|hold\w*|press\w*|pin\w*|rub\w*|brush\w*|insert\w*|penetrat\w*|inside|around|against|on|between|across|spread\w*|lift\w*|pull\w*|aside|down|bent over|straddl\w*|riding|kneel\w*|wrapped)\b/i;

function tidy(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 一条 tag → 动作签名。
 *
 * 只留带介词/分词的接触词组与体位词：`hand on breast`、`panties aside`、
 * `bent over`。外貌（long black hair）、服装款式（white shirt）与质量词全部丢掉——
 * 它们由角色库和服装账本负责，混进签名里会让「同一姿势」因为衣服变了而认不出来。
 */
export function actionSignature(tag: string): string {
  const tokens = tidy(tag)
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !DROP_TOKEN.test(token))
    .filter((token) => ACTION_HINT.test(token));
  return tidy([...new Set(tokens)].join(', ')).slice(0, 160);
}

/** 这一格讲的是哪一段：取正文首句的前几十字，够模型对上号就行。 */
function sceneOf(source: string, sourceLine: number): string {
  const lines = String(source ?? '').split('\n');
  const line = tidy(lines[sourceLine] ?? '');
  if (!line) return '';
  const first = line.split(/[。！？!?…；;]/)[0] ?? line;
  return tidy(first).slice(0, MAX_TEXT);
}

/**
 * 收集前面楼层已经实际出过的画面。
 *
 * @param framesSource 提供各楼层 frames 的函数（测试注入用）；默认读 chat extra。
 */
export function buildShotLedger(
  chat: readonly STMessage[],
  beforeFloor: number,
  scenes: (floor: number) => string = () => '',
): ShotEntry[] {
  const entries: ShotEntry[] = [];
  const from = Math.max(0, beforeFloor - LOOKBACK);
  for (let floor = from; floor < beforeFloor && floor < chat.length; floor += 1) {
    const state = chat[floor]?.extra?.bbiOutfitState as
      | { frames?: Array<{ tag?: string; sourceLine?: number }> }
      | undefined;
    const frames = Array.isArray(state?.frames) ? state.frames : [];
    for (const frame of frames) {
      const tag = tidy(frame?.tag ?? '');
      if (!tag) continue;
      const parsed = parseImageTagContent(tag);
      const base = parsed.tag ?? '';
      const characterTags = parsed.characters.map((character) => character.tag ?? '');
      const shot = extractShotSignature(base, characterTags);
      const signature = tidy([shot.distance, shot.angle].filter(Boolean).join(' / '));
      const action = actionSignature([base, ...characterTags].join(', '));
      const scene = sceneOf(scenes(floor), Number(frame?.sourceLine ?? 0));
      if (!signature && !action && !scene) continue;
      entries.push({ floor, scene, signature, action });
    }
  }
  return entries.slice(-MAX_ENTRIES);
}

/**
 * 渲染成【已出过的画面】区块；没有记录时返回空串。
 *
 * 措辞刻意区分「姿势已画过」与「这一格不用再画」：模型最需要知道的是
 * 「同一个情欲瞬间不必重画」，而不是机械地避开某个机位。
 */
export function shotLedgerBlock(entries: readonly ShotEntry[]): string {
  if (!entries.length) return '';
  const lines = entries.map((entry, index) => {
    const parts = [entry.signature ? `取景 ${entry.signature}` : '', entry.action ? `动作 ${entry.action}` : '']
      .filter(Boolean)
      .join('｜');
    return `${index + 1}. 第 ${entry.floor} 楼${entry.scene ? `「${entry.scene}」` : ''}：${parts}`;
  });
  return [
    '【已出过的画面】这些画面已经生成过，是本楼之内与之前楼层实际下发的取景与动作（不是待画清单）：',
    lines.join('\n'),
    '同一格的动作与取景不要再画一次：本楼若选中了同一情欲瞬间，换一个「还没被画过」的环节（前戏→进入→失控→余韵）或换机位；本楼所有情欲瞬间都已画过时，才允许选日常画面，且必须带身体看点。',
  ].join('\n');
}
