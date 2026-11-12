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
operation=patch：只改已有衣物状态，design 留空，必须引用原文动作，证据需包含角色名（代词动作连同此前姓名一起引用）。
operation=add：剧情明确加穿一件衣物，只新增部件，不能重置其他衣服。
operation=change：只有明确换装/穿回等事件才整套替换，不能因为时间/场景跳跃、特写或没提衣服就 change；明确换装时 pieces 必须给出完整的新衣物 design（每个部件一条），只报 patch 会让画面继续沿用旧账本。
正文出现洗澡、沐浴、泡温泉、做爱等情节时，即使没有逐件写脱衣，也必须按情节如实报告相应状态：洗澡通常全部脱去，做爱至少内裤脱去、裙子掀起或下装褪下。漏报时程序会按场景补录，但仍以你的准确报告为准。
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
): ClothingFloor | null {
  const raw = message?.extra?.[BBI_OUTFIT_EXTRA_KEY] as ClothingFloor | undefined;
  return raw?.v === 2 &&
    Array.isArray(raw.entries) &&
    Array.isArray(raw.changes) &&
    Array.isArray(raw.frames) &&
    raw.swipe === (message?.swipe_id ?? 0) &&
    raw.sourceHash === narrativeHash(message?.mes ?? '') &&
    (upstreamHash === undefined || raw.upstreamHash === upstreamHash)
    ? copy(raw)
    : null;
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
  let hash = '';
  for (let floor = 0; floor < Math.min(beforeFloor, chat.length); floor++) {
    const message = chat[floor],
      raw = message.extra?.[BBI_OUTFIT_EXTRA_KEY] as { v?: number } | undefined;
    const saved = readClothingFloor(message, hash);
    if (saved) {
      if (!saved.delta) state.clear();
      for (const entry of saved.entries) state.set(entry.name, entry);
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
    hash = continuityHash(hash + contribution(message));
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
        const quoteOf = (value: string) => [...value].map(canonical).join('');
        const findQuote = (value: string): Array<{ start: number; end: number }> => {
          const quote = quoteOf(value);
          const hits: Array<{ start: number; end: number }> = [];
          if (quote)
            for (let i = compact.indexOf(quote); i >= 0; i = compact.indexOf(quote, i + 1))
              hits.push({ start: offsets[i], end: offsets[i + quote.length - 1] + 1 });
          return hits;
        };
        let matches = findQuote(evidence);
        if (!matches.length) {
          // 模型常把动作句前后多抄/漏抄一点；退回按分句定位，仍然只接受原文里真实存在的动作。
          const clauses = evidence
            .split(/[，,。.！!？?；;：:\n]+/)
            .map((clause) => clause.trim())
            .filter((clause) => clause.length >= 4);
          const seen = new Set<number>();
          matches = [];
          for (const clause of clauses)
            for (const hit of findQuote(clause))
              if (!seen.has(hit.start)) {
                seen.add(hit.start);
                matches.push(hit);
              }
        }
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
export function acceptClothingChanges(
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
        else {
          // 模型经常给同一件衣服换个说法（black blouse / white shirt），按衣物类别唯一匹配兜底。
          const kind = garmentKind(piece.design);
          const sameKind = kind ? old.pieces.filter((p) => garmentKind(p.design) === kind) : [];
          if (sameKind.length === 1) piece.id = sameKind[0].id;
        }
      }
    if (old?.suitMode === 'always' && c.operation !== 'patch') {
      rejected.push(c.name + ': 用户固定套装不接受整套换装（要跟随剧情请在衣柜面板改为“锁定款式”）；穿脱状态仍会记录');
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
      } else if (
        /穿着|身穿|身着|是一条|是那件|wearing|dressed in/i.test(c.evidence) &&
        !/(?:换上|换成|换好|换装|更衣|穿上|穿回|脱下|脱掉|褪下)/.test(c.evidence)
      ) {
        // 「她穿着一条短牛仔裤」是外观描述，不是换装事件；照收会让账本款式被悄悄改写。
        rejected.push(c.name + ': 这段只是外观描述，不是换装动作，不能整套重置');
        continue;
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
    else if (
      c.operation === 'change' &&
      /穿着|身穿|身着|是一条|是那件|wearing|dressed in/i.test(c.evidence) &&
      !/(?:换上|换成|换好|换装|更衣|穿上|穿回|脱下|脱掉|褪下)/.test(c.evidence)
    )
      // 「她穿着一条短牛仔裤」是外观描述，不是换装事件；照收会让账本款式被悄悄改写。
      reason = '这段只是外观描述，不是换装动作，不能整套重置';
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
    if (c.operation === 'patch')
      for (const piece of c.pieces) {
        // 模型给了 unknown 但原文写了动作时，从动作句推断该部件状态，避免整条事件被丢弃。
        if (Object.values(piece.state).every((v) => v === 'unknown' || !v))
          Object.assign(
            piece.state,
            inferClothingState(c.evidence, old?.pieces.find((p) => p.id === piece.id), piece.id),
          );
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
): ClothingState {
  const result = new Map(copy([...before]).map(([k, v]) => [k, v]));
  for (const c of changes) if (reached(c, line, offset)) applyOne(result, c, scope);
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
    frame = floor?.frames.find((f) => f.tag === rawTag);
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
      .filter((c) => cast.includes(c.name) && reached(c, frame.sourceLine, frame.charOffset))
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
          `${e.name} · ${e.outfitId} · ${e.pieces
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
/** 中文剧情里的常见衣物词 → 英文服装 tag。只用于「首次建档」，永不覆盖已有账本。 */
const PROSE_GARMENT: Array<[RegExp, string]> = [
  [/短牛仔裤|牛仔短裤/, 'denim shorts'],
  [/长牛仔裤|直筒牛仔裤/, 'long jeans'],
  [/牛仔裤/, 'jeans'],
  [/百褶裙|短裙/, 'miniskirt'],
  [/连衣裙/, 'dress'],
  [/长裙|半身裙|裙子|裙/, 'skirt'],
  [/长裤|西裤|休闲裤|运动裤/, 'pants'],
  [/短裤/, 'shorts'],
  [/白衬衫|衬衫/, 'shirt'],
  [/t恤|T恤|短袖/, 't-shirt'],
  [/吊带|背心/, 'camisole'],
  [/卫衣/, 'hoodie'],
  [/毛衣|针织衫/, 'sweater'],
  [/风衣|大衣|外套|夹克/, 'jacket'],
  [/文胸|胸罩|内衣/, 'bra'],
  [/内裤|底裤/, 'panties'],
  [/连裤袜|丝袜/, 'pantyhose'],
  [/高跟鞋/, 'high heels'],
  [/运动鞋|帆布鞋/, 'sneakers'],
  [/长靴|靴子/, 'boots'],
];
const PROSE_COLOR: Array<[RegExp, string]> = [
  [/白/, 'white'],
  [/黑/, 'black'],
  [/红/, 'red'],
  [/蓝/, 'blue'],
  [/绿/, 'green'],
  [/黄/, 'yellow'],
  [/粉/, 'pink'],
  [/紫/, 'purple'],
  [/灰/, 'grey'],
  [/米|卡其/, 'beige'],
];
/** 从一句中文里认出衣物（含紧邻的颜色）；认不出返回 ''。 */
export function proseGarment(sentence: string): string {
  if (!sentence) return '';
  for (const [expression, design] of PROSE_GARMENT) {
    const match = expression.exec(sentence);
    if (!match) continue;
    const before = sentence.slice(Math.max(0, match.index - 4), match.index);
    const color = PROSE_COLOR.find(([expr]) => expr.test(before))?.[1] ?? '';
    return [color, design].filter(Boolean).join(' ');
  }
  return '';
}
/** 只认点名到本人的穿搭句，避免把别人的衣服算到她头上，也跳过脱衣/否定语境。 */
function storyGarmentNear(source: string, name: string, line: number, offset: number): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const preceding = [...lines.slice(0, line), (lines[line] ?? '').slice(0, offset || undefined)].join('\n');
  const sentences = preceding.split(/(?<=[。！？!?\n])/).filter((sentence) => sentence.includes(name));
  for (const sentence of [...sentences].reverse().slice(0, 6)) {
    if (/没穿|未穿|不穿|没有穿|脱下|脱掉|褪下|换下/.test(sentence)) continue;
    if (!/穿着|身穿|身着|穿了|套着|披着|一身/.test(sentence)) continue;
    const design = proseGarment(sentence);
    if (design) return design;
  }
  return '';
}
/** One-time compatibility completion only when the LLM omitted a first outfit.
 * Once recorded, later image prompts can never replace it. */
export function initialiseClothingFromImage(
  image: ImageInsertion,
  state: ClothingState,
  source = '',
): void {
  for (const c of image.characters) {
    if (state.has(c.name)) continue;
    const parts = extractGarment(c.tag)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const wear = readWear(c.tag);
    if (!parts.length && wear.wear === 'worn') continue;
    // 剧情写明了穿搭时以原文为准：模型偶尔把长裤画成短裤，账本不能跟着错下去。
    const storyDesign = source ? storyGarmentNear(source, c.name, image.sourceLine, image.charOffset ?? 0) : '';
    state.set(c.name, legacyRecord(c.name, storyDesign || parts.join(', '), wear.wear, wear.state));
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
/** 衣物类别。用于部件 ID 兜底匹配、场景推断与换装采纳。 */
const GARMENT_KINDS: Array<[RegExp, string]> = [
  [/\b(?:panties|underwear|underpants|briefs|thong|panty)\b/i, 'panties'],
  [/\b(?:bra|lingerie|bikini top)\b/i, 'bra'],
  [/\b(?:shirt|blouse|camisole|sweater|t-shirt|tank top)\b/i, 'shirt'],
  [/\bskirt\b/i, 'skirt'],
  [/\b(?:pants|trousers|jeans|shorts|leggings)\b/i, 'pants'],
  [/\b(?:dress|robe|kimono|qipao|gown|jumpsuit)\b/i, 'dress'],
  [/\b(?:jacket|blazer|coat|cloak|cape|cardigan)\b/i, 'jacket'],
  [/\b(?:socks|stockings|thighhighs|pantyhose|tights)\b/i, 'socks'],
  [/\b(?:shoes|boots|heels|slippers|sneakers)\b/i, 'shoes'],
];
export function garmentKind(design: string): string {
  const value = String(design ?? '');
  for (const [expression, kind] of GARMENT_KINDS) if (expression.test(value)) return kind;
  return '';
}
/**
 * 模型只给 unknown 时，从动作原文推断该部件状态。
 * 只在原文有明确动作词时推断，猜不到就返回空对象让上层隔离事件。
 */
export function inferClothingState(
  evidence: string,
  piece: ClothingPiece | undefined,
  fallbackId = '',
): Record<string, string> {
  const kind = garmentKind(piece?.design ?? fallbackId);
  const state: Record<string, string> = {};
  if (!evidence) return state;
  const off = /脱下|脱掉|脱去|褪下|褪去|扒下|扯下|滑落|掉落|脱光|剥下|溜下|蹬掉/.test(evidence);
  const on = /穿上|穿回|穿好|套上|披上|系上|扣好|拉上|裹上/.test(evidence);
  const lifted = /掀起|撩起|撩开|掀开|掀到|撩到|翻起/.test(evidence);
  const aside = /拨到一侧|拨到一边|拨开|扒开|拉到一边|拉到一侧|扯到一侧/.test(evidence);
  const around = /(?:褪|滑|退|拉|落)到.{0,4}(?:膝|腿|踝|脚|地)/.test(evidence);
  const open = /解开|敞开|松开|拉开|崩开|扯开|解下/.test(evidence);
  const loose = /松脱|松垮|半脱|摇摇欲坠/.test(evidence);
  const torn = /撕破|扯破|撕开|裂开|破开|撕烂/.test(evidence);
  const wet = /湿透|打湿|淋湿|浸湿|泡进|泡在|水中|水里|浴缸|温泉/.test(evidence);
  if (off) state.location = 'removed';
  if (on) state.location = 'worn';
  if (lifted) state.arrangement = 'lifted';
  if (aside) state.arrangement = 'pulled_aside';
  if (around) state.arrangement = /踝|脚|地/.test(evidence) ? 'around_ankles' : 'lowered';
  if (open) state.fastening = 'open';
  if (loose && !open && !off) state.fastening = 'loose';
  if (torn) state.damage = 'torn';
  if (wet) state.wetness = 'wet';
  // 裙子/连衣裙被掀起来时，即便同句有“褪”也按掀起处理。
  if ((kind === 'skirt' || kind === 'dress') && (lifted || aside) && !on) delete state.location;
  return state;
}
interface StoryWindow {
  start: number;
  end: number;
  text: string;
}
const STORY_STOP = /[。！？!?…\n；;]/;
/** 取 index 所在的整句，前后各扩 window 个字符用于找主语。 */
function sentenceWindow(text: string, index: number, window = 60): StoryWindow {
  let start = Math.max(0, index - window);
  for (let i = index - 1; i >= Math.max(0, index - window * 2); i--)
    if (STORY_STOP.test(text[i])) {
      start = i + 1;
      break;
    }
  let end = Math.min(text.length, index + window);
  for (let i = index; i < Math.min(text.length, index + window * 2); i++)
    if (STORY_STOP.test(text[i])) {
      end = i + 1;
      break;
    }
  return { start, end, text: text.slice(start, end) };
}
function storyPosition(text: string, index: number): { line: number; offset: number } {
  const prefix = text.slice(0, index).split('\n');
  return { line: prefix.length - 1, offset: prefix[prefix.length - 1].length };
}
function absoluteOffset(text: string, line: number, offset: number): number {
  const lines = text.split('\n');
  return lines.slice(0, line).reduce((n, part) => n + part.length + 1, 0) + offset;
}
function nearestNamedEntry(text: string, index: number, entries: CharTagEntry[]): string {
  let best = '';
  let bestAt = -1;
  for (const entry of entries)
    for (const name of [entry.name, ...characterAliases(entry.name)]) {
      if (!name) continue;
      const before = text.lastIndexOf(name, index);
      if (before > bestAt) {
        bestAt = before;
        best = entry.name;
      }
      const after = text.indexOf(name, index);
      if (before < 0 && after >= 0 && after - index <= 24 && bestAt < 0) best = entry.name;
    }
  return bestAt >= 0 ? best : '';
}
const BATH_SCENE = /洗澡|沐浴|泡澡|泡温泉|淋浴|冲凉|入浴|浴缸|浴池|温泉|泡进|浸(?:在|入).{0,6}(?:水|浴)/;
const NUDE_SCENE = /赤身裸体|一丝不挂|全裸|赤裸.{0,4}(?:身|躯)|脱得精光|未着寸缕|衣服全脱|浑身赤裸/;
/** 只有真正发生关系/裸露身体的词才算亲密情节；亲吻、隔着衣服的抚摸不算。 */
const SEX_SCENE =
  /做爱|性交|交合|交欢|歡好|欢好|云雨|翻云覆雨|床事|承欢|交媾|插入|抽插|内射|口交|乳交|骑乘|跨坐/;
/** 明确的裸露/脱光表述。 */
const NAKED_STATE =
  /赤裸|裸体|全裸|一丝不挂|未着寸缕|赤身|脱光(?:了)?(?:衣服|衣物|全身)|衣服全脱|光着(?:身子|身体)/;
/** 明确的脱衣动作：动词 + 衣物词必须在同一句里紧邻出现。 */
const UNDRESS_ACTION =
  /(?:脱|褪|扒|扯|剥|解|拉|掀|撩)[^，。！？；]{0,12}(?:衣|裤|裙|袜|罩|背心|吊带|内衣|内裤|外套|上衣|衬衫)/;
const BARE_UPPER = /(?:上身|胸口|乳房|胸部|奶子)[^，。！？；]{0,6}(?:赤裸|裸露|暴露|露出|光着)/;
const BARE_LOWER = /(?:下身|私处|腿间|屁股)[^，。！？；]{0,6}(?:赤裸|裸露|暴露|露出|光着)/;
/** 明确「没脱」的写法：这类情节一律不碰账本，宁可少脱也不错脱。 */
const OVER_CLOTHES =
  /(?:隔着(?:衣服|衣料|布料|衣物|内衣|内裤|裤子|裙子|胸罩|睡衣)|未脱|没脱|没有脱|不脱|衣着完整|衣服还在|穿着衣服)/;
const PIECE_PROSE: Record<string, RegExp> = {
  panties: /内裤|底裤|丁字裤/,
  bra: /胸罩|文胸|内衣|奶罩/,
  skirt: /裙/,
  dress: /裙|旗袍|礼服|汉服|和服/,
  pants: /牛仔|(?<!内)裤/,
  shirt: /衬衫|上衣|t恤|T恤|背心|吊带|毛衣|卫衣/,
  jacket: /外套|夹克|大衣|西装|风衣/,
  socks: /袜/,
  shoes: /鞋/,
};
function pieceMentioned(kind: string, text: string): boolean {
  const expression = PIECE_PROSE[kind];
  if (!expression) return false;
  // 按分句判断：「褪下内裤，裙子仍然穿着」里内裤被点名、裙子被明确保留。
  return text.split(/[，。；！？,;]/).some((clause) => {
    if (!expression.test(clause)) return false;
    return !/(?:仍然|还|依旧|依然)?(?:穿着|穿在|没脱|未脱|还在身上)/.test(clause);
  });
}
/**
 * 剧情场景推断：洗澡/全裸/亲密情节即使没逐件写脱衣，也按常识补一份穿脱状态。
 * 生成的 change 会作为本楼账本事件持久化，只影响事件位置之后的图片。
 */
export function synthesiseSceneClothing(
  source: string,
  entries: CharTagEntry[],
  before: ClothingState,
  accepted: ClothingChange[] = [],
): { changes: ClothingChange[]; notes: string[] } {
  const changes: ClothingChange[] = [];
  const notes: string[] = [];
  const text = source.replace(/\r\n?/g, '\n');
  if (!text || !before.size) return { changes, notes };
  const scenes: Array<{ expression: RegExp; mode: 'bath' | 'nude' | 'sex'; label: string }> = [
    { expression: BATH_SCENE, mode: 'bath', label: '洗澡 / 入水' },
    { expression: NUDE_SCENE, mode: 'nude', label: '全裸' },
    { expression: SEX_SCENE, mode: 'sex', label: '亲密情节' },
  ];
  const handled = new Set<string>();
  for (const scene of scenes) {
    for (const match of text.matchAll(new RegExp(scene.expression.source, 'g'))) {
      const index = match.index ?? 0;
      const name = nearestNamedEntry(text, index, entries);
      const record = name ? before.get(name) : undefined;
      if (!record) continue;
      if (record.suitMode === 'always') {
        notes.push(`${name}: 固定套装已锁定款式，${scene.label}未改动服装`);
        continue;
      }
      const key = `${name}|${scene.mode}`;
      if (handled.has(key)) continue;
      const storyIndex = storyPosition(text, index);
      const alreadyReported = accepted.some((c) => {
        if (c.name !== name || c.operation === 'init') return false;
        const at = storyPosition(text, Math.min(text.length, absoluteOffset(text, c.sourceLine, c.charOffset)));
        return Math.abs(at.line - storyIndex.line) <= 1;
      });
      if (alreadyReported) {
        handled.add(key);
        continue;
      }
      const window = sentenceWindow(text, index, 80);
      const evidence = window.text.trim();
      const pieces: ClothingPiece[] = [];
      if (scene.mode === 'sex') {
        // 严格按剧情：没写脱衣/裸露就不动账本；写了「隔着衣服」更是明确不脱。
        if (OVER_CLOTHES.test(evidence)) {
          notes.push(`${name}: 亲密情节但原文写着隔着衣物/没有脱，服装账本保持原样`);
          handled.add(key);
          continue;
        }
        const naked = NAKED_STATE.test(evidence);
        const undress = UNDRESS_ACTION.test(evidence);
        const bareUpper = BARE_UPPER.test(evidence);
        const bareLower = BARE_LOWER.test(evidence);
        if (!naked && !undress && !bareUpper && !bareLower) {
          // 亲吻、隔着衣服的抚摸、单纯的爱抚描写：不推断任何脱衣。
          handled.add(key);
          continue;
        }
        for (const piece of record.pieces) {
          const location = piece.state.location;
          if (location && location !== 'worn' && location !== 'unknown') continue;
          const kind = garmentKind(piece.design);
          const mentioned = pieceMentioned(kind, evidence);
          const upper = kind === 'shirt' || kind === 'bra' || kind === 'jacket' || kind === 'dress';
          const lower = kind === 'pants' || kind === 'skirt' || kind === 'panties' || kind === 'dress';
          if (naked || (undress && mentioned) || (bareUpper && upper) || (bareLower && lower)) {
            pieces.push({ id: piece.id, design: '', state: { location: 'removed' } });
          } else if (mentioned && /掀起|撩起|掀开|撩开/.test(evidence) && (kind === 'skirt' || kind === 'dress')) {
            pieces.push({ id: piece.id, design: '', state: { arrangement: 'lifted' } });
          }
        }
      } else {
        if (scene.mode === 'bath' && /穿着(?:泳衣|泳装|比基尼|浴衣|睡衣)/.test(evidence)) {
          notes.push(`${name}: 洗澡情节里原文写着穿着衣物，未按全脱处理`);
          handled.add(key);
          continue;
        }
        for (const piece of record.pieces) {
          const location = piece.state.location;
          if (location && location !== 'worn' && location !== 'unknown') continue;
          pieces.push({
            id: piece.id,
            design: '',
            state: {
              location: scene.mode === 'bath' ? 'floor' : 'removed',
              ...(scene.mode === 'bath' ? { wetness: 'wet' } : {}),
            },
          });
        }
      }
      if (!pieces.length) {
        handled.add(key);
        continue;
      }
      const at = storyPosition(text, index);
      changes.push({
        name,
        reportedName: name,
        position: '',
        sourceLine: at.line,
        charOffset: at.offset,
        operation: 'patch',
        evidence,
        pieces,
      });
      handled.add(key);
      notes.push(`按场景推断（${scene.label}）：${name} ${pieces.map((p) => p.id).join('、')}`);
    }
  }
  return { changes, notes };
}
const CHANGE_SCENE = /换上|换成|换好|换了一|换上一|换了一身|换身|新衣|更衣|换装/;
const MAIN_GARMENTS = new Set(['shirt', 'skirt', 'pants', 'dress']);
/**
 * 剧情明确换装、但模型只写了 patch（或压根没报）时，采纳图片里模型给的新衣物，
 * 避免「剧情换了衣服，画面还是旧账本那套」。
 */
export function adoptChangedClothing(
  image: ImageInsertion,
  before: ClothingState,
  source: string,
): { changes: ClothingChange[]; notes: string[] } {
  const changes: ClothingChange[] = [];
  const notes: string[] = [];
  const text = source.replace(/\r\n?/g, '\n');
  if (!text) return { changes, notes };
  const prefix = text.split('\n').slice(0, image.sourceLine).reduce((n, line) => n + line.length + 1, 0);
  const index = Math.max(0, Math.min(text.length, prefix + (image.charOffset ?? 0)));
  for (const character of image.characters) {
    const record = before.get(character.name);
    if (!record) continue;
    if (record.suitMode === 'always') {
      notes.push(`${character.name}: 固定套装已锁定款式，剧情换装未生效`);
      continue;
    }
    const design = extractGarment(character.tag);
    if (!design) continue;
    const ledgerKinds = new Set(record.pieces.map((piece) => garmentKind(piece.design)).filter(Boolean));
    const modelKinds = [...new Set(design.split(/[,，]/).map((part) => garmentKind(part.trim())).filter(Boolean))];
    const novel = modelKinds.filter((kind) => !ledgerKinds.has(kind) && MAIN_GARMENTS.has(kind));
    if (!novel.length) continue;
    const window = sentenceWindow(text, index, 120);
    if (!CHANGE_SCENE.test(window.text)) continue;
    if (!window.text.includes(character.name) && !/她/.test(window.text)) continue;
    const at = storyPosition(text, index);
    changes.push({
      name: character.name,
      reportedName: character.name,
      position: '',
      sourceLine: at.line,
      charOffset: at.offset,
      operation: 'change',
      evidence: window.text.trim(),
      pieces: design
        .split(/[,，]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map((part, order) => ({ id: `adopt_${order + 1}`, design: part, state: { location: 'worn' } })),
    });
    notes.push(`${character.name}: 剧情明确换装，已按图片外观接管新衣物（${novel.join('、')}）`);
  }
  return { changes, notes };
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


