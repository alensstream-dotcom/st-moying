import { registeredName } from '@/state/characterKey';
import { type ScenePlan } from './scene';
import { characterAliases } from '@/state/characterAliases';
import { applyWardrobeChoices, wardrobeChoiceRevision } from '@/state/wardrobeChoice';
import type { CostumeContext, CostumeFloor } from './costumeContext';
import type { TargetSegment } from './clean';
import type { ImageInsertion } from './protocol';
import { extractGarment, readOutfitState, readWear, BBI_OUTFIT_EXTRA_KEY } from './outfitState';
import { resolveCanonicalCharName } from './charReuse';
import type { CharTagEntry } from '@/state/charTags';
import type { STMessage } from '@/st/context';
import { parseImageTagContent, parseImageTags, stripImageTags } from '@/st/imageTagRegex';

export interface ClothingPiece {
  /** Verified source for the garment, preserved across state-only patches. */
  evidence?: string;
  costume?: CostumeContext;
  id: string;
  design: string;
  state: Record<string, string>;
}
export interface ClothingRecord {
  suitMode?: 'style' | 'always';
  boundSuitId?: string;
  manual?: boolean;
  name: string;
  outfitId: string;
  pieces: ClothingPiece[];
  source: string;
}
export interface ClothingChange {
  timeline?: string;
  invalidReason?: string;
  parseNote?: string;
  reportedName?: string;
  subjectEvidence?: string;
  name: string;
  position: string;
  sourceLine: number;
  charOffset: number;
  operation: 'init' | 'change' | 'patch' | 'add';
  evidence: string;
  pieces: ClothingPiece[];
}
export interface ClothingFloor {
  legacyBackup?: unknown;
  delta?: boolean;
  manualChoiceRevision?: string;
  costume?: CostumeFloor;
  v: 2;
  swipe: number;
  sourceHash: string;
  upstreamHash: string;
  start: ClothingRecord[];
  entries: ClothingRecord[];
  changes: ClothingChange[];
  rejected: string[];
  frames: Array<{
    scene?: ScenePlan;
    tag: string;
    sourceLine: number;
    charOffset: number;
    entries: ClothingRecord[];
    appearance?: CharTagEntry[];
    costume?: CostumeContext;
  }>;
}
export type ClothingState = Map<string, ClothingRecord>;
export const CLOTHING_PROTOCOL = `服装连续性补充协议（本节替代“根据图片提示词反推账本”）：
最终 JSON 增加 outfitChanges 数组。没有变化就 []；即使 images=[]，正文里的穿脱变化也必须报告。
每项 {name,position,operation,evidence,subjectEvidence,pieces:[{id,design,state}]}，position 用本节 P 编号；name 用人物库原名。evidence 必须逐字引用实际穿脱动作句，事件在这句动作完成处生效；不要只给楼层最后状态。动作句使用“她”时 subjectEvidence 另引前文明确主语的原文，不能用扩大 evidence 到楼尾的方式补姓名。先记录初始穿着，再按发生顺序记录每次脱、半脱、复穿；第一张发生在脱衣前就必须穿着，后两张发生在脱衣后必须取脱后状态。
operation=init：仅首次没有穿搭时建立整套；明确剧情用原文证据，无描写时可以一次性补全，evidence=""，后续直接继承。
operation=patch：只改已有衣物状态，design 留空，必须引用原文动作，证据引用动作句；代词归属另填 subjectEvidence，不扩大动作引文。
operation=add：剧情明确加穿一件衣物，只新增部件，不能重置其他衣服。
operation=change：只有明确换装/穿回等事件才整套替换，不能因为时间/场景跳跃、特写或没提衣服就 change。
pieces 每件衣物独立 ID，外套、衬衣、内衣、裙子、内裤、袜子必须拆开，不能整套合成一个部件。穿脱时只 patch 对应衣物；未提及的部件和字段省略，不输出默认 normal/worn/closed，不用 unknown 覆盖已知状态。脱去外套不等于上身全裸。半脱优先组合 location=worn、单侧袖口 off_arm、fastening=open、arrangement=lowered 等具体字段，只有衣物完全离身才 removed。pieces 的 id 持续使用账本中的 ID。design 用逗号分隔的独立服装标签，如 white shirt, collared shirt, long sleeves；优先逐字使用新版衣橱候选，不拼形容词长句，不含脸/发色/体型/画风/穿脱状态。
state 可用 location=worn/removed/held/floor/chair/unknown；fastening=closed/open/loose/unknown；arrangement=normal/lifted/pulled_aside/lowered/around_waist/around_ankles/unknown；leftSleeve/rightSleeve=on_arm/off_arm/rolled_up/unknown；damage=intact/torn/unknown；wetness=dry/wet/unknown。
只列变化字段，未列的字段必须继承。掀裙不是脱掉整套，解衬衫扣子不是重新选衣服；恢复也要有明确整理/穿好证据。
例如上一楼 blouse 的 fastening=open，本楼仅聊天，不输出任何恢复事件，画面仍沿用敞开状态。
人物库 changes 的永久外貌变更必须额外给 evidence（逐字原文且包含角色名），不得因补绘、光照或你自己的猜测修改档案。手动指定同人角色的档案不允许 AI 修改。
服装不得写到人物库 changes.outfit/extra；当前穿搭只由 outfitChanges 管理。各图 tag/nl 与各自正文位置的状态一致。
无论后端是否支持独立人物提示，都请提供有姓名的 characters 数组用于内部关联；程序再适配后端。`;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 1600) : '');
const STATES: Record<string, string[]> = {
  location: ['worn', 'removed', 'held', 'floor', 'chair', 'unknown'],
  fastening: ['closed', 'open', 'loose', 'unknown'],
  arrangement: ['normal', 'lifted', 'pulled_aside', 'lowered', 'around_waist', 'around_ankles', 'unknown'],
  leftSleeve: ['on_arm', 'off_arm', 'rolled_up', 'unknown'],
  rightSleeve: ['on_arm', 'off_arm', 'rolled_up', 'unknown'],
  damage: ['intact', 'torn', 'unknown'],
  wetness: ['dry', 'wet', 'unknown'],
};
const ACTION =
  /换|穿|脱|褪|披|套|扣|解|系|敞|掀|撩|拨|拉|放|拿|卷|撕|破|扯|整理|恢复|wear|dress|chang|put|tak|remov|unfasten|fasten|open|clos|lift|pull|lower|roll|tear|torn|wet/i;
const REPLACE =
  /换上|换下|换成|换衣|更衣|换了.{0,12}(衣|裙|裤|服|袍)|重新穿|穿回|穿上|套上|披上|change.{0,16}(clothes|outfit|into)|put.{0,8}on|redress/i;
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
  const choice = wardrobeChoiceRevision(message);
  const base = JSON.stringify([
    narrativeHash(message.mes),
    message.swipe_id ?? 0,
    raw?.v === 2
      ? raw.delta
        ? [raw.changes, raw.entries, raw.costume, true]
        : raw.costume
          ? [raw.changes, raw.entries, raw.costume]
          : [raw.changes, raw.entries]
      : (readOutfitState(message)?.entries ?? null),
  ]);
  return choice === '[]' ? base : JSON.stringify([base, choice]);
}
export function clothingRevision(chat: STMessage[], beforeFloor: number): string {
  let hash = '';
  for (let i = 0; i < Math.min(beforeFloor, chat.length); i++)
    hash = continuityHash(hash + contribution(chat[i]));
  return hash;
}
export function readClothingFloor(
  message: STMessage | undefined,
  upstreamHash?: string,
  summaryOnly = false,
): ClothingFloor | null {
  const raw = message?.extra?.[BBI_OUTFIT_EXTRA_KEY] as ClothingFloor | undefined;
  return raw?.v === 2 &&
    Array.isArray(raw.entries) &&
    Array.isArray(raw.changes) &&
    Array.isArray(raw.frames) &&
    raw.swipe === (message?.swipe_id ?? 0) &&
    raw.sourceHash === narrativeHash(message?.mes ?? '') &&
    (upstreamHash === undefined || raw.upstreamHash === upstreamHash)
    ? copy(summaryOnly ? { ...raw, start: [], frames: [], changes: [], rejected: [] } : raw)
    : null;
}
/** IDs survive hand edits; exact-tag fallback is only for pre-scene records. */
export function findClothingFrame(saved: ClothingFloor | null | undefined, tag: string) {
  const id = parseImageTagContent(tag).scene?.id;
  return saved?.frames.find(f => id ? (f.scene?.id || parseImageTagContent(f.tag).scene?.id) === id : f.tag === tag);
}

function legacyRecord(name: string, design: string, wear: string, state: string): ClothingRecord {
  // Preserve legacy uncertainty; never turn a crop or omitted state into 'fully dressed'.
  return {
    name,
    outfitId: `legacy_${continuityHash(name + design)}`,
    source: '旧版记录（部件未确认）',
    pieces: [
      {
        id: 'legacy',
        design,
        state: { location: wear === 'off' ? 'removed' : 'unknown', ...(state ? { legacy: state } : {}) },
      },
    ],
  };
}
type WardrobeCheckpoint = { prefix: string; seed: string; entries: Array<[string, ClothingRecord]> };
const checkpoints = new WeakMap<STMessage[], Map<number, WardrobeCheckpoint>>();
export function clothingBefore(
  chat: STMessage[],
  beforeFloor: number,
  entries: CharTagEntry[],
): ClothingState {
  const state: ClothingState = new Map();
  for (const e of entries)
    if (e.fields.outfit.trim())
      state.set(e.name, {
        ...legacyRecord(e.name, e.fields.outfit, 'worn', ''),
        manual:
          e.source === 'manual' &&
          (!e.history.some((h) => h.field === 'outfit') ||
            [...e.history].reverse().find((h) => h.field === 'outfit')?.floor === -1),
      });
  const end = Math.min(beforeFloor, chat.length);
  const seed = JSON.stringify([...state]) + JSON.stringify(entries.map(e => [e.name, registeredName(e.name)]));
  const prefixes = [''];
  for (let i = 0; i < end; i++) prefixes.push(continuityHash(prefixes[i] + contribution(chat[i])));
  const cache = checkpoints.get(chat) ?? new Map<number, WardrobeCheckpoint>();
  checkpoints.set(chat, cache);
  let start = 0;
  for (const [index, cached] of cache) {
    if (index <= end && index > start && cached.seed === seed && cached.prefix === prefixes[index]) start = index;
  }
  if (start) { state.clear(); for (const [name, record] of copy(cache.get(start)!.entries)) state.set(name, record); }
  let hash = prefixes[start];
  for (let floor = start; floor < end; floor++) {
    const message = chat[floor],
      raw = message.extra?.[BBI_OUTFIT_EXTRA_KEY] as { v?: number } | undefined;
    const saved = readClothingFloor(message, hash, true);
    if (saved) {
      if (!saved.delta) state.clear();
      for (const entry of saved.entries) { entry.name = registeredName(entry.name); state.set(entry.name, entry); }
    } else if (raw?.v !== 2) {
      const old = readOutfitState(message);
      if (old?.swipe === (message.swipe_id ?? 0)) {
        for (const e of old.entries) {
          const name = resolveCanonicalCharName(e.name, entries);
          state.set(name, legacyRecord(name, e.garment, e.wear, e.state));
        }
      } else {
        // Read-only compatibility only. New v2 states are never inferred from image prompts.
        for (const tag of parseImageTags(message.mes))
          for (const c of parseImageTagContent(tag).characters) {
            const name = resolveCanonicalCharName(c.name, entries);
            if (state.has(name)) continue;
            const design = extractGarment(c.tag),
              wear = readWear(c.tag);
            if (design || wear.wear !== 'worn')
              state.set(name, legacyRecord(name, design, wear.wear, wear.state));
          }
      }
    }
    applyWardrobeChoices(state, message, saved?.manualChoiceRevision);
    hash = prefixes[floor + 1];
    if ((floor + 1) % 32 === 0 || floor + 1 === end) {
      cache.set(floor + 1, { prefix: hash, seed, entries: copy([...state]) });
      while (cache.size > 16) cache.delete(cache.keys().next().value!);
    }
  }
  return state;
}
export function parseClothingChanges(
  raw: unknown,
  segments: TargetSegment[],
  source?: string,
): ClothingChange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 100)
    .flatMap((item): ClothingChange[] => {
      if (!item || typeof item !== 'object') return [];
      const at = segments.find((s) => s.id === text(item.position).toUpperCase());
      if (
        !at ||
        !text(item.name) ||
        !['init', 'change', 'patch', 'add'].includes(item.operation) ||
        !Array.isArray(item.pieces)
      )
        return [];
      const pieces = item.pieces.slice(0, 24).flatMap((p: Record<string, unknown>) => {
        if (!p || typeof p !== 'object' || !text(p.id) || VISUAL_MARKUP.test(text(p.design))) return [];
        const state = Object.fromEntries(
          Object.entries(p.state && typeof p.state === 'object' ? p.state : {})
            .filter(([k, v]) => STATES[k]?.includes(String(v)))
            .map(([k, v]) => [k, String(v)]),
        );
        return [{ id: text(p.id), design: text(p.design), state }];
      });
      if (!pieces.length || new Set(pieces.map((p: ClothingPiece) => p.id)).size !== pieces.length) return [];
      let sourceLine = at.sourceLine,
        charOffset = at.charOffset ?? 0;
      let evidence = text(item.evidence).replace(/\r\n?/g, '\n');
      let invalidReason: string | undefined, parseNote: string | undefined;
      if (source !== undefined && evidence) {
        const normalized = source.replace(/\r\n?/g, '\n');
        // Whitespace and typographic quotes/punctuation do not change event identity.
        const canonical = (char: string) =>
          /\s|[“”‘’「」『』"']/.test(char)
            ? ''
            : (
                {
                  '，': ',',
                  '。': '.',
                  '！': '!',
                  '？': '?',
                  '：': ':',
                  '；': ';',
                  '（': '(',
                  '）': ')',
                } as Record<string, string>
              )[char] || char;
        let compact = '';
        const offsets: number[] = [];
        for (let i = 0; i < normalized.length; i++) {
          const char = canonical(normalized[i]);
          if (char) {
            compact += char;
            offsets.push(i);
          }
        }
        const quote = [...evidence].map(canonical).join('');
        const matches: Array<{ start: number; end: number }> = [];
        if (quote)
          for (let i = compact.indexOf(quote); i >= 0; i = compact.indexOf(quote, i + 1))
            matches.push({ start: offsets[i], end: offsets[i + quote.length - 1] + 1 });
        if (!matches.length) {
          if (item.operation === 'init') {
            parseNote = `${text(item.name)}：初次穿搭引文不在本楼，按暂定初态处理，未作为本楼穿脱事实`;
            evidence = '';
          } else invalidReason = '穿脱引文无法在本楼定位，已隔离此事件，未将前文或改写当作本楼变化';
        } else {
          const lines = normalized.split('\n');
          const hint =
            lines.slice(0, at.sourceLine).reduce((n, line) => n + line.length + 1, 0) + (at.charOffset || 0);
          const ranked = matches
            .map((match) => ({ ...match, distance: Math.abs(match.end - hint) }))
            .sort((a, b) => a.distance - b.distance);
          if (ranked.length > 1 && ranked[0].distance === ranked[1].distance)
            invalidReason = '穿脱引文存在多个同等落点，已隔离此事件';
          else {
            const hit = ranked[0];
            evidence = normalized.slice(hit.start, hit.end);
            const prefix = normalized.slice(0, hit.end).split('\n');
            sourceLine = prefix.length - 1;
            charOffset = prefix[prefix.length - 1].length;
          }
        }
      }
      return [
        {
          timeline: /^memory:P\d+$/.test(String(item.timeline)) ? String(item.timeline) : 'main',
          invalidReason,
          parseNote,
          reportedName: text(item.name),
          subjectEvidence: text(item.subjectEvidence),
          name: text(item.name),
          position: at.id,
          sourceLine,
          charOffset,
          operation: item.operation,
          evidence,
          pieces,
        },
      ];
    })
    .sort((a, b) => a.sourceLine - b.sourceLine || a.charOffset - b.charOffset);
}
function reached(change: ClothingChange, line: number, offset: number): boolean {
  return change.sourceLine < line || (change.sourceLine === line && change.charOffset <= offset);
}
export function unreportedClothingActions(
  source: string,
  changes: ClothingChange[],
  entries: CharTagEntry[],
  before: ClothingState,
): string[] {
  const missing: string[] = [];
  const normalized = source.replace(/\r\n?/g, '\n');
  const pattern =
    /(?:脱下|脱掉|脱去|褪下|褪去|解开|掀起|撩起|穿回|穿上|拉下)[^。！？\n]{0,14}?(?:外套|衬衫|衬衣|上衣|长裙|短裙|裙子|内裤|胸罩|文胸|裤子|丝袜|长袜|衣扣)|(?:外套|衬衫|衬衣|上衣|裙子|内裤|胸罩|文胸|裤子|丝袜)[^。！？\n]{0,8}?(?:脱下|脱掉|脱去|褪下|褪去|解开|掀起|撩起|拉下)/g;
  const names = [...new Set([...entries.map((e) => e.name), ...changes.map((c) => c.name)])];
  for (const match of normalized.matchAll(pattern)) {
    const index = match.index || 0;
    if (
      /没有|并未|不要|不想|别|如果|假如|想要|准备|打算|试图|能否|要不要|可以|要求|命令|让|叫|请/.test(
        normalized.slice(Math.max(0, index - 8), index),
      )
    )
      continue;
    const context = normalized.slice(Math.max(0, index - 300), index);
    const mentions = names
      .map((name) => ({
        name,
        at: Math.max(...[name, ...characterAliases(name)].map((a) => context.lastIndexOf(a))),
      }))
      .filter((m) => m.at >= 0)
      .sort((a, b) => b.at - a.at);
    const actor = mentions[0]?.name;
    const local = context.slice(-24);
    if (
      !/她[^。！？“”「」『』]{0,8}$/.test(local) &&
      ![actor || '', ...characterAliases(actor || '')].filter(Boolean).some((name) => local.includes(name))
    )
      continue;
    if (
      !actor ||
      before.get(actor)?.suitMode === 'always' ||
      (mentions[1] && mentions[0].at === mentions[1].at)
    )
      continue;
    if (!before.has(actor) && !changes.some((c) => c.name === actor && c.operation === 'init')) continue;
    if (!changes.some((c) => c.name === actor && c.evidence.includes(match[0])))
      missing.push(actor + '：' + match[0]);
  }
  return [...new Set(missing)].slice(0, 8);
}
export function acceptClothingChanges(changes: ClothingChange[], source: string, before: ClothingState, entries: CharTagEntry[]) {
  const scopes = [...new Set(changes.map(c => c.timeline || 'main'))];
  const result: { changes: ClothingChange[]; rejected: string[] } = { changes: [], rejected: [] };
  for (const scope of scopes) {
    const group = acceptClothingGroup(changes.filter(c => (c.timeline || 'main') === scope), source, scope === 'main' ? before : new Map(), entries);
    result.changes.push(...group.changes); result.rejected.push(...group.rejected);
  }
  result.changes.sort((a,b) => a.sourceLine-b.sourceLine || a.charOffset-b.charOffset);
  return result;
}
function acceptClothingGroup(
  changes: ClothingChange[],
  source: string,
  before: ClothingState,
  entries: CharTagEntry[],
): { changes: ClothingChange[]; rejected: string[] } {
  const result: ClothingChange[] = [],
    rejected: string[] = [],
    state = copy([...before.values()]);
  const current: ClothingState = new Map(state.map((e) => [e.name, e]));
  for (const raw of changes) {
    const c = copy(raw);
    if (c.invalidReason) {
      rejected.push(c.name + ': ' + c.invalidReason);
      continue;
    }
    if (c.parseNote) rejected.push(c.parseNote);
    c.name = resolveCanonicalCharName(c.name, entries);
    const old = current.get(c.name);
    if (old && c.operation === 'patch')
      for (const piece of c.pieces) {
        if (old.pieces.some((p) => p.id === piece.id) || !piece.design) continue;
        const matches = old.pieces.filter(
          (p) => p.design.trim().toLowerCase() === piece.design.trim().toLowerCase(),
        );
        if (matches.length === 1) piece.id = matches[0].id;
      }
    if (old?.suitMode === 'always') {
      rejected.push(c.name + ': 用户固定套装不接受剧情穿脱或换装');
      continue;
    }
    if (
      old?.suitMode === 'style' &&
      c.operation === 'change' &&
      !/换装|换衣|更衣|换成|换上.{0,16}(?:一套|另一套|新衣|新裙)|change.{0,20}(?:outfit|clothes)|new outfit/i.test(
        c.evidence,
      )
    ) {
      const mapped = c.pieces.map((p) => {
        const existing = old.pieces.find(
          (o) => o.id === p.id || o.design.trim().toLowerCase() === p.design.trim().toLowerCase(),
        );
        return existing ? { ...p, id: existing.id, design: '' } : null;
      });
      if (mapped.every(Boolean)) {
        c.operation = 'patch';
        c.pieces = mapped as ClothingPiece[];
      } else {
        rejected.push(c.name + ': 锁定款式需要明确整套换装才能更换；复穿请更新已有部件状态');
        continue;
      }
    }

    // Re-wearing an existing garment updates that piece; it cannot reset the
    // rest of a partially undressed outfit to the default worn state.
    if (
      old &&
      c.operation === 'change' &&
      !/换装|更衣|换衣|换成|换上.{0,16}(?:一套|另一套|新衣|新裙)|change.{0,20}(?:outfit|clothes)|new outfit/i.test(
        c.evidence,
      )
    ) {
      const mapped = c.pieces.map((p) => {
        const existing = old.pieces.find(
          (o) => o.id === p.id || o.design.trim().toLowerCase() === p.design.trim().toLowerCase(),
        );
        return existing ? { ...p, id: existing.id, design: '' } : null;
      });
      if (mapped.length && mapped.every(Boolean)) {
        c.operation = 'patch';
        c.pieces = mapped as ClothingPiece[];
      } else {
        rejected.push(c.name + ': 非明确换装不能整套重置，请用已有部件 patch 或新增衣物 add');
        continue;
      }
    }
    const line = source.replace(/\r\n?/g, '\n').split('\n');
    const preceding = [
      ...line.slice(0, c.sourceLine),
      (line[c.sourceLine] ?? '').slice(0, c.charOffset || undefined),
    ].join('\n');
    const aliases = [...new Set([c.name, c.reportedName || '', ...characterAliases(c.name)])].filter(Boolean);
    const subjectQuote = c.subjectEvidence || '';
    const explicitSubject =
      aliases.some((name) => c.evidence.includes(name)) ||
      (!!subjectQuote &&
        preceding.includes(subjectQuote) &&
        aliases.some((name) => subjectQuote.includes(name)));
    // Pronoun-only actions may continue the uniquely nearest named subject.
    const actionStart = preceding.lastIndexOf(c.evidence);
    const context = preceding.slice(Math.max(0, actionStart - 500), actionStart);
    const mentions = entries
      .map((e) => ({
        name: e.name,
        at: Math.max(...[e.name, ...characterAliases(e.name)].map((a) => context.lastIndexOf(a))),
      }))
      .filter((m) => m.at >= 0)
      .sort((a, b) => b.at - a.at);
    const mentioned =
      explicitSubject ||
      (/她|其|自己|\bshe\b|\bher\b/i.test(c.evidence) &&
        mentions[0]?.name === c.name &&
        (!mentions[1] || mentions[0].at > mentions[1].at));
    let reason = '';
    if (!entries.some((e) => e.name === c.name) && !aliases.some((name) => preceding.includes(name)))
      reason = '无法确认该服装记录对应的人物';
    else if (
      c.operation !== 'init' &&
      (!c.evidence || !preceding.includes(c.evidence) || !mentioned || !ACTION.test(c.evidence))
    )
      reason = '变化缺少可定位到该人物的原文动作证据';
    else if (c.operation === 'init' && old) reason = '已有穿搭，不能重新初始化';
    else if (c.operation === 'init' && c.evidence && (!preceding.includes(c.evidence) || !mentioned))
      reason = '初始服装引用的剧情证据无效';
    else if (c.operation === 'change' && old && !REPLACE.test(c.evidence))
      reason = '没有明确换装/重新穿戴证据，不能整套重置';
    else if (
      c.operation === 'patch' &&
      (!old || c.pieces.some((p) => !old.pieces.some((o) => o.id === p.id)))
    )
      reason = '局部变化指向未知衣物部件';
    else if (
      c.operation !== 'patch' &&
      c.pieces.some((p) => !p.design || /\b(?:hair|eyes|face|skin|breasts|1girl|1boy)\b/i.test(p.design))
    )
      reason = '服装设计为空或混入人物外貌';
    else if (c.operation === 'add' && (!old || c.pieces.some((p) => old.pieces.some((o) => o.id === p.id))))
      reason = '新增衣物需要已有穿搭且部件 ID 不能重复';
    if (reason) {
      rejected.push(`${c.name} ${c.position}: ${reason}`);
      continue;
    }
    if (c.operation === 'patch')
      for (const piece of c.pieces) {
        // Default values emitted by the model are not restoration events.
        const restore: Record<string, RegExp> = {
          fastening: /扣好|扣上|拉上|系好|系上|fasten|button.{0,12}up|zip.{0,12}up|clos/i,
          arrangement:
            /整理好|恢复原状|拉回|放下|穿好|穿回|pull.{0,12}back|lower.{0,12}(?:skirt|dress)|straighten|redress/i,
          location: /穿上|穿回|穿好|套上|披上|put.{0,12}on|redress/i,
          leftSleeve: /袖|穿好|穿回|重新穿|套上|sleeve|put.{0,12}on|redress/i,
          rightSleeve: /袖|穿好|穿回|重新穿|套上|sleeve|put.{0,12}on|redress/i,
          wetness: /擦干|晒干|烘干|干透|dry/i,
          damage: /缝|修|补好|修复|repair|mend/i,
        };
        for (const [key, expression] of Object.entries(restore)) {
          if (
            ['closed', 'normal', 'worn', 'on_arm', 'dry', 'intact'].includes(piece.state[key]) &&
            !expression.test(c.evidence)
          )
            delete piece.state[key];
        }
      }
    if (
      c.operation === 'patch' &&
      !c.pieces.some((p) => Object.values(p.state).some((v) => v !== 'unknown'))
    ) {
      rejected.push(c.name + ': 穿脱事件没有有效状态字段，请明确该衣物的穿着、位置或袖口变化');
      continue;
    }
    if (new Set(c.pieces.map((p) => p.id)).size !== c.pieces.length) {
      rejected.push(c.name + ': 多个部件被映射到同一衣物ID，请拆分或去重');
      continue;
    }
    result.push(c);
    applyOne(current, c, 'accepted');
  }
  return { changes: result, rejected };
}
function applyOne(state: ClothingState, c: ClothingChange, scope: string): void {
  const old = state.get(c.name);
  if (c.operation === 'patch') {
    for (const p of c.pieces) {
      const piece = old?.pieces.find((g) => g.id === p.id);
      if (piece)
        Object.assign(
          piece.state,
          Object.fromEntries(Object.entries(p.state).filter(([, value]) => value !== 'unknown')),
        );
    }
  } else if (c.operation === 'add' && old) {
    old.pieces.push(
      ...copy(c.pieces).map((p) => ({ ...p, evidence: c.evidence, state: { location: 'worn', ...p.state } })),
    );
  } else if (c.operation === 'change' || !old) {
    state.set(c.name, {
      name: c.name,
      outfitId: `outfit_${continuityHash(scope + c.name + c.position + JSON.stringify(c.pieces))}`,
      pieces: copy(c.pieces).map((p) => ({
        ...p,
        evidence: c.evidence,
        state: { location: 'worn', ...p.state },
      })),
      source: c.evidence || '首次视觉补全（非剧情事实）',
    });
  }
}
export function clothingAt(
  before: ClothingState,
  changes: ClothingChange[],
  scope: string,
  line = Infinity,
  offset = Infinity,
  timeline = 'main',
): ClothingState {
  const result = new Map(copy(timeline === 'main' ? [...before] : []).map(([k, v]) => [k, v]));
  for (const c of changes) if ((c.timeline || 'main') === timeline && reached(c, line, offset)) applyOne(result, c, scope + timeline);
  return result;
}
export function clothingBlock(state: ClothingState): string {
  return (
    '【服装现状：唯一账本】没有变化就逐字段继承；仅初次未知可以 init，不能根据图片 tag 重新记账。\n' +
    JSON.stringify([...state.values()])
  );
}
export function clothingTrace(message: STMessage | undefined, rawTag: string): string[] {
  const floor = readClothingFloor(message),
    frame = findClothingFrame(floor, rawTag);
  if (!floor || !frame) return [];
  const cast = parseImageTagContent(rawTag).characters.map((c) => c.name);
  const eraLabels = { ancient: '古代', modern: '现代', future: '未来', mixed: '混合时代', unknown: '未确定' };
  const cultureLabels = {
    chinese: '中国古风/仙侠',
    japanese: '日式',
    western: '西式',
    other: '其他文化',
    unknown: '文化未确定',
  };
  const labels: Record<string, string> = {
    location: '位置',
    fastening: '扣合',
    arrangement: '整理',
    leftSleeve: '左袖',
    rightSleeve: '右袖',
    damage: '破损',
    wetness: '干湿',
    worn: '穿着',
    removed: '已脱下',
    held: '拿在手中',
    floor: '在地上',
    chair: '在椅上',
    unknown: '未确定',
    open: '敞开',
    closed: '扣好',
    loose: '松开',
    normal: '正常',
    lifted: '掀起',
    pulled_aside: '拨到一侧',
    lowered: '褪下',
    around_waist: '退至腰间',
    around_ankles: '退至脚踝',
    on_arm: '袖子穿好',
    off_arm: '袖子脱离手臂',
    rolled_up: '挽起',
    torn: '破损',
    intact: '完整',
    wet: '湿',
    dry: '干',
  };
  return [
    '本图按原文位置独立记录衣物状态，不使用楼层末态',
    ...floor.changes
      .filter((c) => (c.timeline || 'main') === (frame.scene?.timeline || 'main') && cast.includes(c.name) && reached(c, frame.sourceLine, frame.charOffset))
      .map((c) => `本图前已发生：${c.name} · ${c.evidence || '首次穿搭补全'}`),
    ...(frame.costume
      ? [
          `服饰背景：${eraLabels[frame.costume.era]} / ${cultureLabels[frame.costume.culture]} · ${frame.costume.evidence || '沿用前文'}`,
        ]
      : []),
    ...frame.entries
      .filter((e) => cast.includes(e.name))
      .map(
        (e) =>
          `${e.name} · ${e.pieces
            .map(
              (p) =>
                `${p.design || p.id} [${Object.entries(p.state)
                  .map(([k, v]) => `${labels[k] || k}=${labels[v] || v}`)
                  .join(', ')}]`,
            )
            .join('；')}`,
      ),
    ...floor.rejected.map((r) => `状态处理：${r}`),
  ];
}
/** One-time compatibility completion only when the LLM omitted a first outfit.
 * Once recorded, later image prompts can never replace it. */
export function initialiseClothingFromImage(image: ImageInsertion, state: ClothingState): void {
  for (const c of image.characters) {
    if (state.has(c.name)) continue;
    const parts = extractGarment(c.tag)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const wear = readWear(c.tag);
    if (!parts.length && wear.wear === 'worn') continue;
    state.set(c.name, legacyRecord(c.name, parts.join(', '), wear.wear, wear.state));
  }
}
export function savedImageClothing(image: ImageInsertion, before: ClothingState): ClothingState {
  const state: ClothingState = new Map(copy([...before]));
  for (const c of image.characters) {
    const wear = readWear(c.tag),
      design = extractGarment(c.tag);
    if (design || wear.wear !== 'worn')
      state.set(c.name, legacyRecord(c.name, design, wear.wear, wear.state));
  }
  return state;
}
const CLOTHING_WORD =
  /\b(?:dress|shirt|skirt|pants|trousers|shorts|jeans|jacket|blazer|coat|suit|bra|panties|underwear|lingerie|stockings|thighhighs|pantyhose|tights|socks|shoes|boots|heels|uniform|serafuku|hanfu|kimono|robe|collar|sleeves?|clothes|clothing|outfit|sash|belt|ribbon|cloak|cape|gloves|swimsuit|bikini|apron|corset|hoodie|sweater|cardigan|blouse|tunic|ruqun|hakama|yukata|obi|geta|miko|qipao|cheongsam|necktie|bow tie|sneakers|loafers|baseball cap|dudou|chest wrap|underpants|undergarment)\b/i;
const WEAR_WORD = /\b(?:nude|naked|topless|bottomless|fully clothed|off shoulder|breasts out|undressed)\b/i;
const CLOTHING_ACTION = /\b(?:holding|grabbing|pulling|lifting|tugging|unbuttoning|taking off|removing)\b/i;
export function isClothingDescription(value: string): boolean {
  return (CLOTHING_WORD.test(value) || WEAR_WORD.test(value)) && !CLOTHING_ACTION.test(value);
}
export function clothingCaption(record: ClothingRecord): { tag: string; nl: string } {
  const tags: string[] = [],
    sentences: string[] = [];
  let upperRemoved = false,
    lowerRemoved = false,
    upperWorn = false,
    lowerWorn = false;
  for (const p of record.pieces) {
    const s = p.state,
      location = s.location;
    const both = /\b(?:dress|robe|uniform|jumpsuit|bodysuit|no clothes)\b/i.test(p.design);
    const upper =
      both ||
      /\b(?:shirt|blouse|bra|jacket|blazer|coat|sweater|top|camisole|corset|tunic|dudou|chest wrap)\b/i.test(
        p.design,
      );
    const lower =
      both || /\b(?:skirt|pants|trousers|shorts|jeans|panties|underwear|underpants)\b/i.test(p.design);
    if (['removed', 'floor', 'chair', 'held'].includes(location)) {
      upperRemoved ||=
        both || /\b(?:shirt|blouse|bra|sweater|top|camisole|corset|tunic|dudou|chest wrap)\b/i.test(p.design);
      lowerRemoved ||= lower;
      if (p.id === 'legacy') {
        if (s.legacy) tags.push(s.legacy);
        continue;
      }
      const garment = /\b(?:shirt|blouse)\b/i.test(p.design)
        ? 'shirt'
        : /\bbra\b/i.test(p.design)
          ? 'bra'
          : /\bpanties\b/i.test(p.design)
            ? 'panties'
            : /\b(?:pants|trousers)\b/i.test(p.design)
              ? 'pants'
              : /\bskirt\b/i.test(p.design)
                ? 'skirt'
                : /\bdress\b/i.test(p.design)
                  ? 'dress'
                  : '';
      if (
        garment &&
        !record.pieces.some(
          (other) =>
            other.id !== p.id &&
            other.state.location === 'worn' &&
            new RegExp('\\b' + garment + '\\b', 'i').test(other.design),
        )
      )
        tags.push('no ' + garment);
      if (location === 'removed') sentences.push(`Not wearing ${p.design}; it has been taken off.`);
      if (location !== 'removed')
        sentences.push(
          `The ${p.design} is ${location === 'held' ? 'held, not worn' : `on the ${location}, not worn`}.`,
        );
      continue;
    }
    upperWorn ||= upper;
    lowerWorn ||= lower;
    tags.push(p.design);
    if (s.legacy) tags.push(s.legacy);
    if (s.fastening === 'open')
      tags.push(
        /shirt|blouse/i.test(p.design)
          ? 'open shirt'
          : /jacket|blazer/i.test(p.design)
            ? 'open jacket'
            : /coat/i.test(p.design)
              ? 'open coat'
              : 'open clothes',
      );
    if (s.fastening === 'loose') tags.push('loose clothes');
    if (s.leftSleeve === 'off_arm' || s.rightSleeve === 'off_arm') tags.push('off shoulder');
    if (s.leftSleeve === 'rolled_up' || s.rightSleeve === 'rolled_up') tags.push('sleeves rolled up');
    if (s.damage === 'torn') tags.push('torn clothes');
    if (s.wetness === 'wet') tags.push('wet clothes');
    const arrangements: Record<string, string> = {
      lifted: /skirt/i.test(p.design)
        ? 'skirt lift'
        : /dress/i.test(p.design)
          ? 'dress lift'
          : /shirt|blouse/i.test(p.design)
            ? 'shirt lift'
            : 'clothes lifted',
      pulled_aside: /panties/i.test(p.design) ? 'panties aside' : 'clothes pulled aside',
      lowered: /panties/i.test(p.design)
        ? 'panties down'
        : /pants|trousers/i.test(p.design)
          ? 'pants down'
          : 'clothes down',
      around_waist: 'clothes around waist',
      around_ankles: 'clothes around ankles',
    };
    if (arrangements[s.arrangement]) tags.push(arrangements[s.arrangement]);
    const detail = [
      s.fastening === 'open' ? 'unfastened' : s.fastening === 'closed' ? 'fastened' : '',
      arrangements[s.arrangement],
      s.leftSleeve === 'off_arm' ? 'left sleeve off the arm' : '',
      s.rightSleeve === 'off_arm' ? 'right sleeve off the arm' : '',
      s.legacy,
    ]
      .filter(Boolean)
      .join(', ');
    if (p.design) sentences.push(`Wearing ${p.design}${detail ? `, ${detail}` : ''}.`);
  }
  if (upperRemoved && !upperWorn && lowerRemoved && !lowerWorn) tags.push('nude');
  else {
    if (upperRemoved && !upperWorn) tags.push('topless');
    if (lowerRemoved && !lowerWorn) tags.push('bottomless');
  }
  return { tag: [...new Set(tags.filter(Boolean))].join(', '), nl: sentences.join(' ') };
}
const LOCKED_WEAR_STATE =
  /\b(?:unbuttoned|unzipped|unfastened|undressing|disrobing|stripping|no panties|no bra|panties aside|pants down|skirt lift|breasts out|clothes down|clothes aside|clothes off|dress lift|shirt lift|slipped off|slipped down|taking off|removing clothes|lifting (?:dress|skirt|shirt)|pulling (?:dress|skirt|shirt|pants|panties))\b/i;
export function enforceClothing(
  image: ImageInsertion,
  state: ClothingState,
  nl: boolean,
  independent: boolean,
): void {
  let managed = 0;
  for (const c of image.characters) {
    const record = state.get(c.name);
    if (!record) continue;
    managed++;
    const caption = clothingCaption(record);
    const dynamic = c.tag
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !isClothingDescription(t) && !LOCKED_WEAR_STATE.test(t));
    c.tag = [
      ...new Set([
        ...dynamic,
        ...caption.tag
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ]),
    ].join(', ');
    if (nl)
      c.nl = [
        c.nl
          .split(/(?<=[.!?])\s+/)
          .filter((s) => !CLOTHING_WORD.test(s) && !WEAR_WORD.test(s))
          .join(' '),
        caption.nl,
      ]
        .filter(Boolean)
        .join(' ');
  }
  if (managed && independent) {
    image.tag = image.tag
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !isClothingDescription(t) && !LOCKED_WEAR_STATE.test(t))
      .join(', ');
    if (nl)
      image.nl = image.nl
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !CLOTHING_WORD.test(s) && !WEAR_WORD.test(s))
        .join(' ');
  } else if (managed && image.characters.length === 1) {
    image.tag = [
      ...new Set([
        ...image.tag
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t && !isClothingDescription(t) && !LOCKED_WEAR_STATE.test(t)),
        ...image.characters[0].tag.split(',').map((t) => t.trim()),
      ]),
    ].join(', ');
    if (nl) image.nl = image.characters[0].nl;
  }
}
