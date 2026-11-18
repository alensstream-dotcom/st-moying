/**
 * 每楼诊断轨迹（第五包）。
 *
 * 为什么要把「中间过程」存下来：一张图出问题，用户只能看到最终 tag，
 * 看不到「它选自哪一句、原本定的是哪个动作、这套衣服是从哪来的、我写的
 * 自然语言被谁改成了这样」。没有这份轨迹，所有排障都靠重新跑一遍——现在
 * 一楼要十到十五分钟，重跑三次才能定位一个偏差，代价不可接受。
 *
 * 只存诊断用的字段：不参与生成、不影响提示词、不进 NAI 请求。
 */

import type { StoryFact } from '@/autoTag/facts';
import type { ClothingState } from '@/autoTag/outfitTimeline';

export const BBI_TRACE_EXTRA_KEY = 'bbiTrace';

export interface TraceCharacter {
  name: string;
  /** 该角色这一刻的穿搭（账本渲染），用来核对「用的是哪套衣服」。 */
  outfit: string;
  /** 模型这一次写的 tag，出口清洗后。 */
  tag: string;
  /** 模型这一次写的自然语言，出口清洗后。 */
  nl: string;
  /** 模型原始写的那一句（清洗前），用来判断「是模型写得差，还是被改坏了」。 */
  nlOriginal: string;
}

export interface TraceImage {
  position: string;
  candidateId?: string;
  frameAction?: string;
  focus?: string;
  /** 这一格选中的正文原句（P 编号对应的句子）。 */
  segment: string;
  tag: string;
  nl: string;
  nlOriginal: string;
  characters: TraceCharacter[];
}

export interface FloorTrace {
  v: 1;
  at: number;
  floor: number;
  /** 本楼事实条数与「哪些人是跨场景复原出来的」。 */
  facts: number;
  restored?: string[];
  /** 服装事件：复原/更衣/脱衣，含人物、套装与地点。 */
  events?: string[];
  images: TraceImage[];
}

function outfitLine(state: ClothingState, name: string): string {
  const record = state.get(name);
  if (!record?.pieces.length) return '';
  return record.pieces
    .map((piece) => {
      const state_ = piece.state ?? {};
      const bits = [
        state_.location && state_.location !== 'worn' ? String(state_.location) : '',
        state_.arrangement && state_.arrangement !== 'normal' ? String(state_.arrangement) : '',
        state_.fastening && state_.fastening !== 'closed' ? String(state_.fastening) : '',
        state_.exposure ? String(state_.exposure) : '',
      ].filter(Boolean);
      return bits.length ? `${piece.design}(${bits.join('/')})` : piece.design;
    })
    .join(' + ');
}

export interface BuildTraceArgs {
  floor: number;
  facts: readonly StoryFact[] | undefined;
  restored?: readonly string[];
  /** 服装事件摘要（复原/更衣/脱衣）：人物、套装、地点。 */
  events?: readonly string[];
  images: ReadonlyArray<{
    position: string;
    candidateId?: string;
    frameAction?: string;
    focus?: string;
    tag: string;
    nl?: string;
    characters?: ReadonlyArray<{ name: string; tag: string; nl?: string }>;
  }>;
  /** 清洗前的那一份（按 position 索引）。 */
  original: ReadonlyMap<string, { nl: string; characters: ReadonlyArray<{ name: string; nl: string }> }>;
  wardrobes: readonly ClothingState[];
  segmentOf: (position: string) => string;
}

export function buildFloorTrace(args: BuildTraceArgs): FloorTrace {
  return {
    v: 1,
    at: Date.now(),
    floor: args.floor,
    facts: args.facts?.length ?? 0,
    ...(args.restored?.length ? { restored: [...args.restored] } : {}),
    ...(args.events?.length ? { events: [...args.events] } : {}),
    images: args.images.map((image, index) => {
      const before = args.original.get(image.position);
      const wardrobe = args.wardrobes[index];
      return {
        position: image.position,
        ...(image.candidateId ? { candidateId: image.candidateId } : {}),
        ...(image.frameAction ? { frameAction: image.frameAction } : {}),
        ...(image.focus ? { focus: image.focus } : {}),
        segment: args.segmentOf(image.position),
        tag: image.tag,
        nl: image.nl ?? '',
        nlOriginal: before?.nl ?? '',
        characters: (image.characters ?? []).map((character) => ({
          name: character.name,
          outfit: wardrobe ? outfitLine(wardrobe, character.name) : '',
          tag: character.tag,
          nl: character.nl ?? '',
          nlOriginal: before?.characters.find((entry) => entry.name === character.name)?.nl ?? '',
        })),
      };
    }),
  };
}
