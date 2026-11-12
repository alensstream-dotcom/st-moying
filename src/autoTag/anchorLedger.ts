import type { STMessage } from '@/st/context';
import type { CharTagEntry } from '@/state/charTags';
import { resolveCanonicalCharName } from './charReuse';
import { isGenericCharacterName } from './genericName';
import { isClothingDescription } from './outfitTimeline';
import { isCollarToken, isPropToken, storyMentionsCollar, storyMentionsProp } from './props';
import { parseImageTagContent } from '@/st/imageTagRegex';

/**
 * 上镜锚点（跨楼层画面事实）。
 *
 * 借鉴 LittleWhiteBox 的做法：系统维护一份「每个角色最近一次实际入画时，真正下发
 * 给生图模型的英文 tag」（外貌 + 着装），下次规划时当作**既成事实**喂给模型——
 * 默认逐字复用，只有正文明确写出变化（染发、换装、受伤）才改写，正文与锚点冲突
 * 以正文为准。
 *
 * 与角色库的分工：角色库是用户维护的权威身份资料，本模块不修改它；锚点只负责
 * 「上一张图里她长这样、穿这身」这一条容易被模型忘掉的事实。
 *
 * 数据源刻意不新建存储：直接用前面楼层的 clothing frames（frames[].tag 就是当时
 * 下发的完整 tag 文本），删楼/换 swipe 后锚点自然失效。
 */

/** 一条锚点：某角色最近一次入画时的外貌、着装 tag 与随身道具。 */
export interface AnchorEntry {
  name: string;
  appear: string;
  costume: string;
  /** 刀、手铐、绳这类一次性道具。只在正文还提到时保留。 */
  props: string;
  floor: number;
}

/** 单条 tag 长度上限，防御模型偶尔写成长句。 */
const MAX_TAG = 240;

/** 只看最近这么多楼，避免远处旧锚点把当前场景带偏。 */
const LOOKBACK = 24;

/** 锚点表上限；超了淘汰最久未出现的角色。 */
const MAX_ENTRIES = 40;

function tidy(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TAG);
}

/**
 * 把一条角色 tag 拆成「外貌」「着装」「道具」三堆。
 *
 * 道具单独一堆是这次修 bug 的重点：旧代码把 `knife at neck`、`collar`、
 * `handcuffs` 都当成外貌，于是锚点逐字复用后它们就变成了永久挂件。
 */
function splitCharacterTag(tag: string): { appear: string; costume: string; props: string } {
  const appear: string[] = [];
  const costume: string[] = [];
  const props: string[] = [];
  for (const token of tidy(tag).split(',')) {
    const part = token.trim();
    if (!part) continue;
    if (isPropToken(part) || isCollarToken(part)) props.push(part);
    else if (isClothingDescription(part)) costume.push(part);
    else appear.push(part);
  }
  return { appear: appear.join(', '), costume: costume.join(', '), props: props.join(', ') };
}

/**
 * 从 `beforeFloor` 之前的历史图片记录里重建锚点，按楼层升序覆盖（越近越新）。
 *
 * `keep` 决定这个人还要不要留在锚点里：只留本楼还在场（名字出现在目标正文或
 * 已建档名单里）的角色，离场的人继续注入只会把镜头往空处带。通用称呼一律不进。
 *
 * `story` 是这一楼的正文：道具只在正文还提到时才带进锚点。刀架脖子的那一楼
 * 之后正文不再提刀，锚点就不再把 `knife at neck` 传下去。
 */
export function buildAnchors(
  chat: readonly STMessage[],
  beforeFloor: number,
  keep: (name: string) => boolean = () => true,
  story = '',
  entries: readonly CharTagEntry[] = [],
): AnchorEntry[] {
  const table = new Map<string, AnchorEntry>();
  const from = Math.max(0, beforeFloor - LOOKBACK);
  for (let floor = from; floor < beforeFloor && floor < chat.length; floor += 1) {
    const state = chat[floor]?.extra?.bbiOutfitState as
      | { frames?: Array<{ tag?: string }> }
      | undefined;
    const list = Array.isArray(state?.frames) ? state.frames : [];
    for (const frame of list) {
      if (!frame?.tag) continue;
      for (const character of parseImageTagContent(frame.tag).characters) {
        // 锚点按档案主名归档：旧帧里写的是「晚晴」而档案主名是「林晚晴」时，
        // 不归一就会出现「同一个人的两条锚点」，且已建档角色会被当成新人连外貌一起下发。
        const name = entries.length ? resolveCanonicalCharName(character.name.trim(), entries) : character.name.trim();
        if (!name) continue;
        if (isGenericCharacterName(name)) continue;
        if (!keep(name)) continue;
        const parts = splitCharacterTag(character.tag);
        if (!parts.appear && !parts.costume && !parts.props) continue;
        table.set(name, { name, ...parts, floor });
      }
    }
  }
  return [...table.values()]
    .sort((a, b) => a.floor - b.floor)
    .slice(-MAX_ENTRIES)
    .map((entry) => ({ ...entry, props: keepProps(entry.props, story) }));
}

/** 只留正文里还提到的道具；一个都不剩就清空。 */
function keepProps(props: string, story: string): string {
  if (!props) return '';
  return props
    .split(',')
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      if (isCollarToken(part)) return storyMentionsCollar(story);
      return storyMentionsProp(part, story);
    })
    .join(', ');
}

/**
 * 渲染给规划模型的【上镜锚点】区块；没有锚点时返回空串。
 *
 * 已建档角色只带「当前着装」——身份外貌以角色库为准，两处都写会互相打架；
 * 未建档角色才连外貌一起给，免得模型给她重新编一张脸。
 */
export function anchorBlock(
  entries: readonly AnchorEntry[],
  knownNames: readonly string[] = [],
): string {
  const known = new Set(knownNames.map((name) => name.trim()).filter(Boolean));
  const lines: string[] = [];
  for (const entry of entries) {
    const isKnown = known.has(entry.name);
    const parts: string[] = [];
    if (!isKnown && entry.appear) parts.push(`上镜外貌: ${entry.appear}`);
    if (entry.costume) parts.push(`当前着装: ${entry.costume}`);
    if (entry.props) parts.push(`随身道具: ${entry.props}`);
    if (!parts.length) continue;
    const suffix = isKnown ? '（角色库已录入，身份外貌取角色库，此处只作着装一致用）' : '';
    lines.push(`- ${entry.name}${suffix}｜${parts.join('｜')}`);
  }
  if (!lines.length) return '';
  return [
    '【上镜锚点】下列是这些角色最近一次实际入画时下发给模型的英文 tag，属于仍然成立的画面事实（不是新设定）：',
    lines.join('\n'),
    '逐字复用这些 tag；只有正文明确写出变化（染发、换装、受伤、脱下）才改写对应部分，正文与锚点冲突时以正文为准。',
    '「随身道具」是一次性的（刀、手铐、绳、托盘…），拿到或放下都要看本楼正文，正文没再提就别画；饰品（choker、项链、耳环、腕饰）照常留着。',
  ].join('\n');
}
