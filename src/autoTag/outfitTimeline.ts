import type { TargetSegment } from './clean';
import type { ImageInsertion } from './protocol';
import { extractGarment, readOutfitState, readWear, BBI_OUTFIT_EXTRA_KEY } from './outfitState';
import { resolveCanonicalCharName } from './charReuse';
import type { CharTagEntry } from '@/state/charTags';
import type { STMessage } from '@/st/context';
import { parseImageTagContent, parseImageTags, stripImageTags } from '@/st/imageTagRegex';

export interface ClothingPiece {
  id: string;
  design: string;
  state: Record<string, string>;
}
export interface ClothingRecord { name: string; outfitId: string; pieces: ClothingPiece[]; source: string }
export interface ClothingChange {
  name: string; position: string; sourceLine: number; charOffset: number;
  operation: 'init' | 'change' | 'patch' | 'add'; evidence: string; pieces: ClothingPiece[];
}
export interface ClothingFloor {
  legacyBackup?: unknown;
  v: 2; swipe: number; sourceHash: string; upstreamHash: string;
  start: ClothingRecord[]; entries: ClothingRecord[]; changes: ClothingChange[]; rejected: string[];
  frames: Array<{ tag: string; sourceLine: number; charOffset: number; entries: ClothingRecord[] }>;
}
export type ClothingState = Map<string, ClothingRecord>;
export const CLOTHING_PROTOCOL = `服装连续性补充协议（本节替代“根据图片提示词反推账本”）：
最终 JSON 增加 outfitChanges 数组。没有变化就 []；即使 images=[]，正文里的穿脱变化也必须报告。
每项 {name,position,operation,evidence,pieces:[{id,design,state}]}，position 用本节 P 编号；name 用人物库原名。
operation=init：仅首次没有穿搭时建立整套；明确剧情用原文证据，无描写时可以一次性补全，evidence=""，后续直接继承。
operation=patch：只改已有衣物状态，design 留空，必须引用原文动作，证据需包含角色名（代词动作连同此前姓名一起引用）。
operation=add：剧情明确加穿一件衣物，只新增部件，不能重置其他衣服。
operation=change：只有明确换装/穿回等事件才整套替换，不能因为时间/场景跳跃、特写或没提衣服就 change。
pieces 的 id 持续使用账本中的 ID。design 只写该部件具体英文款式、颜色、面料，不含脸/发色/体型/穿脱状态。
state 可用 location=worn/removed/held/floor/chair/unknown；fastening=closed/open/loose/unknown；arrangement=normal/lifted/pulled_aside/lowered/around_waist/around_ankles/unknown；leftSleeve/rightSleeve=on_arm/off_arm/rolled_up/unknown；damage=intact/torn/unknown；wetness=dry/wet/unknown。
只列变化字段，未列的字段必须继承。掀裙不是脱掉整套，解衬衫扣子不是重新选衣服；恢复也要有明确整理/穿好证据。
例如上一楼 blouse 的 fastening=open，本楼仅聊天，不输出任何恢复事件，画面仍沿用敞开状态。
人物库 changes 的永久外貌变更必须额外给 evidence（逐字原文且包含角色名），不得因补绘、光照或你自己的猜测修改档案。手动指定同人角色的档案不允许 AI 修改。
服装不得写到人物库 changes.outfit/extra；当前穿搭只由 outfitChanges 管理。各图 tag/nl 与各自正文位置的状态一致。
无论后端是否支持独立人物提示，都请提供有姓名的 characters 数组用于内部关联；程序再适配后端。`;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const text = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 1600) : '';
const STATES: Record<string, string[]> = {
  location: ['worn','removed','held','floor','chair','unknown'],
  fastening: ['closed','open','loose','unknown'],
  arrangement: ['normal','lifted','pulled_aside','lowered','around_waist','around_ankles','unknown'],
  leftSleeve: ['on_arm','off_arm','rolled_up','unknown'], rightSleeve: ['on_arm','off_arm','rolled_up','unknown'],
  damage: ['intact','torn','unknown'], wetness: ['dry','wet','unknown'],
};
const ACTION = /换|穿|脱|褪|披|套|扣|解|系|敞|掀|撩|拨|拉|放|拿|卷|撕|破|扯|整理|恢复|wear|dress|chang|put|tak|remov|unfasten|fasten|open|clos|lift|pull|lower|roll|tear|torn|wet/i;
const REPLACE = /换上|换下|换成|换衣|更衣|换了.{0,12}(衣|裙|裤|服|袍)|重新穿|穿回|穿上|套上|披上|change.{0,16}(clothes|outfit|into)|put.{0,8}on|redress/i;
const VISUAL_MARKUP = /<\/?(?:bbi_image|tag|nl|negative|characters|size)\b/i;

export function continuityHash(value: string): string {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return (n >>> 0).toString(36);
}
export function narrativeHash(value: string): string {
  return continuityHash(stripImageTags(value).replace(/\s+/g, ''));
}
function contribution(message: STMessage): string {
  const raw = message.extra?.[BBI_OUTFIT_EXTRA_KEY] as Partial<ClothingFloor> | undefined;
  return JSON.stringify([narrativeHash(message.mes), message.swipe_id ?? 0,
    raw?.v === 2 ? [raw.changes, raw.entries] : readOutfitState(message)?.entries ?? null]);
}
export function clothingRevision(chat: STMessage[], beforeFloor: number): string {
  let hash = '';
  for (let i = 0; i < Math.min(beforeFloor, chat.length); i++) hash = continuityHash(hash + contribution(chat[i]));
  return hash;
}
export function readClothingFloor(message: STMessage | undefined, upstreamHash?: string): ClothingFloor | null {
  const raw = message?.extra?.[BBI_OUTFIT_EXTRA_KEY] as ClothingFloor | undefined;
  return raw?.v === 2 && Array.isArray(raw.entries) && Array.isArray(raw.changes) && Array.isArray(raw.frames)
    && raw.swipe === (message?.swipe_id ?? 0) && raw.sourceHash === narrativeHash(message?.mes ?? '')
    && (upstreamHash === undefined || raw.upstreamHash === upstreamHash) ? copy(raw) : null;
}
function legacyRecord(name: string, design: string, wear: string, state: string): ClothingRecord {
  // Preserve legacy uncertainty; never turn a crop or omitted state into 'fully dressed'.
  return { name, outfitId: `legacy_${continuityHash(name + design)}`, source: '旧版记录（部件未确认）',
    pieces: [{ id: 'legacy', design, state: { location: wear === 'off' ? 'removed' : 'unknown', ...(state ? { legacy: state } : {}) } }] };
}
export function clothingBefore(chat: STMessage[], beforeFloor: number, entries: CharTagEntry[]): ClothingState {
  const state: ClothingState = new Map();
  for (const e of entries) if (e.fields.outfit.trim()) state.set(e.name, legacyRecord(e.name, e.fields.outfit, 'worn', ''));
  let hash = '';
  for (let floor = 0; floor < Math.min(beforeFloor, chat.length); floor++) {
    const message = chat[floor], raw = message.extra?.[BBI_OUTFIT_EXTRA_KEY] as { v?: number } | undefined;
    const saved = readClothingFloor(message, hash);
    if (saved) { state.clear(); for (const entry of saved.entries) state.set(entry.name, entry); }
    else if (raw?.v !== 2) {
      const old = readOutfitState(message);
      if (old?.swipe === (message.swipe_id ?? 0)) {
        for (const e of old.entries) {
          const name = resolveCanonicalCharName(e.name, entries);
          state.set(name, legacyRecord(name, e.garment, e.wear, e.state));
        }
      } else {
        // Read-only compatibility only. New v2 states are never inferred from image prompts.
        for (const tag of parseImageTags(message.mes)) for (const c of parseImageTagContent(tag).characters) {
          const name = resolveCanonicalCharName(c.name, entries);
          if (state.has(name)) continue;
          const design = extractGarment(c.tag), wear = readWear(c.tag);
          if (design || wear.wear !== 'worn') state.set(name, legacyRecord(name, design, wear.wear, wear.state));
        }
      }
    }
    hash = continuityHash(hash + contribution(message));
  }
  return state;
}
export function parseClothingChanges(raw: unknown, segments: TargetSegment[]): ClothingChange[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).flatMap((item): ClothingChange[] => {
    if (!item || typeof item !== 'object') return [];
    const at = segments.find(s => s.id === text(item.position).toUpperCase());
    if (!at || !text(item.name) || !['init','change','patch','add'].includes(item.operation) || !Array.isArray(item.pieces)) return [];
    const pieces = item.pieces.slice(0, 24).flatMap((p: Record<string, unknown>) => {
      if (!p || typeof p !== 'object' || !text(p.id) || VISUAL_MARKUP.test(text(p.design))) return [];
      const state = Object.fromEntries(Object.entries(p.state && typeof p.state === 'object' ? p.state : {}).filter(([k, v]) => STATES[k]?.includes(String(v))).map(([k, v]) => [k, String(v)]));
      return [{ id: text(p.id), design: text(p.design), state }];
    });
    if (!pieces.length || new Set(pieces.map((p: ClothingPiece) => p.id)).size !== pieces.length) return [];
    return [{ name: text(item.name), position: at.id, sourceLine: at.sourceLine, charOffset: at.charOffset ?? 0,
      operation: item.operation, evidence: text(item.evidence), pieces }];
  }).sort((a, b) => a.sourceLine - b.sourceLine || a.charOffset - b.charOffset);
}
function reached(change: ClothingChange, line: number, offset: number): boolean {
  return change.sourceLine < line || change.sourceLine === line && change.charOffset <= offset;
}
export function acceptClothingChanges(changes: ClothingChange[], source: string, before: ClothingState, entries: CharTagEntry[]): { changes: ClothingChange[]; rejected: string[] } {
  const result: ClothingChange[] = [], rejected: string[] = [], state = copy([...before.values()]);
  const current: ClothingState = new Map(state.map(e => [e.name, e]));
  for (const raw of changes) {
    const c = copy(raw); c.name = resolveCanonicalCharName(c.name, entries);
    const old = current.get(c.name);
    const line = source.replace(/\r\n?/g, '\n').split('\n');
    const preceding = [...line.slice(0, c.sourceLine), (line[c.sourceLine] ?? '').slice(0, c.charOffset || undefined)].join('\n');
    const mentioned = c.evidence.includes(c.name) || entries.some(e => e.name === c.name && c.evidence.includes(raw.name));
    let reason = '';
    if (!entries.some(e => e.name === c.name) && !preceding.includes(c.name)) reason = '无法确认该服装记录对应的人物';
    else if (c.operation !== 'init' && (!c.evidence || !preceding.includes(c.evidence) || !mentioned || !ACTION.test(c.evidence))) reason = '变化缺少可定位到该人物的原文动作证据';
    else if (c.operation === 'init' && old) reason = '已有穿搭，不能重新初始化';
    else if (c.operation === 'init' && c.evidence && (!preceding.includes(c.evidence) || !mentioned)) reason = '初始服装引用的剧情证据无效';
    else if (c.operation === 'change' && old && !REPLACE.test(c.evidence)) reason = '没有明确换装/重新穿戴证据，不能整套重置';
    else if (c.operation === 'patch' && (!old || c.pieces.some(p => !old.pieces.some(o => o.id === p.id)))) reason = '局部变化指向未知衣物部件';
    else if (c.operation !== 'patch' && c.pieces.some(p => !p.design || /\b(?:hair|eyes|face|skin|breasts|1girl|1boy)\b/i.test(p.design))) reason = '服装设计为空或混入人物外貌';
    else if (c.operation === 'add' && (!old || c.pieces.some(p => old.pieces.some(o => o.id === p.id)))) reason = '新增衣物需要已有穿搭且部件 ID 不能重复';
    if (reason) { rejected.push(`${c.name} ${c.position}: ${reason}`); continue; }
    result.push(c); applyOne(current, c, 'accepted');
  }
  return { changes: result, rejected };
}
function applyOne(state: ClothingState, c: ClothingChange, scope: string): void {
  const old = state.get(c.name);
  if (c.operation === 'patch') {
    for (const p of c.pieces) { const piece = old?.pieces.find(g => g.id === p.id); if (piece) Object.assign(piece.state, p.state); }
  } else if (c.operation === 'add' && old) {
    old.pieces.push(...copy(c.pieces).map(p => ({ ...p, state: { location: 'worn', ...p.state } })));
  } else if (c.operation === 'change' || !old) {
    state.set(c.name, { name: c.name, outfitId: `outfit_${continuityHash(scope + c.name + c.position + JSON.stringify(c.pieces))}`,
      pieces: copy(c.pieces).map(p => ({ ...p, state: { location: 'worn', ...p.state } })), source: c.evidence || '首次视觉补全（非剧情事实）' });
  }
}
export function clothingAt(before: ClothingState, changes: ClothingChange[], scope: string, line = Infinity, offset = Infinity): ClothingState {
  const result = new Map(copy([...before]).map(([k, v]) => [k, v]));
  for (const c of changes) if (reached(c, line, offset)) applyOne(result, c, scope);
  return result;
}
export function clothingBlock(state: ClothingState): string {
  return '【服装现状：唯一账本】没有变化就逐字段继承；仅初次未知可以 init，不能根据图片 tag 重新记账。\n' + JSON.stringify([...state.values()]);
}
export function clothingTrace(message: STMessage | undefined, rawTag: string): string[] {
  const floor = readClothingFloor(message), frame = floor?.frames.find(f => f.tag === rawTag);
  if (!floor || !frame) return [];
  const cast = parseImageTagContent(rawTag).characters.map(c => c.name);
  return [...frame.entries.filter(e => cast.includes(e.name)).map(e => `${e.name} · ${e.outfitId} · ${e.pieces.map(p => `${p.design || p.id} [${Object.entries(p.state).map(([k,v]) => `${k}=${v}`).join(', ')}]`).join('；')}`),
    ...floor.rejected.map(r => `状态处理：${r}`)];
}
/** One-time compatibility completion only when the LLM omitted a first outfit.
 * Once recorded, later image prompts can never replace it. */
export function initialiseClothingFromImage(image: ImageInsertion, state: ClothingState): void {
  for (const c of image.characters) {
    if (state.has(c.name)) continue;
    const parts = extractGarment(c.tag).split(',').map(s => s.trim()).filter(Boolean);
    const wear = readWear(c.tag);
    if (!parts.length && wear.wear === 'worn') continue;
    state.set(c.name, legacyRecord(c.name, parts.join(', '), wear.wear, wear.state));
  }
}
export function savedImageClothing(image: ImageInsertion, before: ClothingState): ClothingState {
  const state: ClothingState = new Map(copy([...before]));
  for (const c of image.characters) {
    const wear = readWear(c.tag), design = extractGarment(c.tag);
    if (design || wear.wear !== 'worn') state.set(c.name, legacyRecord(c.name, design, wear.wear, wear.state));
  }
  return state;
}
const CLOTHING_WORD = /\b(?:dress|shirt|skirt|pants|trousers|shorts|jeans|jacket|blazer|coat|suit|bra|panties|underwear|lingerie|stockings|thighhighs|pantyhose|tights|socks|shoes|boots|heels|uniform|serafuku|hanfu|kimono|robe|collar|sleeves?|clothes|clothing|outfit|sash|belt|ribbon|cloak|cape|gloves|swimsuit|bikini|apron|corset|hoodie|sweater|cardigan|blouse|tunic)\b/i;
const WEAR_WORD = /\b(?:nude|naked|topless|bottomless|fully clothed|off shoulder|breasts out|undressed)\b/i;
const CLOTHING_ACTION = /\b(?:holding|grabbing|pulling|lifting|tugging|unbuttoning|taking off|removing)\b/i;
export function isClothingDescription(value: string): boolean {
  return (CLOTHING_WORD.test(value) || WEAR_WORD.test(value)) && !CLOTHING_ACTION.test(value);
}
export function clothingCaption(record: ClothingRecord): { tag: string; nl: string } {
  const tags: string[] = [], sentences: string[] = [];
  let upperRemoved = false, lowerRemoved = false, upperWorn = false, lowerWorn = false;
  for (const p of record.pieces) {
    const s = p.state, location = s.location;
    const both = /\b(?:dress|robe|uniform|jumpsuit|bodysuit|no clothes)\b/i.test(p.design);
    const upper = both || /\b(?:shirt|blouse|bra|jacket|blazer|coat|sweater|top|camisole|corset|tunic)\b/i.test(p.design);
    const lower = both || /\b(?:skirt|pants|trousers|shorts|jeans|panties|underwear)\b/i.test(p.design);
    if (['removed','floor','chair','held'].includes(location)) {
      upperRemoved ||= both || /\b(?:shirt|blouse|bra|sweater|top|camisole|corset|tunic)\b/i.test(p.design); lowerRemoved ||= lower;
      if (p.id === 'legacy') { if (s.legacy) tags.push(s.legacy); continue; }
      if (location !== 'removed') sentences.push(`The ${p.design} is ${location === 'held' ? 'held, not worn' : `on the ${location}, not worn`}.`);
      continue;
    }
    upperWorn ||= upper; lowerWorn ||= lower;
    tags.push(p.design);
    if (s.legacy) tags.push(s.legacy);
    if (s.fastening === 'open') tags.push('open clothes');
    if (s.fastening === 'loose') tags.push('loose clothes');
    if (s.leftSleeve === 'off_arm' || s.rightSleeve === 'off_arm') tags.push('off shoulder');
    if (s.leftSleeve === 'rolled_up' || s.rightSleeve === 'rolled_up') tags.push('sleeves rolled up');
    if (s.damage === 'torn') tags.push('torn clothes');
    if (s.wetness === 'wet') tags.push('wet clothes');
    const arrangements: Record<string, string> = { lifted: /skirt|dress/i.test(p.design) ? 'skirt lifted' : 'clothes lifted', pulled_aside: 'clothes pulled aside', lowered: 'clothes down', around_waist: 'clothes around waist', around_ankles: 'clothes around ankles' };
    if (arrangements[s.arrangement]) tags.push(arrangements[s.arrangement]);
    const detail = [s.fastening === 'open' ? 'unfastened' : '', arrangements[s.arrangement], s.leftSleeve === 'off_arm' ? 'left sleeve off the arm' : '', s.rightSleeve === 'off_arm' ? 'right sleeve off the arm' : '', s.legacy].filter(Boolean).join(', ');
    if (p.design) sentences.push(`Wearing ${p.design}${detail ? `, ${detail}` : ''}.`);
  }
  if (upperRemoved && !upperWorn && lowerRemoved && !lowerWorn) tags.push('nude');
  else { if (upperRemoved && !upperWorn) tags.push('topless'); if (lowerRemoved && !lowerWorn) tags.push('bottomless'); }
  return { tag: [...new Set(tags.filter(Boolean))].join(', '), nl: sentences.join(' ') };
}
export function enforceClothing(image: ImageInsertion, state: ClothingState, nl: boolean, independent: boolean): void {
  let managed = 0;
  for (const c of image.characters) {
    const record = state.get(c.name); if (!record) continue;
    managed++;
    const caption = clothingCaption(record);
    const dynamic = c.tag.split(',').map(t => t.trim()).filter(t => t && !isClothingDescription(t));
    c.tag = [...new Set([...dynamic, ...caption.tag.split(',').map(t => t.trim()).filter(Boolean)])].join(', ');
    if (nl) c.nl = [c.nl.split(/(?<=[.!?])\s+/).filter(s => !CLOTHING_WORD.test(s) && !WEAR_WORD.test(s)).join(' '), caption.nl].filter(Boolean).join(' ');
  }
  if (managed && independent) {
    image.tag = image.tag.split(',').map(t => t.trim()).filter(t => t && !isClothingDescription(t)).join(', ');
    if (nl) image.nl = image.nl.split(/(?<=[.!?])\s+/).filter(s => !CLOTHING_WORD.test(s) && !WEAR_WORD.test(s)).join(' ');
  } else if (managed && image.characters.length === 1) {
    image.tag = [...new Set([...image.tag.split(',').map(t => t.trim()).filter(t => t && !isClothingDescription(t)), ...image.characters[0].tag.split(',').map(t => t.trim())])].join(', ');
    if (nl) image.nl = image.characters[0].nl;
  }
}
