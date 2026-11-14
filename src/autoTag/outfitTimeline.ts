import { characterAliases } from '@/state/characterAliases';
import { appearancePolicy } from '@/state/appearancePolicy';
import { applyWardrobeChoices, wardrobeChoiceRevision } from '@/state/wardrobeChoice';
import type { CostumeContext, CostumeFloor } from './costumeContext';
import type { TargetSegment } from './clean';
import type { ImageInsertion } from './protocol';
import { extractGarment, readOutfitState, readWear, BBI_OUTFIT_EXTRA_KEY } from './outfitState';
import { candidateAliasesForEntry, resolveCanonicalCharName } from './charReuse';
import { isCollarToken, isPropToken, storyMentionsCollar, storyMentionsProp } from './props';
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
state 可用 location=worn/removed/held/floor/chair/unknown；fastening=closed/open/loose/unknown；arrangement=normal/lifted/pulled_aside/lowered/around_waist/around_ankles/unknown；exposure=covered/partial/bare/unknown；leftSleeve/rightSleeve=on_arm/off_arm/rolled_up/unknown；damage=intact/torn/unknown；wetness=dry/wet/unknown。
exposure 专指「衣服还穿在身上，但原本挡住的身体露出来了」，与脱掉是两件事：衣领被扒开露出整个乳房、内裤被拨开露出私处、衣襟敞着露出一片胸，都是 location 仍为 worn + exposure=bare；只露了一部分（乳沟、半边胸）用 partial。这类情节旧版记成 removed，画面会比正文脱得更多。
只列变化字段，未列的字段必须继承。掀裙不是脱掉整套，解衬衫扣子不是重新选衣服；恢复也要有明确整理/穿好证据。
例如上一楼 blouse 的 fastening=open，本楼仅聊天，不输出任何恢复事件，画面仍沿用敞开状态。
人物库 changes 的永久外貌变更必须额外给 evidence（逐字原文且包含角色名），不得因补绘、光照或你自己的猜测修改档案。手动指定同人角色的档案不允许 AI 修改。
服装不得写到人物库 changes.outfit/extra；当前穿搭只由 outfitChanges 管理。各图 tag/nl 与各自正文位置的状态一致。
道具不是服装：刀、剑、枪、手铐、绳、锁链、托盘、杯子、伞这些跟着动作走的东西不要放进 outfitChanges，也不要写进人物 tag 的衣着位置（写了会变成永久挂件）。只有 choker、项链、耳环、腕饰、发饰这类真饰品属于服装。别再因为「被用手按住/被控制」就加 collar 或 handcuffs——正文没写颈部饰品或上铐，就不写。
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
  /**
   * 衣物还在身上、但挡住了的部位已经露出来了。
   *
   * 以前只有 location/arrangement，「衣领被扒开、整个胸部露出来」既不是脱掉
   * (location 仍是 worn)也不是 arrangement 里任何一格，于是账本没变化 →
   * enforceClothing 把模型写对的 breasts out 剥掉 → 图里穿得好好的。
   * 这是与「脱光」并列的第四种形态，必须单独一根轴。
   */
  exposure: ['covered', 'partial', 'bare', 'unknown'],
};
const ACTION =
  /换|穿|脱|褪|披|套|扣|解|系|敞|掀|撩|拨|拉|放|拿|卷|撕|破|扯|整理|恢复|洗|澡|泡|淋|浴|浸|搓|冲|擦|wear|dress|chang|put|tak|remov|unfasten|fasten|open|clos|lift|pull|lower|roll|tear|torn|wet/i;
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
/**
 * 把一串衣物描述拆成可按件操作的部件。
 *
 * 「white shirt, long jeans」存成单个部件时有个死结：模型报「褪下牛仔裤」只会给
 * `id: jeans`，而账本里只有 `legacy`，`patch` 一定被「指向未知衣物部件」拒掉，
 * 裤子永远脱不下来。按衣物类别拆开才能一件一件改状态。
 */
function splitPieces(design: string, wear: string, state: string): ClothingPiece[] {
  const parts = String(design ?? '')
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const base = { location: wear === 'off' ? 'removed' : 'unknown', ...(state ? { legacy: state } : {}) };
  if (parts.length <= 1) return [{ id: garmentKind(design) || 'legacy', design, state: { ...base } }];
  const used = new Map<string, number>();
  return parts.map((part) => {
    const kind = garmentKind(part) || 'piece';
    const seen = (used.get(kind) ?? 0) + 1;
    used.set(kind, seen);
    return { id: seen === 1 ? kind : `${kind}_${seen}`, design: part, state: { ...base } };
  });
}
function legacyRecord(name: string, design: string, wear: string, state: string): ClothingRecord {
  // Preserve legacy uncertainty; never turn a crop or omitted state into 'fully dressed'.
  return {
    name,
    outfitId: `legacy_${continuityHash(name + design)}`,
    source: '旧版记录（部件未确认）',
    pieces: splitPieces(design, wear, state),
  };
}
export function clothingBefore(
  chat: STMessage[],
  beforeFloor: number,
  entries: CharTagEntry[],
): ClothingState {
  const state: ClothingState = new Map();
  // 档案里写了「固定着装」就等于 mvu-helper 的 [Clothes] 默认段:它是这个人的基准套装,
  // 剧情不能随手把它换掉,但正文明确写了换装就该换——所以是 style(锁款式),不是 always
  // (always 会拒掉整套换装,正好又回到「剧情换了衣服、画面还是那一套」)。
  // 只有字段为空的人才是「首次未知、可合理决定一次」。
  // 点图固定形象写进的是 appearancePolicy 而不是档案字段,这里也要认，否则
  // 账本压根没有她这一行，注入段与 enforceClothing 都落空。
  for (const e of entries) {
    const pinned = (e.fields.outfit || appearancePolicy(e.name)?.fields.outfit || '').trim();
    if (pinned)
      state.set(e.name, {
        ...legacyRecord(e.name, pinned, 'worn', ''),
        suitMode: 'style',
        manual:
          e.source === 'manual' &&
          (!e.history.some((h) => h.field === 'outfit') ||
            [...e.history].reverse().find((h) => h.field === 'outfit')?.floor === -1),
      });
  }
  let hash = '';
  for (let floor = 0; floor < Math.min(beforeFloor, chat.length); floor++) {
    const message = chat[floor],
      raw = message.extra?.[BBI_OUTFIT_EXTRA_KEY] as { v?: number } | undefined;
    const saved = readClothingFloor(message, hash);
    if (saved) {
      if (!saved.delta) state.clear();
      for (const entry of saved.entries) state.set(entry.name, entry);
    } else if (raw?.v === 2) {
      /**
       * hash 链断掉时不能把这一层的账本整段丢掉。
       *
       * `readClothingFloor` 会校验 upstreamHash（前面所有楼的累积哈希）。只要前面任何一层
       * 被重新分析、或在它前面插入/删掉一楼，链就断了，这一层返回 null。旧代码在 `raw.v === 2`
       * 时既不进 saved 分支、也不进 legacy 分支，于是这一层的 entries 被**静默忽略**，
       * 整个账本变空——下一楼因此推断不出洗澡/脱衣（实测第 49→50 楼、44→45 楼都是这个）。
       * 这里退回「只信本层自己写下的 entries」，宁可少一层继承，也不丢已有记录。
       */
      for (const entry of (raw as Partial<ClothingFloor>).entries ?? [])
        if (entry?.name) state.set(entry.name, entry as unknown as ClothingRecord);
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
    applyWardrobeChoices(state, message, saved?.manualChoiceRevision, entries);
    // 脱下来的衣服不能永久保持「脱掉」。账本里的 removed 是从头累积的，
    // 只要剧情不再提，隔一两楼就该当人已经穿回去了——否则前一天脱光，
    // 后面几十楼全是光着出场。
    settleStaleUndress(state, message.mes ?? '');
    hash = continuityHash(hash + contribution(message));
  }
  return state;
}
/**
 * 楼层推进时收拾「陈旧脱衣」。
 *
 * 规则只有三条，方向都是「变回穿着」：
 * 1. 这一楼还在写她裸着/正在脱 → 保持原样；
 * 2. 这一楼出现了这件衣物本身 → 认为在讲它，保持原样；
 * 3. 都不满足就记一次「闲置」，连续两楼闲置即穿回；场景翻篇（第二天/出门）立刻穿回。
 *
 * 裸露（exposure=bare，衣服还在身上但挡住了的部位露着）同样会陈旧：一次前戏之后
 * 女主不该带着「乳头露在外面」走过后面几十楼，所以和 removed 一样按同一套计数收回去，
 * 只是收回时是把 exposure 复位成 covered，不动 location。
 */
export function settleStaleUndress(state: ClothingState, text: string): void {
  if (!state.size) return;
  const clothingHere = NAKED_STATE.test(text) || UNDRESS_ACTION.test(text) || BARE_UPPER.test(text) || BARE_LOWER.test(text);
  const sceneReset = SCENE_RESET.test(text) && !UNDRESS_MARK.test(text);
  for (const record of state.values()) {
    if (record.suitMode === 'always') continue;
    for (const piece of record.pieces) {
      const location = piece.state.location;
      const stripped = ['removed', 'floor', 'chair', 'held'].includes(location ?? '');
      const exposed = !stripped && piece.state.exposure === 'bare';
      if (!stripped && !exposed) continue;
      const kind = garmentKind(piece.design);
      const mentioned = piece.design ? text.includes(piece.design.trim()) || pieceMentioned(kind, text) : false;
      // 本楼正在穿脱/袒露，就别自作主张把人穿回去——哪怕这件衣服没被点名。
      if (clothingHere) {
        piece.state.stale = '0';
        continue;
      }
      if (mentioned && !sceneReset) {
        piece.state.stale = '0';
        continue;
      }
      const stale = Number(piece.state.stale ?? '0') + 1;
      if (sceneReset || stale >= 2) {
        if (stripped) {
          piece.state.location = 'worn';
          piece.state.fastening = 'closed';
          piece.state.arrangement = 'normal';
        }
        delete piece.state.exposure;
        piece.state.stale = '0';
      } else {
        piece.state.stale = String(stale);
      }
    }
  }
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
  // 主名以外，正文常常只写简称/称谓（「晚晴」「林小姐」）。只按主名找主语时，
  // 「晚晴褪下内裤」会被判成没人认领，于是这条待核对提示根本不出现。
  const calls = (name: string) => {
    const entry = entries.find((e) => e.name === name);
    return [name, ...characterAliases(name), ...(entry ? candidateAliasesForEntry(entry) : [])].filter(Boolean);
  };
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
      .map((name) => ({ name, at: Math.max(...calls(name).map((a) => context.lastIndexOf(a))) }))
      .filter((m) => m.at >= 0)
      .sort((a, b) => b.at - a.at);
    const actor = mentions[0]?.name;
    const local = context.slice(-24);
    if (
      !/她[^。！？“”「」『』]{0,8}$/.test(local) &&
      !calls(actor || '').some((name) => local.includes(name))
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
        if (old.pieces.some((p) => p.id === piece.id)) continue;
        // 模型写的是它自己起的名（`jeans`、`white shirt`），得先归到账本里已有的部件上，
        // 否则下面一律判「指向未知衣物部件」，穿脱永远记不上。
        const matches = piece.design
          ? old.pieces.filter((p) => p.design.trim().toLowerCase() === piece.design.trim().toLowerCase())
          : [];
        if (matches.length === 1) {
          piece.id = matches[0].id;
          continue;
        }
        // 换说法（black blouse / white shirt）或只给部件名时，按衣物类别唯一匹配兜底。
        const kind = garmentKind(piece.design || piece.id);
        if (!kind) continue;
        const sameKind = old.pieces.filter((p) => garmentKind(p.design) === kind);
        if (sameKind.length === 1) piece.id = sameKind[0].id;
      }
    if (old?.suitMode === 'always' && c.operation !== 'patch') {
      rejected.push(c.name + ': 用户固定套装不接受整套换装（要跟随剧情请在衣柜面板改为“锁定款式”）；穿脱状态仍会记录');
      continue;
    }
    // 这一条 change 是否带来了旧账本里没有的衣物类别（换泳衣、换睡衣都算）。
    // 「她拉开塑料帘走出来，身上只剩一件白色泳衣」一个换装动词都没有，
    // 但它确实是整身换。旧版三道 change 闸门全部只认「换上/换装/更衣」，
    // 于是换泳装整条被拒 → 账本停在白天的衬衫长裙 → 用户看到的就是「泳装换不出来」。
    const fresh =
      !!old &&
      c.pieces.some((p) => !old.pieces.some((o) => garmentKind(o.design) === garmentKind(p.design)));
    const dressing = /穿上|套上|披上|扣好|扣上|拉上|裹上|系上|拿出|取出/.test(c.evidence);
    const wearingNow = /只剩|只穿|只留|仅剩|只有|穿着|身穿|身着|裹着|披着/.test(c.evidence);
    const freshDress = fresh && (dressing || wearingNow);
    if (
      old?.suitMode === 'style' &&
      c.operation === 'change' &&
      !freshDress &&
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
      // 「拉开抽屉拿出一件白衬衫和一条黑长裙，穿上内衣，把衬衫扣好」——
      // 这句一个「换上/换装」都没有，但确实是把新衣服穿上了身（隔夜换衣几乎都这么写）。
      // 旧版只看 换上|更衣|换装，于是这种写法被判「非明确换装」整条丢弃，
      // 账本停在睡衣上，第二天图里她还是睡衣。只要出现穿戴动词且点名了旧账本没有的
      // 衣物类别，就允许整套重记。
      if (freshDress) {
        // 新衣物确实是新穿的：保留 change，旧部件由 applyOne 一并退出账本。
      } else if (mapped.length && mapped.every(Boolean)) {
        c.operation = 'patch';
        c.pieces = mapped as ClothingPiece[];
      } else if (
        /穿着|身穿|身着|是一条|是那件|wearing|dressed in/i.test(c.evidence) &&
        !/(?:换上|换成|换好|换装|更衣|穿上|穿回|脱下|脱掉|褪下)/.test(c.evidence)
      ) {
        /**
         * 「她穿着一条长牛仔裤」不是换装事件，但它**就是**这句剧情的事实。
         *
         * 旧版一律拒掉，理由是「照收会让账本款式被悄悄改写」——结果账本只要曾经错过一次
         * (首次建档时模型把长裤画成短裤)，后面每句外观描写都被拒，只能一路错到底，
         * 正文写明了也没用。这里改成「只换同类部件的款式、不动其它部件的穿脱状态」：
         * 既不会把半脱的人重新穿好，也能让账本跟上原文。
         */
        const restated = c.pieces.flatMap((p) => {
          const kind = garmentKind(p.design);
          if (!kind) return [];
          const same = old.pieces.filter((o) => garmentKind(o.design) === kind);
          return same.length === 1 ? [{ id: same[0].id, design: p.design, state: { location: 'worn' } }] : [];
        });
        if (restated.length) {
          c.operation = 'patch';
          c.pieces = restated;
        } else {
          rejected.push(c.name + ': 这段只是外观描述，不是换装动作，不能整套重置');
          continue;
        }
      } else {
        rejected.push(c.name + ': 非明确换装不能整套重置，请用已有部件 patch 或新增衣物 add');
        continue;
      }
    }
    const flat = source.replace(/\r\n?/g, '\n');
    const line = flat.split('\n');
    const preceding = [
      ...line.slice(0, c.sourceLine),
      (line[c.sourceLine] ?? '').slice(0, c.charOffset || undefined),
    ].join('\n');
    /**
     * 证据句前后各一小段都要看。
     *
     * 主语常常写在动作句之后（「"我先去洗个澡。"林晚晴站起来」），`subjectEvidence` 就是这句，
     * 而 `preceding` 只到 charOffset 为止、且 charOffset 常常落在主语名字中间
     * （证据句与主语句紧邻时尤其如此），`preceding.includes(subjectQuote)` 于是恒为 false，
     * 明明已经认出主语还是被判「缺少可定位到该人物的原文动作证据」。取前后各 240 字即可。
     */
    const absolute =
      line.slice(0, c.sourceLine).reduce((total, text) => total + text.length + 1, 0) + (c.charOffset || 0);
    const near = flat.slice(Math.max(0, absolute - 240), Math.min(flat.length, absolute + 240));
    const aliases = [...new Set([c.name, c.reportedName || '', ...characterAliases(c.name)])].filter(Boolean);
    const subjectQuote = c.subjectEvidence || '';
    // 引号/顿号这类行首符号不参与定位：证据句常以「"…」开头，而 charOffset 恰好停在全角引号之后，
    // 直接 includes 会差一个字符，明明认得主语还是被判无主。
    const subjectText = subjectQuote.replace(/^[\s「『“"'（(，,、]+/, '');
    const explicitSubject =
      aliases.some((name) => c.evidence.includes(name)) ||
      (!!subjectText &&
        (preceding.includes(subjectText) || near.includes(subjectText)) &&
        aliases.some((name) => subjectText.includes(name)));
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
      !/(?:换上|换成|换好|换装|更衣|穿上|穿回|脱下|脱掉|褪下)/.test(c.evidence) &&
      !freshDress
    )
      // 「她穿着一条短牛仔裤」是外观描述，不是换装事件；照收会让账本款式被悄悄改写。
      // 例外：这句带来了账本里没有的衣物类别（「身上只剩一件白色泳衣」），
      // 那就不是复述旧款，而是整身换——不认这句，泳装、浴衣这类一次性穿搭永远进不了账本。
      reason = '这段只是外观描述，不是换装动作，不能整套重置';
    else if (c.operation === 'change' && old && !REPLACE.test(c.evidence) && !freshDress)
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
        // 例外：这一件的款式被改写了（外观描述通道），说明它此刻确实穿在身上，
        // 默认的 location=worn 就是新款式的事实，不能当成复述删掉。
        const restyled = !!old?.pieces.find((o) => o.id === piece.id && o.design !== piece.design);
        const restore: Record<string, RegExp> = {
          fastening: /扣好|扣上|拉上|系好|系上|fasten|button.{0,12}up|zip.{0,12}up|clos/i,
          arrangement:
            /整理好|恢复原状|拉回|放下|穿好|穿回|pull.{0,12}back|lower.{0,12}(?:skirt|dress)|straighten|redress/i,
          location: /穿上|穿回|穿好|套上|披上|put.{0,12}on|redress/i,
          leftSleeve: /袖|穿好|穿回|重新穿|套上|sleeve|put.{0,12}on|redress/i,
          rightSleeve: /袖|穿好|穿回|重新穿|套上|sleeve|put.{0,12}on|redress/i,
          wetness: /擦干|晒干|烘干|干透|dry/i,
          damage: /缝|修|补好|修复|repair|mend/i,
          exposure: /遮好|盖回|掩好|拉好|整理好|恢复原状|穿好|穿回|放回|cover|pull.{0,12}back|redress/i,
        };
        for (const [key, expression] of Object.entries(restore)) {
          if (
            ['closed', 'normal', 'worn', 'on_arm', 'dry', 'intact'].includes(piece.state[key]) &&
            !expression.test(c.evidence) &&
            !(restyled && key === 'location')
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
      if (!piece) continue;
      // patch 带 design 时才换款式（同一个槽位换了一件同类的衣服）；
      // 空的 design 仍表示「只改状态、款式沿用」，老行为不变。
      if (p.design && p.design.trim()) piece.design = p.design.trim();
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
const SUIT_MODE_NOTE: Record<string, string> = {
  always: '用户固定整套（不改因剧情换装；穿脱状态仍记）',
  style: '款式锁定（只允许明确换装；穿脱与半脱照记）',
};

/**
 * 账本渲染成人能读的清单。
 *
 * 以前是 `JSON.stringify([...state.values()])`：模型要在 JSON 里自己找「谁·穿了什么·什么状态」，
 * 一旦角色多、部件多就整串被它当背景噪音跳过，于是改成逐人一行、部件用账本 caption 的 tag 口径
 * （与 enforceClothing 实际写进提示词的串同源）。JSON 兜底保留未识别的部件字段。
 */
export function clothingBlock(state: ClothingState): string {
  const lines = [
    '【服装现状：唯一账本】没有变化就逐字段继承；仅初次未知可以 init，不能根据图片 tag 重新记账。',
    '每行是「人物：当前穿着（部件状态）」；穿脱状态词照抄，别自己改款式。',
  ];
  for (const record of state.values()) {
    const wearing: string[] = [];
    const off: string[] = [];
    for (const piece of record.pieces) {
      const design = (piece.design ?? '').trim();
      const location = piece.state?.location ?? '';
      if (location === 'removed' || location === 'floor' || location === 'chair' || location === 'held')
        off.push(`${design || '未知衣物'}[${piece.id}]`);
      else if (design) {
        const marks = [
          piece.state?.fastening && piece.state.fastening !== 'closed' ? piece.state.fastening : '',
          piece.state?.arrangement && piece.state.arrangement !== 'normal' ? piece.state.arrangement : '',
          piece.state?.damage && piece.state.damage !== 'intact' ? piece.state.damage : '',
          piece.state?.wetness && piece.state.wetness !== 'dry' ? piece.state.wetness : '',
        ].filter(Boolean);
        wearing.push(marks.length ? `${design}（${marks.join('/')}）` : design);
      }
    }
    const note = record.suitMode ? `｜${SUIT_MODE_NOTE[record.suitMode]}` : '';
    lines.push(
      `- ${record.name}：${wearing.length ? wearing.join('、') : '（没穿任何记下的部件）'}` +
        (off.length ? `；已脱下：${off.join('、')}` : '') +
        note,
    );
  }
  if (!state.size) lines.push('- （账本为空：本楼首次出现，可按正文与候选决定一次，之后固定）');
  return lines.join('\n');
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
  // 睡衣类必须排在「裙」「裤」前面:睡裙会被 skirt 抢走、睡裤会被 pants 抢走,
  // 结果「换上睡衣」这句认不出衣物 → adoptChangedClothing 直接 return,
  // 账本停在白天那套 —— 用户看到的「剧情说换了睡衣,图里还是原来那套」。
  [/睡裙|睡袍|浴袍|睡衣裤|睡裤|睡衣|家居服|居家服|晨衣/, 'pajamas'],
  // 泳装必须排在「裙」「短裤」前面：`泳装`/`泳衣` 本身不含裙裤字，但
  // 「沙滩裙」「泳裤」会被后两条抢走，而且在正文里 `泳装` 常与「裙」同句出现。
  [/连体泳衣|竞泳泳装|泳衣|泳装|泳裤|比基尼|死库水|沙滩裙/, 'swimsuit'],
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
/**
 * 从一句中文里认出**所有**衣物（含紧邻的颜色）；认不出返回 []。
 *
 * 旧版只返回第一件，于是「拿出一件干净的白色衬衫和一条黑色长裙」只记下裙子，
 * 账本里她始终没有衬衫 —— 换装看起来只换了一半。这里按词表优先级逐条认领，
 * 已被前面（更具体）词条占用的区间不再重复命中，所以「睡裙」不会被「裙」抢走、
 * 「连衣裙」不会被记成两件。
 */
export function proseGarments(sentence: string): string[] {
  if (!sentence) return [];
  const claimed: Array<[number, number]> = [];
  const found: Array<[number, string]> = [];
  for (const [expression, design] of PROSE_GARMENT) {
    for (const match of sentence.matchAll(new RegExp(expression.source, 'g'))) {
      const index = match.index ?? 0;
      const end = index + match[0].length;
      if (claimed.some(([a, b]) => index < b && end > a)) continue;
      claimed.push([index, end]);
      const before = sentence.slice(Math.max(0, index - 4), index);
      const color = PROSE_COLOR.find(([expr]) => expr.test(before))?.[1] ?? '';
      found.push([index, [color, design].filter(Boolean).join(' ')]);
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, design]) => design);
}

/** 从一句中文里认出衣物（含紧邻的颜色）；认不出返回 ''。 */
export function proseGarment(sentence: string): string {
  return proseGarments(sentence)[0] ?? '';
}
/** 只认点名到本人的穿搭句，避免把别人的衣服算到她头上，也跳过脱衣/否定语境。 */
function storyGarmentNear(source: string, names: string[], line: number, offset: number): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const preceding = [...lines.slice(0, line), (lines[line] ?? '').slice(0, offset || undefined)].join('\n');
  const sentences = preceding
    .split(/(?<=[。！？!?\n])/)
    .filter((sentence) => names.some((name) => name && sentence.includes(name)));
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
  entries: CharTagEntry[] = [],
): void {
  for (const c of image.characters) {
    // 账本按档案主名记。模型写「晚晴」而库里是「林晚晴」时，原来 state.has('晚晴')
    // 判不中，于是同一个人的账本被拆成两条，越记越多。
    const name = entries.length ? resolveCanonicalCharName(c.name, entries) : c.name;
    if (state.has(name)) continue;
    const entry = entries.find((e) => e.name === name);
    const parts = extractGarment(c.tag)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const wear = readWear(c.tag);
    if (!parts.length && wear.wear === 'worn') continue;
    // 剧情写明了穿搭时以原文为准：模型偶尔把长裤画成短裤，账本不能跟着错下去。
    const storyDesign = source
      ? storyGarmentNear(
          source,
          // 正文里点名她的方式不一定是主名（「晚晴」「林小姐」都算），否则原文优先形同虚设
          [name, c.name, ...characterAliases(name), ...(entry ? candidateAliasesForEntry(entry) : [])],
          image.sourceLine,
          image.charOffset ?? 0,
        )
      : '';
    // 首次出场时模型常在 tag 里顺手写 nude/topless，可正文压根没说脱。
    // 正文这一句附近没有任何裸露/脱衣证据时，把模型写的「脱掉」降级成穿着，
    // 让「衣服是哪件」由模型决定、而「穿没穿」由剧情决定。
    const window = source
      ? sentenceWindow(source, absoluteOffset(source, image.sourceLine, image.charOffset ?? 0), 80).text
      : '';
    const backedByStory =
      !window ||
      NAKED_STATE.test(window) ||
      UNDRESS_ACTION.test(window) ||
      BARE_UPPER.test(window) ||
      BARE_LOWER.test(window) ||
      OVER_CLOTHES.test(window);
    const wearLevel = wear.wear !== 'worn' && !backedByStory && storyDesign ? 'worn' : wear.wear;
    state.set(name, legacyRecord(name, storyDesign || parts.join(', '), wearLevel, wear.state));
  }
}
export function savedImageClothing(
  image: ImageInsertion,
  before: ClothingState,
  entries: CharTagEntry[] = [],
): ClothingState {
  const state: ClothingState = new Map(copy([...before]));
  for (const c of image.characters) {
    const name = entries.length ? resolveCanonicalCharName(c.name, entries) : c.name;
    const wear = readWear(c.tag),
      design = extractGarment(c.tag);
    if (design || wear.wear !== 'worn') state.set(name, legacyRecord(name, design, wear.wear, wear.state));
  }
  return state;
}
const CLOTHING_WORD =
  /\b(?:dress|shirt|skirt|pants|trousers|shorts|jeans|jacket|blazer|coat|suit|bra|panties|underwear|lingerie|stockings|thighhighs|pantyhose|tights|socks|shoes|boots|heels|uniform|serafuku|hanfu|kimono|robe|collar|sleeves?|clothes|clothing|outfit|sash|belt|cloak|cape|gloves|swimsuit|bikini|apron|corset|hoodie|sweater|cardigan|blouse|tunic|ruqun|hakama|yukata|obi|geta|miko|qipao|cheongsam|necktie|bow tie|sneakers|loafers|baseball cap|dudou|chest wrap|underpants|undergarment|pajamas|pyjamas|nightgown|nightdress|nightwear|negligee|bathrobe|sleepwear)\b/i;
/** 戴在头上、脸上、脖子或腕上的饰物：归 appearance 的 extra，服装层不许把它当衣服剥掉。 */
const BODY_ORNAMENT =
  /\b(?:hair ribbon|hair band|hairband|hairpin|hair clip|hair ornament|ribbon|\b(?:neck|choker|circlet|tiara|ankle|wrist) ?(?:lace|band|ribbon|chain|let|cuffs?)\b|glasses|mask|earrings?|earring|piercing|necklace|pendant|choker|bracelet|bangle|anklet|ring|beret|headband|veil|crown)/i;
const WEAR_WORD = /\b(?:nude|naked|topless|bottomless|fully clothed|off shoulder|breasts out|undressed)\b/i;
const CLOTHING_ACTION = /\b(?:holding|grabbing|pulling|lifting|tugging|unbuttoning|taking off|removing)\b/i;
export function isClothingDescription(value: string): boolean {
  // `hair ribbon` 命中 CLOTHING_WORD 里的 ribbon，但账本里没有它——早年就是这么被服装层
  // 剥掉的：档案 extra 写了发带，出图 prompt 里却没有。饰物归 appearance，服装层不碰。
  if (BODY_ORNAMENT.test(value)) return false;
  return (CLOTHING_WORD.test(value) || WEAR_WORD.test(value)) && !CLOTHING_ACTION.test(value);
}
export function clothingCaption(record: ClothingRecord): { tag: string; nl: string } {
  const tags: string[] = [],
    sentences: string[] = [];
  let upperRemoved = false,
    lowerRemoved = false,
    upperWorn = false,
    lowerWorn = false,
    upperBare = false,
    lowerBare = false;
  for (const p of record.pieces) {
    const s = p.state,
      location = s.location;
    const kind = garmentKind(p.design);
    const cover = covers(kind);
    const both = cover.both,
      upper = cover.upper,
      lower = cover.lower;
    if (['removed', 'floor', 'chair', 'held'].includes(location)) {
      upperRemoved ||= upper;
      lowerRemoved ||= lower;
      if (p.id === 'legacy') {
        if (s.legacy) tags.push(s.legacy);
        continue;
      }
      const garment = REMOVED_TAG[kind] ?? '';
      if (
        garment &&
        !record.pieces.some(
          (other) =>
            other.id !== p.id &&
            other.state.location === 'worn' &&
            garmentKind(other.design) === kind,
        )
      )
        tags.push('no ' + garment);
      if (location === 'removed') sentences.push(`Not wearing ${englishDesign(p.design)}; it has been taken off.`);
      if (location !== 'removed')
        sentences.push(
          `The ${p.design} is ${location === 'held' ? 'held, not worn' : `on the ${location}, not worn`}.`,
        );
      continue;
    }
    upperWorn ||= upper;
    lowerWorn ||= lower;
    if (s.exposure === 'bare') {
      upperBare ||= upper;
      lowerBare ||= lower;
    }
    tags.push(englishDesign(p.design));
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
    // 衣物还在身上、但挡住了的部位已经露出来：这部分必须单独渲染。
    // 以前它既不是 removed(位置仍是 worn)也没有 arrangement 可挂，账本渲染成空 →
    // enforceClothing 把模型写的 breasts out 剥掉再不放回，图里就还是穿得整整齐齐。
    if (s.exposure === 'bare') {
      if (lower) tags.push('pussy');
      if (upper) tags.push('breasts out');
    } else if (s.exposure === 'partial') {
      if (upper) tags.push('cleavage');
      if (lower && !upper) tags.push('pussy');
    }
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
      s.exposure === 'bare' ? 'pulled clear of the covered skin' : s.exposure === 'partial' ? 'pulled partly aside' : '',
      s.leftSleeve === 'off_arm' ? 'left sleeve off the arm' : '',
      s.rightSleeve === 'off_arm' ? 'right sleeve off the arm' : '',
      s.legacy,
    ]
      .filter(Boolean)
      .join(', ');
    if (p.design) sentences.push(`Wearing ${englishDesign(p.design)}${detail ? `, ${detail}` : ''}.`);
  }
  if (upperRemoved && !upperWorn && lowerRemoved && !lowerWorn) tags.push('nude');
  else {
    if (upperRemoved && !upperWorn) tags.push('topless');
    if (lowerRemoved && !lowerWorn) tags.push('bottomless');
  }
  return { tag: [...new Set(tags.filter(Boolean))].join(', '), nl: sentences.join(' ') };
}
/**
 * 衣物类别。用于部件 ID 兜底匹配、场景推断与换装采纳。
 *
 * 顺序有意义：上半身/下半身都能覆盖住整个人的连体衣物排在最前，否则
 * `cheongsam`、`qipao` 这类词会被后面的条子漏掉，账本渲染成空串，服装层整段失效。
 */
const CORE_SWIM_EN =
  /\b(?:swimsuits?|swimwear|beachwear|bikinis?|monokini|tankini|school swimsuit|one-piece swimsuit|competition swimsuit|wetsuit)\b/i;
const CORE_SWIM_ZH = /泳衣|泳装|泳裤|比基尼|死库水|连体泳衣|竞泳|沙滩装/;
const GARMENT_KINDS: Array<[RegExp, string]> = [
  // 睡衣排在最前:它同时盖住上半身和下半身,而且「睡裙」「睡裤」会被后面的
  // 「裙」「裤」条子抢走 —— 抢走之后就变成「换了一条裙子」而不是换睡衣,
  // 上装留在账本里,图里于是还是原来那套。
  [
    /\b(?:pajamas|pyjamas|nightgown|nightdress|nightwear|negligee|bathrobe|sleepwear|housewear)\b/i,
    'pajamas',
  ],
  [/睡衣|睡裙|睡袍|浴袍|睡裤|家居服|居家服|晨衣/, 'pajamas'],
  // 泳装必须排在 dress / bra 前面：英文面板习惯写 `one-piece swimsuit`（会被 dress 的
  // one-piece 抢走）、`bikini top`（会被 bra 抢走），中文写「泳装/泳衣/比基尼/死库水」。
  // 缺这一类的后果不是「少一个标签」——garmentKind 返回空串，部件 ID 就落到 `piece`/
  // `legacy`，patch 对不上 ID 会被 acceptClothingChanges 判「未知衣物部件」整条丢弃，
  // 账本停在上一套，enforceClothing 再拿旧账本覆盖模型 tag → 剧情换了泳装，图里还是原来那套。
  [CORE_SWIM_EN, 'swim'],
  [CORE_SWIM_ZH, 'swim'],
  // 制服类整身衣物：`maid outfit`/`nurse uniform` 这类词 dress 条子认不到，
  // 落到整身衣物里才能整套换、也才能算进 covers() 的上下半身。
  [/\b(?:maid outfit|maid uniform|nurse outfit|nurse uniform|cheerleader outfit|apron dress|sailor suit)\b/i, 'dress'],
  [/女仆装|护士服|啦啦队服|围裙装|学生装/, 'dress'],
  [/\bbralette\b/i, 'bra'],
  [/\bapron\b|围裙/, 'shirt'],
  [/瑜伽服|瑜伽裤|雪纺衫|吊带衫/, 'shirt'],
  [
    /\b(?:dress|sundress|frock|robe|kimono|yukata|qipao|cheongsam|hanfu|ruqun|ao dai|gown|jumpsuit|bodysuit|leotard|unitard|uniform|serafuku|sailor uniform|one-piece)\b/i,
    'dress',
  ],
  [
    // 中文款式也要认:正文写「白连衣」「连衣裙」「旗袍」时账本里就是中文 design,
    // 认不出来 → 脱了也渲染不出 `no dress`,画面照旧穿得整整齐齐。
    /连衣裙|连身裙|连衣|裙装|旗袍|汉服|和服|礼服|婚纱|长袍|道袍|僧袍|制服|水手服|紧身衣|连体衣|体操服/,
    'dress',
  ],
  [/\b(?:panties|underwear|underpants|briefs|thong|panty)\b/i, 'panties'],
  [/内裤|底裤|亵裤|丁字裤|三角裤|安全裤/, 'panties'],
  [/\b(?:bra|lingerie|bikini top|bandeau)\b/i, 'bra'],
  [/胸罩|文胸|奶罩|抹胸|内衣/, 'bra'],
  [
    /\b(?:shirt|blouse|camisole|sweater|sweatshirt|hoodie|t-shirt|tank top|crop top|turtleneck|corset|tunic|dudou|chest wrap)\b/i,
    'shirt',
  ],
  [
    /衬衫|衬衣|上衣|恤|T恤|背心|吊带|毛衣|卫衣|针织衫|开衫|罩衫|小褂|短褂|褂子|兜肚|肚兜|束胸/,
    'shirt',
  ],
  [/\b(?:mini|micro|pleated|pencil|a-line|wrap|tiered|long|short)?\s?skirts?\b/i, 'skirt'],
  [/(?<!连衣)(?<!连身)裙(?!装)/, 'skirt'],
  [/\b(?:pants|trousers|jeans|shorts|leggings|culottes|overalls|dungarees|joggers)\b/i, 'pants'],
  [/牛仔裤|长裤|短裤|裤子|裤装|西裤|休闲裤|打底裤|皮裤|热裤|工装裤|背带裤|瑜伽裤/, 'pants'],
  [/\b(?:jacket|blazer|coat|raincoat|trench ?coat|cloak|cape|cardigan|suit|tuxedo|waistcoat|vest)\b/i, 'jacket'],
  [/外套|夹克|大衣|西装|风衣|披风|斗篷|披肩|小袄|棉袄|坎肩|雨衣/, 'jacket'],
  [/\b(?:socks|stockings|thighhighs|pantyhose|tights|leg ?warmers)\b/i, 'socks'],
  [/丝袜|长袜|短袜|连裤袜|网袜|袜/, 'socks'],
  [/\b(?:shoes|boots|heels|slippers|sneakers|sandals|loafers)\b/i, 'shoes'],
  [/高跟鞋|皮鞋|靴|鞋/, 'shoes'],
];
export function garmentKind(design: string): string {
  const value = String(design ?? '');
  for (const [expression, kind] of GARMENT_KINDS) if (expression.test(value)) return kind;
  return '';
}
const DESIGN_EN: Record<string, string> = {
  pajamas: 'pajamas',
  dress: 'dress',
  swim: 'swimsuit',
  shirt: 'shirt',
  skirt: 'skirt',
  pants: 'pants',
  jacket: 'jacket',
  bra: 'bra',
  panties: 'panties',
  socks: 'socks',
  shoes: 'shoes',
};
/**
 * 中文款式翻成英文 tag：账本里的 design 常是正文原词（「白泳衣」），直接塞进 prompt
 * 等于没写（NAI 只认 danbooru 词）。
 *
 * 注意不能直接用 garmentKind：中文「长裙」「短裙」是半身裙，而 GARMENT_KINDS 里
 * `长裙|短裙` 归在 dress 之下（为的是让「连衣裙」不被 skirt 抢走），照搬会把
 * 「黑色长裙」写成 `black dress`，画面直接从半身裙变成连身裙。
 */
export function englishDesign(design: string): string {
  const value = String(design ?? '').trim();
  if (!value || !/[\u4e00-\u9fff]/.test(value)) return value;
  const half = /(?:长|短|百褶|半身|包臀|伞)裙|裙摆/.test(value) && !/连衣裙|连身裙|连体/.test(value);
  const kind = half ? 'skirt' : garmentKind(value);
  const base = DESIGN_EN[kind];
  if (!base) return value;
  const colour = PROSE_COLOR.find(([expr]) => expr.test(value))?.[1] ?? '';
  return [colour, base].filter(Boolean).join(' ');
}
/** 这些类别脱掉之后要翻成对应的 `no xxx`；其余衣物只能靠 `Not wearing …` 句子表达。 */
const REMOVED_TAG: Record<string, string> = {
  shirt: 'shirt',
  bra: 'bra',
  panties: 'panties',
  pants: 'pants',
  skirt: 'skirt',
  dress: 'dress',
  // swim 没有 `no swimsuit` 这种常用词，脱掉只能靠 nl 句子说；但类别本身必须存在，
  // 否则 covers() 不会把它算进上/下半身，脱光之后永远判不出 nude。
  swim: '',
};
/** 类别 → 上半身 / 下半身；连体衣物两边都算。 */
function covers(kind: string): { upper: boolean; lower: boolean; both: boolean } {
  // pajamas 是一整套(上衣＋睡裤/睡裙)，它必须同时算上、下两个半身：
  // 只算 a半身的话，脱睡衣时另一半身仍被记为「穿着」，clothingCaption 就永远
  // 走不到 nude/topless 那一支，画面停在「还穿着白天那套」。
  const both = kind === 'dress' || kind === 'pajamas' || kind === 'swim';
  return {
    both,
    upper: both || kind === 'shirt' || kind === 'bra' || kind === 'jacket',
    lower: both || kind === 'skirts' || kind === 'skirt' || kind === 'pants' || kind === 'panties',
  };
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
  // 衣物没脱、只把挡住的部分亮出来：这是 exposure 轴，不能记成 removed。
  const bare = /(?:露出|裸露|暴露|亮出|敞开|扒开|扯开|掀开)[^，。！？；]{0,8}(?:乳房|胸部|胸口|乳头|乳尖|私处|阴部|下体|秘处|屁股)|(?:乳房|胸部|胸口|乳头|乳尖|私处|阴部|下体|秘处|屁股)[^，。！？；]{0,6}(?:露出|裸露|暴露|亮出|敞开|光着|外露)/.test(
    evidence,
  );
  if (off) state.location = 'removed';
  if (on) state.location = 'worn';
  if (lifted) state.arrangement = 'lifted';
  // 「睡衣被推到胸口上方」：衣服还在身上，但胸前已经全露出来了。
  // 只记 arrangement 的话渲染只会多一句 clothes around ankles，画面照样穿着上衣，
  // 正文里最直观的那半裸就丢了。
  if (/(?:推到|推至|推上|掀到|掀至|掀上|撩到|撩上|拉到)[^，。！？；]{0,8}(?:胸口|胸前|胸上|胸口上方|脖颈|脖子|锁骨)/.test(evidence))
    state.exposure = 'bare';
  if (aside) state.arrangement = 'pulled_aside';
  if (around) state.arrangement = /踝|脚|地/.test(evidence) ? 'around_ankles' : 'lowered';
  if (open) state.fastening = 'open';
  if (loose && !open && !off) state.fastening = 'loose';
  if (torn) state.damage = 'torn';
  if (wet) state.wetness = 'wet';
  if (bare && !off && !on) state.exposure = 'bare';
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
  // 已存别名之外，还要认「正文里的简称/小名」（正文写「晚晴」而库名「林晚晴」）。
  // 只认已存别名时，场景推断会认为这一句里没有人名，于是整段补录都漏掉她。
  for (const entry of entries)
    for (const name of [entry.name, ...characterAliases(entry.name), ...candidateAliasesForEntry(entry)]) {
      if (!name) continue;
      const before = text.lastIndexOf(name, index);
      if (before > bestAt) {
        bestAt = before;
        best = entry.name;
      }
      const after = text.indexOf(name, index);
      // 关键词后面紧跟人名（「先洗个澡。」林晚晴站起来）也算这个人。
      // 旧版这里只写 best 不写 bestAt，函数末尾又按 bestAt >= 0 判定，
      // 于是这个分支永远被丢掉 —— 名字写在动作词之后的句子整段推断不出来。
      if (before < 0 && after >= 0 && after - index <= 24 && bestAt < 0) {
        bestAt = before;
        best = entry.name;
        return best;
      }
    }
  return bestAt >= 0 ? best : '';
}

/** 旧名保留：句子里「最先出现的名字」通常就是主语。 */
function firstNamedEntry(text: string, entries: CharTagEntry[]): string {
  let best = '';
  let bestAt = Infinity;
  for (const entry of entries)
    for (const name of [entry.name, ...characterAliases(entry.name), ...candidateAliasesForEntry(entry)]) {
      if (!name) continue;
      const at = text.indexOf(name);
      if (at >= 0 && at < bestAt) {
        bestAt = at;
        best = entry.name;
      }
    }
  return best;
}

/**
 * 这一句动作的主语是谁。
 *
 * 旧版一律用「句尾之前最近提到的名字」，于是「她…盖住苏晚的肩膀…她拉开抽屉拿出白衬衫」
 * 会把换装记到苏晚头上 —— 苏晚只是被盖了被子。顺序应该是：
 *   1. 本句里最先出现的名字（主语通常在前）；
 *   2. 没有名字就看前几句的句首主语（「林晚晴先醒，她…」）；
 *   3. 最后才退回「往前最近提到的名字」。
 */
function subjectOf(text: string, start: number, end: number, entries: CharTagEntry[]): string {
  const inside = firstNamedEntry(text.slice(start, Math.max(start, end)), entries);
  if (inside) return inside;
  const before = text.slice(Math.max(0, start - 400), start);
  const sentences = before
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse()
    .slice(0, 3);
  for (const sentence of sentences) {
    const head = sentence.replace(/^[\s「『“"'（(，,、]+/, '').slice(0, 24);
    const named = firstNamedEntry(head, entries);
    if (named) return named;
  }
  return nearestNamedEntry(text, start, entries);
}

/**
 * 主语出处的那一句原文。
 *
 * 为什么要带回去：`acceptClothingChanges` 校验「变化必须能定位到该人物」时，
 * 只写代词的句子（「她拉开抽屉…穿上衬衫」）本来靠「往前 500 字里最近提到的名字」判定，
 * 而最近提到的往往是别人（「盖住苏晚的肩膀」），整条换装就被判成无主丢弃。
 * 把真正的主语句一起交上去，校验就能按同一口径认人。
 */
function subjectQuoteOf(
  text: string,
  start: number,
  end: number,
  entries: CharTagEntry[],
  name: string,
): string {
  const inside = text.slice(start, Math.max(start, end));
  if (inside.includes(name)) {
    const window0 = sentenceWindow(text, start, Math.max(80, inside.length));
    return window0.text.trim();
  }
  const before = text.slice(Math.max(0, start - 400), start);
  const sentences = before
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse()
    .slice(0, 3);
  for (const sentence of sentences) {
    const head = sentence.replace(/^[\s「『“"'（(，,、]+/, '').slice(0, 24);
    if (firstNamedEntry(head, entries) === name) return sentence;
  }
  /**
   * 人名也可能写在这句之后（「"我先去洗个澡。"林晚晴站起来…」）。
   * `subjectOf` 的第三级（`nearestNamedEntry` 的 after 分支）认的就是这种写法，
   * 这里必须用同一口径往前找，否则主语判定成林晚晴、证据却给不出她的名字，
   * 整条洗澡推断仍被判「缺少可定位到该人物的原文动作证据」丢掉。
   */
  const after = text.slice(end, Math.min(text.length, end + 200));
  const next = after
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);
  for (const sentence of next) {
    const head = sentence.replace(/^[\s「『“"'（(，,、]+/, '').slice(0, 24);
    if (firstNamedEntry(head, entries) === name) return sentence;
  }
  return '';
}
// 词表要覆盖网文的实际写法：正文几乎不写「洗澡」，而是「洗个澡」「冲个澡」「进了浴室」
// 「站在花洒下」。旧表只有「洗澡/沐浴/泡澡…」，于是整章浴室戏一条事件都推断不出来，
// 账本停在白天那套 —— 用户报的「明明洗澡了图里还穿着」就是这个。
const BATH_SCENE =
  /洗澡|洗(?:了|个|完|过)?澡|冲(?:了|个|完)?澡|沐浴|泡澡|泡温泉|淋浴|冲凉|入浴|浴缸|浴池|温泉|泡进|浸(?:在|入).{0,6}(?:水|浴)|浴室|花洒|喷头|水声|水龙头|盥洗|皂泡|沐浴露|洗发水/;
const NUDE_SCENE = /赤身裸体|一丝不挂|全裸|赤裸.{0,4}(?:身|躯)|脱得精光|未着寸缕|衣服全脱|浑身赤裸/;
/** 只有真正发生关系/裸露身体的词才算亲密情节；亲吻、隔着衣服的抚摸不算。 */
const SEX_SCENE =
  /做爱|性交|交合|交欢|歡好|欢好|云雨|翻云覆雨|床事|承欢|交媾|插入|抽插|内射|口交|乳交|骑乘|跨坐/;
/**
 * 独自的情色场面:自慰/用道具。
 *
 * 为什么必须单独一类:这类场面**没有男主**,但画面同样是 NSFW、同样需要脱衣。
 * 旧版只有 SEX_SCENE(含「插入/抽插」),而真实正文写「按着震动棒…反复来回抽送」
 * 时一个都不命中 → 账本一条不记 → 图里她还是全套穿好。用户看到的「NSFW 剧情出 SFW 图」
 * 主要就是这一类被整段漏掉。
 */
const SOLO_SCENE =
  /自慰|自亵|自渎|手淫|抚慰自己|玩弄自己|抚弄自己|揉搓|揉弄|揉捏|拨弄|蹂躏|爱抚自己|摩擦(?:着)?(?:自己|腿间|下体)|夹紧(?:双腿|腿)|震动棒|跳蛋|按摩棒|假阳具/;
/** 明确的裸露/脱光表述。 */
const NAKED_STATE =
  /赤裸|裸体|全裸|一丝不挂|未着寸缕|赤身|脱光(?:了)?(?:衣服|衣物|全身)|衣服全脱|光着(?:身子|身体)/;
/** 明确的脱衣动作：动词 + 衣物词必须在同一句里紧邻出现。 */
const UNDRESS_ACTION =
  /(?:脱|褪|扒|扯|剥|解|拉|掀|撩)[^，。！？；]{0,12}(?:衣|裤|裙|袜|罩|背心|吊带|内衣|内裤|外套|上衣|衬衫)/;
/**
 * 「拿下来」类动作：衣服离开身体。
 *
 * 与 UNDRESS_ACTION 的区别是**它到底脱没脱**——「扒开内裤」里内裤还在身上（只是拨到一边），
 * 「褪下内裤」才是真脱下来。旧版把两者合并，扒开一律算脱，渲染成 no panties。
 */
const TAKEOFF_ACTION =
  /(?:脱下|脱掉|脱去|脱了|褪下|褪到|褪去|剥下|剥掉|扒下|扒掉|拽下|拉下|解开|解下|脱下|扯掉|扯下)[^，。！？；]{0,12}(?:衣|裤|裙|袜|罩|背心|吊带|内衣|内裤|外套|上衣|衬衫)|(?:衣|裤|裙|袜|罩|背心|吊带|内衣|内裤|外套|上衣|衬衫)[^，。！？；]{0,8}(?:脱下|脱掉|褪下|剥下|滑落|掉落)/;
/** 「掀开/扒开/拨开」类动作：衣服还在身上，只是被移开。 */
const OPEN_ACTION =
  /(?:扒开|扯开|掀开|撩开|敞开|拨开|拨到一边|拉低|扯低|解开了|敞着|敞开)[^，。！？；]{0,12}(?:衣|裤|裙|领|罩|背心|吊带|内衣|内裤|外套|上衣|衬衫|衣领|衣襟|前襟)/;
/**
 * 部位裸露。语序两种都要认：正文既写「露出整个胸部」（露在前），
 * 也写「胸口裸露着」（露在后）——旧版只认后者，最常写的「露出」全漏。
 */
const BARE_UPPER = RegExp(
  `(?:露出|裸露|暴露|亮出|敞开|扒开|扯开|掀开|毫无遮挡|毫无遮掩|一览无余)[^，。！？；]{0,10}(?:乳房|胸部|胸脯|胸口|双乳|乳沟|乳头|乳尖|乳球|乳峰|雪乳|椒乳|奶子|躯体|身子)|(?:上身|胸口|乳房|胸部|胸脯|双乳|乳沟|乳头|乳尖|乳球|乳峰|雪乳|椒乳|奶子)[^，。！？；]{0,6}(?:赤裸|裸露|暴露|露出|光着|外露)`,
);
const BARE_LOWER = RegExp(
  `(?:露出|裸露|暴露|亮出|敞开|扒开|扯开|掀开|探入|伸进|探进|摸进|毫无遮挡|毫无遮掩|一览无余)[^，。！？；]{0,10}(?:私处|阴部|下体|秘处|股间|屁股|臀|小穴|花穴|蜜穴|腿心)|(?:下身|私处|阴部|下体|秘处|腿间|股间|屁股|小穴|花穴|蜜穴)[^，。！？；]{0,8}(?:赤裸|裸露|暴露|露出|光着|外露|被.{0,4}(?:手指|掌|舌|唇))`,
);
/**
 * 整具身子已经几乎没遮住。
 *
 * 网文最常写「躯体近乎毫无遮挡」，既不点乳房也不点私处，但画面就是全露。
 * 旧版只认「全裸 / 一丝不挂」这类明写的词，这种描写整段漏掉，账本停在「穿得整整齐齐」。
 */
const BODY_BARE = /(?:躯体|身子|身体|全身|浑身)[^，。！？；]{0,8}(?:毫无遮挡|毫无遮掩|一览无余|一览无遗|赤裸|裸露)|(?:毫无遮挡|毫无遮掩|一览无余)[^，。！？；]{0,6}(?:躯体|身子|身体|全身)/;
/** 明确「没脱」的写法：这类情节一律不碰账本，宁可少脱也不错脱。 */
const OVER_CLOTHES =
  /(?:隔着(?:衣服|衣料|布料|衣物|内衣|内裤|裤子|裙子|胸罩|睡衣)|未脱|没脱|没有脱|不脱|衣着完整|衣服还在|穿着衣服)/;
/**
 * 正文这一段明摆着在裸 / 在做爱。
 *
 * 用途只有一个：**当账本说「全套穿好」而正文明确不是**时，别把模型写对的裸露状态
 * 剥成一身衣服。这是「NSFW 剧情出 SFW 图」的最后一道兜底——场景推断再全也有漏网的
 * 写法，而模型读到的是同一段正文，它写 `nude` 往往比账本准。
 *
 * 词表刻意写得紧，避免把「隔着衣服摸胸」「正常亲嘴」也放进来：
 * 不收单独的「胸」「亲」「吻」，只收明确的裸露与性行为。
 */
const NUDITY_HINT =
  /(赤裸|全裸|裸体|一丝不挂|未着寸缕|赤身|光着(?:身子|身体)|毫无遮挡|毫无遮掩|一览无余|乳房|乳球|乳峰|乳尖|乳头|双乳|奶子|私处|下体|小穴|花穴|蜜穴|腿心|性交|做爱|交合|交欢|交媾|插入|抽插|内射|口交|自慰|手淫|高潮|射在(?:里|体)?|淫水|爱液)/;
/**
 * 手或道具已经进到下半身里面了。
 *
 * 真实正文「探入裙底的纤细玉手死死按着震动棒，在…小穴内反复来回抽送」里既没有
 * 「脱下内裤」，也没有「露出私处」——但画面上那条内裤不可能是穿好的。
 * 旧版只认「脱/褪/露」三类动词，这类描写整段漏掉，于是图里她穿得整整齐齐。
 */
const HAND_OR_TOY_LOWER =
  /(?:震动棒|跳蛋|按摩棒|假阳具|手指|两指|玉手|指腹|指尖|指节)[^。！？；]{0,24}(?:小穴|花穴|蜜穴|穴内|阴道|私处|腿心|股间|下身|体内)|(?:探入|伸进|探进|摸进)[^。！？；]{0,8}(?:裙|腿|股)/;
/** 肩带垮落/裙腰下滑这类「衣服自己滑下去」。 */
const SLIP_ACTION = /(?:肩带|吊带|衣襟|衣领|领口|裙腰|裤腰)[^。！？；]{0,6}(?:垮落|滑落|下落|松脱|滑下)|(?:垮落|滑落)[^。！？；]{0,6}(?:肩带|吊带|裙|衣)/;
/**
 * 衣物被人推/掀/褪到别的位置——没有「脱」字，但画面已经变了。
 *
 * 真实正文写「粉色的睡衣被推到胸口上方，睡裤连同内裤一起被褪到膝盖」，一个「脱下/褪下」
 * 都没有，旧版 TAKEOFF_ACTION 整句不命中，于是这一整章床戏的服装账本一条不记。
 * 这里只认「衣物 + 位置移动」这一种语序，且仍然需要件名被点名才生效。
 */
export const DISPLACE_ACTION =
  /(?:睡衣|睡裙|上衣|衫|衣襟|裙摆|裙子|睡裤|长裤|短裤|内裤|胸罩|内衣|吊带)[^，。！？；]{0,12}(?:推到|推至|推上|掀到|掀上|掀起来|撩起|撩到|拉低|拉下|褪到|褪至|滑到|扯到|拨到一下|褪去)|(?:从头顶|从头上|整件)[^，。！？；]{0,6}(?:脱掉|脱下|褪下)/;
const PIECE_PROSE: Record<string, RegExp> = {
  panties: /内裤|底裤|丁字裤/,
  bra: /胸罩|文胸|内衣|奶罩/,
  skirt: /裙/,
  dress: /裙|旗袍|礼服|汉服|和服|浴衣|连衣/,
  // 睡衣必须在里面：PIECE_PROSE 少了这一类时，`pieceMentioned` 对睡衣永远返回 false，
  // 于是「睡衣被推到胸口上方」这句谁都不点名 → pieces 空 → 整段床戏的服装一条不记。
  pajamas: /睡衣|睡裙|睡袍|浴袍|睡裤|家居服|居家服|晨衣|pajamas|nightgown|bathrobe/i,
  swim: /泳衣|泳装|泳裤|比基尼|死库水|swimsuit|swimwear|bikini|monokini|tankini/i,
  pants: /牛仔|(?<!内)裤/,
  shirt: /衬衫|上衣|t恤|T恤|背心|吊带|毛衣|卫衣|连衣|抹胸|吊带|上衣/,
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
 * 只截取**这张图所在位置**附近的正文。
 *
 * 不能拿整楼正文判裸露:同一楼里第 3 段才脱光,第 1 段的图必须是穿着的。
 * 用整楼判定会把「后面脱了」当成「这张图也脱了」,第 1 张图就会跟着裸。
 */
function storyNearImage(source: string, image: ImageInsertion): string {
  if (!source) return '';
  const at = Math.max(0, absoluteOffset(source, image.sourceLine ?? 0, image.charOffset ?? 0));
  const start = Math.max(0, at - 240);
  const end = Math.min(source.length, at + 120);
  return source.slice(start, end);
}
/**
 * 账本里这套衣服是否已经记了「脱掉 / 半脱 / 露出」。
 *
 * 只用来决定要不要把话语权让给模型：账本**记了**脱除就按账本（它是逐楼累积的事实），
 * 账本**什么都没记**而正文这段明显在裸时，才让模型写的状态过。
 */
function ledgerShowsUndress(record: ClothingRecord): boolean {
  return record.pieces.some((piece) => {
    const state = piece.state ?? {};
    if (state.location && state.location !== 'worn' && state.location !== 'unknown') return true;
    if (state.exposure && state.exposure !== 'covered' && state.exposure !== 'unknown') return true;
    if (state.arrangement && state.arrangement !== 'normal' && state.arrangement !== 'unknown') return true;
    if (state.fastening && state.fastening !== 'closed' && state.fastening !== 'unknown') return true;
    return false;
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
  const scenes: Array<{
    expression: RegExp;
    mode: 'bath' | 'nude' | 'sex' | 'solo' | 'undress' | 'expose';
    label: string;
  }> = [
    { expression: BATH_SCENE, mode: 'bath', label: '洗澡 / 入水' },
    { expression: NUDE_SCENE, mode: 'nude', label: '全裸' },
    { expression: SEX_SCENE, mode: 'sex', label: '亲密情节' },
    // 排在 sex 之后:有男主在场的场面由 sex 分支处理(它认更多动作词)。
    // 这里只兜「没有男主、但正文明确在自慰/用道具」的场面——旧版这一类整段漏掉。
    { expression: SOLO_SCENE, mode: 'solo', label: '独自的情色场面' },
    // 最后一层:正文没写任何场景词,但明确在脱衣服（「睡衣被推到胸口上方，
    // 睡裤连同内裤一起被褪到膝盖」）。旧版只有 SEX_SCENE 才看脱衣动作，
    // 于是这种只写动作不写「做爱」的段落整段漏掉，账本停在穿好那套。
    { expression: DISPLACE_ACTION, mode: 'undress', label: '衣物被移开 / 脱衣动作' },
    // 再下一层：没有亲热/脱衣词，只有「胸口露出大半」「肩带从一侧滑落到手臂上」。
    // 泳池边、换衣中途、被扯歪的泳衣都属这一类——旧版这几句既不进 sex 也不进 undress
    // （DISPLACE_ACTION 要求「衣物+位置移动」，肩带滑落不算），于是账本停在「泳装穿得整整齐齐」，
    // enforceClothing 再把模型写的 slipped down 剥掉。
    { expression: BARE_UPPER, mode: 'expose', label: '上身露出' },
    { expression: BARE_LOWER, mode: 'expose', label: '下身露出' },
    { expression: SLIP_ACTION, mode: 'expose', label: '衣物滑落' },
  ];
  const handled = new Set<string>();
  for (const scene of scenes) {
    for (const match of text.matchAll(new RegExp(scene.expression.source, 'g'))) {
      const index = match.index ?? 0;
      // 主语优先取「本句最先出现的名字」，其次看前几句的句首主语。
      // 旧版直接用句尾之前最近提到的名字，于是「她…盖住苏晚的肩膀…她拉开抽屉」
      // 会把换装记到苏晚头上 —— 苏晚只是被盖了被子。
      const window0 = sentenceWindow(text, index, 80);
      const name = subjectOf(text, window0.start, window0.end, entries);
      const record = name ? before.get(name) : undefined;
      if (!record) continue;
      if (record.suitMode === 'always') {
        notes.push(`${name}: 固定套装已锁定款式，${scene.label}未改动服装`);
        continue;
      }
      const key = `${name}|${scene.mode}`;
      if (handled.has(key)) continue;
      // 脱衣动作是最后一层兜底：同一楼里已经按洗澡/全裸/亲密/独自场面记过这个人，
      // 就不再重复记一遍，否则同一批部件会被推两次、事件数也跟着翻倍。
      if (
        scene.mode === 'undress' &&
        (handled.has(`${name}|bath`) ||
          handled.has(`${name}|nude`) ||
          handled.has(`${name}|sex`) ||
          handled.has(`${name}|solo`) ||
          handled.has(`${name}|expose`))
      ) {
        handled.add(key);
        continue;
      }
      const storyIndex = storyPosition(text, index);
      // 同一句被多层同时命中两次（「做爱，他扒开她的衣领，露出整个胸部」既进 sex 又进 expose），
      // 会产出两条一模一样的 patch，事件数翻倍、渲染也重复。
      // 只按「同一个人的同一句」去重：不同句子的 sex 与 expose 是独立事件，不能互相压制。
      const sameMoment = changes.some(
        (c) => c.name === name && Math.abs(c.sourceLine - storyIndex.line) <= 1,
      );
      if (sameMoment) {
        handled.add(key);
        continue;
      }
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
      if (scene.mode === 'sex' || scene.mode === 'solo' || scene.mode === 'expose') {
        // 严格按剧情：没写脱衣/裸露就不动账本；写了「隔着衣服」更是明确不脱。
        if (OVER_CLOTHES.test(evidence)) {
          notes.push(`${name}: 亲密情节但原文写着隔着衣物/没有脱，服装账本保持原样`);
          continue;
        }
        const naked = NAKED_STATE.test(evidence);
        const bodyBare = BODY_BARE.test(evidence);
        const undress = TAKEOFF_ACTION.test(evidence);
        const opened = OPEN_ACTION.test(evidence);
        const bareUpper = BARE_UPPER.test(evidence);
        const bareLower = BARE_LOWER.test(evidence);
        const lowerInside = HAND_OR_TOY_LOWER.test(evidence);
        const slipped = SLIP_ACTION.test(evidence);
        if (
          !naked &&
          !bodyBare &&
          !undress &&
          !opened &&
          !bareUpper &&
          !bareLower &&
          !lowerInside &&
          !slipped
        ) {
          // 亲吻、隔着衣服的抚摸、单纯的爱抚描写：不推断任何脱衣。
          // 同样不能在这里记 handled：这一句没信号只说明这一句不脱，
          // 不等于这一楼后面那句「睡裤被褪到膝盖」也该跳过。
          continue;
        }
        for (const piece of record.pieces) {
          const location = piece.state.location;
          if (location && location !== 'worn' && location !== 'unknown') continue;
          const kind = garmentKind(piece.design);
          const mentioned = pieceMentioned(kind, evidence);
          // 用 covers() 而不是手写枚举：手写枚举每加一个品类（泳装、睡衣）就会漏一次，
          // 漏掉的表现是「泳衣肩带滑落、胸口露出大半」不记 exposure → 图里泳衣穿得整整齐齐。
          const cover = covers(kind);
          const upper = cover.upper;
          const lower = cover.lower;
          // 优先级：整具身子已经露出来 > 真脱掉 > 只把挡住的部分亮出来 > 手/道具已经进去了 > 肩带垮落 > 掀起裙摆。
          // 中间那层是核心修正——「衣领被扒开、整个胸部露出来」里衣服还在身上，
          // 记成 removed 会让渲染变成 no shirt + 上半身光着，比实际脱得更多。
          // 「扒开/掀开/敞开」本身就是 OPEN_ACTION，即便句子同时写了「露出」也不算脱下。
          //
          // bodyBare 单独一层：正文写「躯体近乎毫无遮挡」时不点任何一件衣服，
          // 旧版谁都不命中 → pieces 空 → 整段 continue，于是账本停在「全套穿好」，
          // 那正是「NSFW 剧情出 SFW 图」最主要的成因。
          if (naked || bodyBare) {
            pieces.push({ id: piece.id, design: '', state: { location: 'removed' } });
          } else if (undress && mentioned && !opened) {
            pieces.push({ id: piece.id, design: '', state: { location: 'removed' } });
          } else if ((bareUpper && upper) || (bareLower && lower)) {
            pieces.push({ id: piece.id, design: '', state: { exposure: 'bare' } });
          } else if (lowerInside && lower) {
            // 手或道具已经进到下身里：那条内裤/裤子不可能是穿好的，但也没写它被脱下，
            // 记成 removed 会画出比正文更光的画面。用「还穿着但被拨到一边」这一档。
            pieces.push({
              id: piece.id,
              design: '',
              state: {
                ...(kind === 'panties' || kind === 'pants' ? { arrangement: 'pulled_aside' } : {}),
                exposure: 'bare',
              },
            });
          } else if (slipped && upper) {
            // 肩带垮落：衣服还在身上，但已经挂不住了。
            pieces.push({ id: piece.id, design: '', state: { exposure: 'partial', fastening: 'loose' } });
          } else if (opened && mentioned) {
            pieces.push({ id: piece.id, design: '', state: { exposure: 'bare' } });
          } else if (mentioned && /掀起|撩起|掀开|撩开/.test(evidence) && (kind === 'skirt' || kind === 'dress')) {
            pieces.push({ id: piece.id, design: '', state: { arrangement: 'lifted' } });
          }
        }
      } else {
        if (scene.mode === 'bath' && /穿着(?:泳衣|泳装|比基尼|浴衣|睡衣)/.test(evidence)) {
          notes.push(`${name}: 洗澡情节里原文写着穿着衣物，未按全脱处理`);
          continue;
        }
        // 「温泉」「浴缸」单独出现不等于正在洗（温泉街散步、浴室门口说话）。
        // 这一句里没有任何洗/泡/脱的动作时就不动账本。
        //
        // 注意这里**不能** `handled.add(key)`：楼层标题「第二章·浴室」本身就命中「浴室」，
        // 一旦把它记成「这个人已经按洗澡处理过」，紧接着那句真正的
        // 「"我先去洗个澡。"林晚晴站起来…」就会被 `handled.has(key)` 直接跳过，
        // 整章浴室戏一条事件都落不了账（实测第 61 楼就是这样）。
        if (
          scene.mode === 'bath' &&
          !/(?:脱|洗|泡|淋|冲|浸|搓|澡|赤裸|裸|花洒|喷头|水声|水龙头|浴缸|入浴|温泉)/.test(evidence)
        )
          continue;
        // 最后一层兜底:没有场景词，只写了「睡衣被推到胸口上方、睡裤褪到膝盖」。
        // 只动**这一句点名的**部件，且没写脱/褪的部件不动 —— 宁可少脱也不错脱。
        if (scene.mode === 'undress') {
          if (OVER_CLOTHES.test(evidence)) {
            handled.add(key);
            continue;
          }
          for (const piece of record.pieces) {
            const location = piece.state.location;
            if (location && location !== 'worn' && location !== 'unknown') continue;
            const kind = garmentKind(piece.design);
            if (!pieceMentioned(kind, evidence)) continue;
            const state = inferClothingState(evidence, piece, kind);
            if (!Object.keys(state).length) continue;
            pieces.push({ id: piece.id, design: '', state });
          }
          if (!pieces.length) {
            handled.add(key);
            continue;
          }
        }
        if (scene.mode !== 'undress')
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
      if (!pieces.length) continue;
      // 位置取「证据句说完的地方」，不是句子开头。
      // acceptClothingChanges 用 charOffset 截出 preceding 再校验 `preceding.includes(evidence)`，
      // 传句首时 preceding 恰好停在证据句之前 → 自产的变更被判成「缺少可定位的原文证据」整条丢弃。
      //
      // 这里必须换算成证据句**自身的**结尾：`index` 是命中的那几个字的位置（「睡衣被推到」），
      // 不是句子开头，直接 index + evidence.length 会往前多算十来个字。正文里一旦有空行
      // （旧 tag 被剔除后留下的连续空行就有十几行），这点偏移就跨过一整段空行，
      // 事件落点整段往后挪 —— 第 67 楼两条脱衣事件的 sourceLine 从 14 变成 28，
      // 变成排在两张插图之后，两张图于是都取到「睡衣穿好」。
      const evidenceStart = window.start + (window.text.length - window.text.trimStart().length);
      const at = storyPosition(text, evidenceStart + evidence.length);
      // 与 adoptStoryClothing 同理：场景句本身常常只有「我先去洗个澡。」这类台词，
      // 人名在前一句。不带主语句原文的话，acceptClothingChanges 会判「缺少可定位到该人物的
      // 证据」把整条推断丢掉 —— 洗澡整段不记就是这么来的。
      const holder = subjectQuoteOf(text, window.start, window.end, entries, name);
      const subjectEvidence = holder && !evidence.includes(name) && holder !== evidence ? holder : undefined;
      changes.push({
        name,
        reportedName: name,
        position: '',
        sourceLine: at.line,
        charOffset: at.offset,
        operation: 'patch',
        evidence,
        ...(subjectEvidence ? { subjectEvidence } : {}),
        pieces,
      });
      handled.add(key);
      notes.push(`按场景推断（${scene.label}）：${name} ${pieces.map((p) => p.id).join('、')}`);
    }
  }
  return { changes, notes };
}
// 只认真正的换装动作。裸的「换了一」会命中「换了一下姿势」「换了一边」，
// 一旦采纳就把账本款式换掉——长牛仔裤被写成短牛仔裤就是这么来的。
const CHANGE_SCENE =
  /换上|换成|换好|换上一|换了一身|换了|换身|新衣|更衣(?!室|间|房|处)|换装|穿回|重新穿|披上|套上|系上/;
/**
 * 正文在**陈述她此刻的穿着**（不是动作，是状态）。
 *
 * 「她今天穿了一件红色连衣裙」没有换装动词，却已经把款式写死了。只看 CHANGE_SCENE
 * 的话，账本里记错的款式永远不会被正文纠正——用户说的「剧情里明明写了她穿的什么服装，
 * 图片里还是原本的衣服」就是这条。陈述句也算数，但必须点名到本人（下面 still 查 called）。
 */
const WEARING_STATE = /穿着|身穿|身着|穿了|套着|披着|一身|换了|换成了|已经是/;
// 能接管账本的主衣物类别。pajamas 必须在里面:换睡衣是最典型的「整套换」，
// 它不在这个集合里时,「换上睡衣」这句永远走不到接管分支,账本停在白天那套。
const MAIN_GARMENTS = new Set(['shirt', 'skirt', 'pants', 'dress', 'pajamas', 'swim']);
/**
 * 剧情明确换装、但模型只写了 patch（或压根没报）时，采纳图片里模型给的新衣物，
 * 避免「剧情换了衣服，画面还是旧账本那套」。
 */
export function adoptChangedClothing(
  image: ImageInsertion,
  before: ClothingState,
  source: string,
  entries: CharTagEntry[] = [],
): { changes: ClothingChange[]; notes: string[] } {
  const changes: ClothingChange[] = [];
  const notes: string[] = [];
  const text = source.replace(/\r\n?/g, '\n');
  if (!text) return { changes, notes };
  const prefix = text.split('\n').slice(0, image.sourceLine).reduce((n, line) => n + line.length + 1, 0);
  const index = Math.max(0, Math.min(text.length, prefix + (image.charOffset ?? 0)));
  for (const character of image.characters) {
    const canonical = entries.length ? resolveCanonicalCharName(character.name, entries) : character.name;
    const record = before.get(canonical) ?? before.get(character.name);
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
    const window = sentenceWindow(text, index, 120);
    // 原文点名的衣物与账本同一类但写法不同（长牛仔裤 → 短牛仔裤、白衬衫 → 黑吊带）
    // 也是换装。旧版只认「账本里完全没有的衣物种类」，同类别换个款式永远接管不了，
    // 于是「前后剧情没变衣服却在变」和「剧情写了换衣服却不换」两头都出。
    const named = proseGarment(window.text);
    const swapped =
      !!named &&
      record.pieces.some(
        (piece) =>
          garmentKind(piece.design) === garmentKind(named) &&
          piece.design.trim().toLowerCase() !== named.toLowerCase(),
      );
    if (!novel.length && !swapped) continue;
    if (!CHANGE_SCENE.test(window.text) && !WEARING_STATE.test(window.text)) continue;
    const entry = entries.find((e) => e.name === canonical);
    const called =
      window.text.includes(canonical) ||
      window.text.includes(character.name) ||
      (entry ? candidateAliasesForEntry(entry).some((alias) => window.text.includes(alias)) : false);
    if (!called && !/她/.test(window.text)) continue;
    // 句子里必须真的出现衣物词：只写「换了一身」却没说是哪件，不足以接管账本。
    if (!named) continue;
    const at = storyPosition(text, index);
    // 原文点名的款式优先：模型把「长牛仔裤」写成 jeans 时，画面必须跟着原文变成长裤，
    // 否则接管了账本仍然是错的。同一类别已被原文代表的部件不再重复收（牛仔裤 vs long jeans）。
    const namedKind = named ? garmentKind(named) : '';
    // 原文只写「睡衣」「裙子」没写颜色/材质时，模型给的 `pink pajamas` 才是唯一带颜色的描述。
    // 旧代码把同类别通通滤掉，结果账本里只剩裸的 `pajamas`，画面丢色。
    const COLOUR_WORD =
      /(?:白|黑|红|蓝|绿|黄|粉|紫|灰|米|卡其|棕|橙|金|银|彩|深色|浅色|white|black|red|blue|green|yellow|pink|purple|grey|gray|beige|brown|orange|gold|silver)/i;
    const richer =
      named && !COLOUR_WORD.test(named)
        ? design
            .split(/[,，]/)
            .map((part) => part.trim())
            .find((part) => part && garmentKind(part) === namedKind && COLOUR_WORD.test(part) && part.length > named.length)
        : '';
    const storyParts = named ? [richer || named] : [];
    const rest = design
      .split(/[,，]/)
      .map((part) => part.trim())
      .filter((part) => part && (!namedKind || garmentKind(part) !== namedKind));
    const pieces = [...new Set([...storyParts, ...rest])]
      .slice(0, 12)
      .map((part, order) => ({ id: `adopt_${order + 1}`, design: part, state: { location: 'worn' } }));
    if (!pieces.length) continue;
    changes.push({
      // 这几条是绕过 acceptClothingChanges 直接并进账本的，所以必须自己归一：
      // 写成「晚晴」会导致 applyOne 的 state.get 落空，新衣服挂不到账本上。
      name: canonical,
      reportedName: character.name,
      position: '',
      sourceLine: at.line,
      charOffset: at.offset,
      operation: 'change',
      evidence: window.text.trim(),
      pieces,
    });
    notes.push(
      `${character.name}: 剧情明确换装，已按原文与图片外观接管新衣物（${(novel.length ? novel : modelKinds).join('、')}）`,
    );
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
  entries: CharTagEntry[] = [],
  source = '',
): void {
  let managed = 0;
  // 道具只在正文里还提到时保留：刀架脖子那一楼过去后，锚点与模型 tag 里的
  // `knife at neck` 都该消失，不然它会一直挂在人物身上。
  const keepProp = (token: string) =>
    isCollarToken(token) ? storyMentionsCollar(source) : storyMentionsProp(token, source);
  const dropProps = (tokens: string[]) =>
    tokens.filter((t) => (!isPropToken(t) && !isCollarToken(t)) || keepProp(t));
  for (const c of image.characters) {
    // 账本按档案主名记。模型写「晚晴」「林小姐」而库里是「林晚晴」时，旧代码直接
    // state.get 落空 → 这张图的服装完全不锁（脸却因为 enforceAppearance 走了归一锁住了）。
    const canonical = entries.length ? resolveCanonicalCharName(c.name, entries) : c.name;
    const record = state.get(canonical) ?? state.get(c.name);
    if (!record) continue;
    const caption = clothingCaption(record);
    // 账本一套衣服都没记下来(旧版残档 design 为空)时，别把模型写的衣服也剥掉，
    // 否则人物会变成「没写任何衣物」→ 出图直接裸。整条跳过，连 Base 也不剥。
    if (!caption.tag.trim()) continue;
    // 账本说「全套穿好」但正文这段明摆着在裸 —— 以正文为准，保留模型写的状态。
    //
    // 为什么需要这道兜底：场景推断再全也有漏网的写法（比喻、方言、隐晦描写），
    // 而模型读的就是同一段正文，它写 `nude` / `panties down` 往往比账本准。
    // 旧版无条件用账本覆盖，于是账本一旦漏判，模型写对的裸露就被抹成一身衣服——
    // 用户看到的「NSFW 剧情出 SFW 图」就是这个。只在「账本没记任何脱除」时放行，
    // 反向不会成立：账本记了 removed 仍然压过模型。
    if (caption.tag.trim() && source && NUDITY_HINT.test(storyNearImage(source, image)) && !ledgerShowsUndress(record)) {
      managed++;
      continue;
    }
    managed++;
    const dynamic = dropProps(
      c.tag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && !isClothingDescription(t) && !LOCKED_WEAR_STATE.test(t)),
    );
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
    image.tag = dropProps(
      image.tag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && !isClothingDescription(t) && !LOCKED_WEAR_STATE.test(t)),
    ).join(', ');
    if (nl)
      image.nl = image.nl
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !CLOTHING_WORD.test(s) && !WEAR_WORD.test(s))
        .join(' ');
  } else if (managed && image.characters.length === 1) {
    image.tag = [
      ...new Set([
        ...dropProps(
          image.tag
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t && !isClothingDescription(t) && !LOCKED_WEAR_STATE.test(t)),
        ),
        ...image.characters[0].tag.split(',').map((t) => t.trim()),
      ]),
    ].join(', ');
    if (nl) image.nl = image.characters[0].nl;
  }
}



/**
 * 正文自己点名了换装：不依赖模型报 `outfitChanges`，也不依赖模型把新衣服画进 tag。
 *
 * 为什么需要这一层：模型（尤其小模型）经常只写一句 `patch`、甚至完全不报服装变化，
 * 而正文已经明说「她换上了睡衣」。此时旧链路里 `adoptChangedClothing` 只从
 * **图片的 character tag** 里取新衣物——模型没画那件就整段落空，账本停在白天那套，
 * 图里于是还是原来那件。用户报的「剧情说换了睡衣，图里还是原来那套」就是这个。
 *
 * 只认三类明确写法，不做任何猜测：
 *   - 整身换：换上 / 换成 / 换了一身 / 更衣 / 换装 / 改穿  + 点名衣物
 *   - 加穿：穿上 / 披上 / 套上 / 系上 / 裹上 + 点名衣物（不覆盖其它部件）
 *   - 陈述：穿着 / 身穿 + 点名衣物，且与该类别在穿的那件款式不同（纠正账本）
 */
export function adoptStoryClothing(
  source: string,
  entries: CharTagEntry[],
  before: ClothingState,
): { changes: ClothingChange[]; notes: string[] } {
  const changes: ClothingChange[] = [];
  const notes: string[] = [];
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  if (!text || !before.size) return { changes, notes };
  // 「更衣」必须排除「更衣室 / 更衣间」——那是地点。
  // 旧正则命中地点词，「林晚晴站在更衣室的镜子前，白色衬衫的扣子被一颗颗解开」
  // 会被当成一句换装，凭空给账本塞一件白衬衫。
  const SWAP = /换上|换成|换好|换上一|换了一身|换了一|换了|换身|更衣(?!室|间|房|处)|换装|改穿|改成/;
  const PUT_ON = /穿上|穿回|披上|套上|系上|裹上|扣上/;
  // 「只剩一件白色泳衣」「只穿着比基尼」也是陈述句：网文写换装很少规规矩矩写「换上」，
  // 更常见的是「她拉开帘子走出来，身上只剩一件白色泳衣」——旧词表里没有「只剩」，
  // 这类句子整条被当成普通描写跳过，泳装永远进不了账本。
  const STATED = /穿着|身穿|身着|穿了|一身|只穿|只(?:剩|留)|仅(?:剩|穿|着)|身上只剩|裹着|披着/;
  // 脱与穿在同一句里频繁共现（"把衬衫褪下来，换上新的连衣裙"）：旧版见到「脱下」就整句跳过，
  // 于是那一句的换装整条丢失。这里只在「整句只有脱、没有任何穿戴词」时才跳过。
  const OFF_ONLY = /没穿|未穿|不穿|没有穿/;
  const handled = new Set<string>();
  let cursor = 0;
  for (const sentence of text.split(/(?<=[。！？!?\n])/)) {
    const index = cursor;
    cursor += sentence.length;
    if (!sentence.trim()) continue;
    const swap = SWAP.test(sentence);
    const putOn = !swap && PUT_ON.test(sentence);
    const stated = !swap && !putOn && STATED.test(sentence);
    if (!swap && !putOn && !stated) continue;
    if (OFF_ONLY.test(sentence)) continue;
    // 一句里可能同时点名多件（"拿出一件干净的白色衬衫和一条黑色长裙"）。
    // 旧版只取第一件，于是换装永远只换一半：连衣裙加了衬衫没加、长裙换了衬衫没换。
    const designs = proseGarments(sentence);
    if (!designs.length) continue;
    // 主语优先取「本句最先出现的名字」，其次看前几句句首——不能一律取句尾前最近的名字。
    const name = subjectOf(text, index, index + sentence.length, entries) || (/她|自己/.test(sentence) && before.size === 1 ? [...before.keys()][0] : '');
    if (!name) continue;
    const record = before.get(name);
    if (!record) continue;
    // 只认点名到本人（或紧邻的「她」），避免把别人的衣着算到她头上。
    const entry = entries.find((e) => e.name === name);
    const called =
      sentence.includes(name) ||
      (entry ? candidateAliasesForEntry(entry).some((alias) => sentence.includes(alias)) : false);
    if (!called && !/她|自己/.test(sentence)) continue;
    if (record.suitMode === 'always') {
      notes.push(`${name}: 固定套装已锁定款式，正文换装未生效`);
      continue;
    }
    // 位置取证据句说完的地方：acceptClothingChanges 用 charOffset 截 preceding 再校验
    // `preceding.includes(evidence)`，传句首会让 preceding 停在证据句之前，本函数自己产的
    // 换装事件反而被判「缺少可定位的原文证据」全部丢弃。
    // sentence 已经是完整句子（含末尾标点），index + sentence.length 就是它的结尾，
    // 与上面场景推断不同，这里不需要再折算命中位置。
    const at = storyPosition(text, index + sentence.length);
    // 同一句里的多件衣物合成一条事件（同位置、同证据），执行时按顺序套用，
    // 这样「衬衫+长裙」不会因为第二条 patch 找不到衬衫而落空。
    const pieces: ClothingPiece[] = [];
    let operation: ClothingChange['operation'] = 'add';
    const designList: string[] = [];
    for (const design of designs) {
      const kind = garmentKind(design);
      const key = `${name}|${kind}`;
      if (handled.has(key)) continue;
      handled.add(key);
      const worn = record.pieces.filter((p) => (p.state.location ?? 'worn') === 'worn');
      const sameKind = worn.find((p) => garmentKind(p.design) === kind);
      const whole = kind === 'dress' || kind === 'pajamas' || kind === 'swim';
      // 连体衣物(连衣裙/睡衣)换上去等于整套换掉；半身衣物只换那一件——
      // 后者用 change 会把上衣、内裤一起从账本里删掉，画面反而比正文更露。
      if (whole && (putOn || swap || stated)) {
        operation = 'change';
        pieces.push({ id: kind, design, state: { location: 'worn' } });
        designList.push(design);
        continue;
      }
      if (sameKind) {
        if (sameKind.design.trim().toLowerCase() === design.toLowerCase()) continue;
        if (operation === 'add') operation = 'patch';
        pieces.push({ id: sameKind.id, design, state: { location: 'worn' } });
        designList.push(design);
        continue;
      }
      // 陈述句（"她穿着白衬衫"）只在同类款式不同时纠正账本，不新增部件。
      if (stated && !sameKind) continue;
      pieces.push({ id: `${kind || 'piece'}_story`, design, state: { location: 'worn' } });
      designList.push(design);
    }
    if (!pieces.length) continue;
    // 身上那件连体衣物（连衣裙/睡衣）必须在换上半身衣物时一起退出账本。
    // 正文几乎不会写「她先脱掉睡衣再穿上衬衫」——那是不言自明的，但对账本是必需的：
    // 不记这一步，第二天的账本会变成「睡衣 + 白衬衫 + 黑长裙」三层叠穿，
    // 渲染出来的画面就是睡衣从衬衫里冒出来。
    // 用 change（整套重记）而不是 patch：patch 只能改已存在的部件 ID，
    // 新加的衬衫/长裙 ID 在旧账本里不存在，整条会被判「局部变化指向未知衣物部件」丢弃。
    const wornWhole = record.pieces.find(
      (p) => (p.state.location ?? 'worn') === 'worn' && ['dress', 'pajamas', 'swim'].includes(garmentKind(p.design)),
    );
    if (wornWhole && (putOn || swap || stated)) operation = 'change';
    else if (wornWhole) {
      pieces.push({ id: wornWhole.id, design: '', state: { location: 'removed' } });
      if (operation !== 'change') operation = 'patch';
    }
    // 只写代词的句子必须把真正的主语句一起交上去，否则 acceptClothingChanges 会按
    // 「往前 500 字内最近提到的名字」判人，把这条换装记到别人头上或者直接丢弃。
    const holder = subjectQuoteOf(text, index, index + sentence.length, entries, name);
    const subjectEvidence = holder && !sentence.includes(name) && holder !== sentence.trim() ? holder : undefined;
    // 一句里既有连体也有半身时以整套为准（睡衣+内裤这类写法按整套处理）。
    changes.push({
      name,
      reportedName: name,
      position: '',
      sourceLine: at.line,
      charOffset: at.offset,
      operation,
      evidence: sentence.trim(),
      ...(subjectEvidence ? { subjectEvidence } : {}),
      pieces,
    });
    notes.push(`按正文换装（${operation}）：${name} ${designList.join('、')}`);
  }
  return { changes, notes };
}

function sourceLineOf(text: string, index: number): number {
  return storyPosition(text, index).line;
}

/** 场景翻篇的标志：换天、换地点、出门这类「人已经重新收拾过」的写法。 */
const SCENE_RESET =
  /(?:第二天|次日|翌日|隔天|第二天一早|清早|清晨|天亮|几天后|一周后|一个月后|数日后|回到(?:家|房间|城里|学校|公司)|出门|上班|上学|抵达|到了(?:公司|学校|会场))/;

/** 本楼正在发生的脱衣/裸露/亲密动作。有它就不复位，避免把正在脱的衣服又穿回去。 */
const UNDRESS_MARK = /(?:脱|褪下|赤裸|裸体|全裸|一丝不挂|洗澡|沐浴|淋浴|泡温泉|做爱|性交|交合|插入|抽插|口交)/;

/**
 * 场景翻篇自动复位：上一段脱掉的衣物，在新场景里默认已经穿回去。
 *
 * 不这么做就会出用户遇到的那种图：前一天做爱脱光，第二天日常剧情里女主
 * 光着上半身出场——账本的 removed 是永久的，而现实里人会穿衣服。
 * 只在「有翻篇标志、且本楼没有脱衣动作」时复位，方向永远是多穿，不会当众脱。
 */
export function redressForNewScene(
  source: string,
  entries: CharTagEntry[],
  before: ClothingState,
): { changes: ClothingChange[]; notes: string[] } {
  const changes: ClothingChange[] = [];
  const notes: string[] = [];
  const text = String(source ?? '');
  if (!SCENE_RESET.test(text) || UNDRESS_MARK.test(text)) return { changes, notes };
  for (const record of before.values()) {
    if (record.suitMode === 'always') continue;
    const off = record.pieces.filter(
      (piece) => piece.state?.location === 'removed' || piece.state?.location === 'floor',
    );
    if (!off.length) continue;
    changes.push({
      name: record.name,
      reportedName: record.name,
      position: '',
      sourceLine: 0,
      charOffset: 0,
      operation: 'patch',
      evidence: '',
      pieces: off.map((piece) => ({
        id: piece.id,
        design: '',
        state: { location: 'worn', fastening: 'closed', arrangement: 'normal' },
      })),
    });
    notes.push(`${record.name}: 新场景开始，已把脱下的衣物穿回`);
  }
  return { changes, notes };
}
