import { characterAliases } from '@/state/characterAliases';
import { appearancePolicy } from '@/state/appearancePolicy';
import { applyWardrobeChoices, wardrobeChoiceRevision } from '@/state/wardrobeChoice';
import type { CostumeContext, CostumeFloor } from './costumeContext';
import type { TargetSegment } from './clean';
import type { ImageInsertion } from './protocol';
import type { StoryFact } from './facts';
import { TAG_LEXICON, normaliseLexiconTag } from '@/data/tagLexicon';
import { extractGarment, readOutfitState, readWear, BBI_OUTFIT_EXTRA_KEY } from './outfitState';
import { candidateAliasesForEntry, resolveCanonicalCharName } from './charReuse';
import { isCollarToken, isPropToken, storyMentionsCollar, storyMentionsProp } from './props';
import type { CharTagEntry } from '@/state/charTags';
import { groundScenes, storyGarments, storyPlaces } from './storyGarments';
import { collapseAttributes, resolveTagConflicts } from './conflicts';
import { enforceShotCoverage, needsFromFacts, seeNeeds } from './shotCoverage';
import type { STMessage } from '@/st/context';
import { parseImageTagContent, parseImageTags, stripImageTags } from '@/st/imageTagRegex';

export interface ClothingPiece {
  /** Verified source for the garment, preserved across state-only patches. */
  evidence?: string;
  costume?: CostumeContext;
  id: string;
  design: string;
  state: Record<string, string>;
  /**
   * 稳定实例号（同一件衣服跨楼不变）。`id` 是类别名（shirt/bra/skirt），
   * 用来归位；`garmentId` 用来指认「还是那一件」——换了一件同类别的新衣服时
   * garmentId 会变，界面与诊断都靠它区分「同一件」与「另一件同款」。
   */
  garmentId?: string;
}
export interface ClothingRecord {
  /**
   * 最近一次「完整穿搭」的快照。跨天/换场景时用来复原，
   * 而不是从上一楼那张图的 tag 反推——tag 里有景别、表情、机位，反推出来的
   * 「衣服」会越来越不像人穿的那套。
   */
  lastComplete?: ClothingPiece[];
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
  /**
   * carried:衣服在身上/手里但没穿到身上去——外套搭在手臂上、拎着、披在肩头。
   * 它既不是 worn(不遮盖任何部位)也不是 held(没有离开她),单独立一格,
   * 否则模型写「把外套搭在手臂上」会被白名单判成未知值整条丢掉。
   */
  arrangement: ['normal', 'lifted', 'pulled_aside', 'lowered', 'around_waist', 'around_ankles', 'carried', 'unknown'],
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
/**
 * 用「动作必须落在本人身上」这把尺子复核一层历史账本。
 *
 * 只复核 removed 类的 pieces：init/add/change 是「穿上了什么」，收错的代价是多一件
 * 衣服、画面偏保守；收错了 removed 的代价是这个人一路裸奔，两者不对等。
 */
function revalidateRemovals(
  saved: ClothingFloor,
  text: string,
  state: ClothingState,
  entries: CharTagEntry[],
): void {
  const body = String(text ?? '');
  if (!body.trim() || !saved.changes.length) return;
  for (const change of saved.changes) {
    if (change.operation === 'init' || change.operation === 'add') continue;
    const removed = (change.pieces ?? []).filter((piece) => piece.state?.location === 'removed');
    if (!removed.length) continue;
    const name = entries.length ? resolveCanonicalCharName(change.name, entries) : change.name;
    const aliases = [...new Set([name, change.name, ...characterAliases(name)])].filter(Boolean);
    if (ownerBoundAction(change.evidence ?? '', change.subjectEvidence ?? '', aliases)) continue;
    const record = state.get(name);
    if (!record) continue;
    const ids = new Set(removed.map((piece) => piece.id));
    for (const piece of record.pieces)
      if (ids.has(piece.id) && piece.state?.location === 'removed')
        piece.state = { ...piece.state, location: 'worn' };
  }
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
      for (const entry of saved.entries) state.set(entry.name, pruneOrnaments(entry));
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
        if (entry?.name) state.set(entry.name, pruneOrnaments(entry as unknown as ClothingRecord));
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
    // 历史复核：旧版本收下过的脱衣事件里，有一批证据根本没落在她身上（典型：
    // 「肉棒上挂着黏糊糊的小姨子的内裤和丝袜」——她只是被提到的领属定语）。
    // 那时没有归属判据，账本把她记成脱光，于是一路裸到后面几十楼。判据加上以后，
    // 新楼层不会再收这种证据，但已经落盘的历史楼层还在——读账本时用同一把尺子
    // 再过一遍，把归属不明的 removed 还原成 worn。
    if (saved) revalidateRemovals(saved, message.mes ?? '', state, entries);
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
/** 「她主动穿回去」的正向证据。没有它，脱下的状态必须一直保持。 */
// 「第二天出门 / 走进教室」这类**场景翻篇**同样是穿衣证据：人不会光着去上学。
// 与 REDRESS 的分工：REDRESS 认「她穿上了」，这条认「她离开了上一格」。
// 只认带位移的写法（出门/去学校/走进教室…），并且同一段里没有掀/拉/露的动作，
// 否则「第二天清晨他把她按在沙发上」会被误判成穿好衣服。
const NEXT_SCENE =
  /(?:第二天|次日|翌日|隔天)[^。！？；]{0,12}(?:出门|出去|去学校|去上班|上学|走进|来到|回到)|(?:清晨|早上|上午)[^。！？；]{0,12}(?:出门|出去|去学校|去上班|上学|走进|来到|回到)|(?:走进|来到|回到)[^。！？；]{0,8}(?:教室|学校|公司|办公室|图书馆|餐厅)/;
const REDRESS =
  /穿上|套上|系上|拉上|拉好|扣好|扣上|整理好|整理|遮好|掩好|换回|换好|换[上了]?.{0,4}(?:衣|裙|裤|服|内衣|睡衣)|披上|穿上衣服|\bdressed\b|\bput on\b|\bchanged into\b/i;

/** 这一段是不是「新的一天/换了地方」：事实表与外层判断都要用它。 */
export function storyLooksLikeNewScene(text: string): boolean {
  return !!text && NEXT_SCENE.test(text) && !EXPOSURE_MOVE.test(text) && !/赤裸|裸体|\bnaked\b|\bnude\b/i.test(text);
}

export function settleStaleUndress(state: ClothingState, text: string): void {
  if (!state.size) return;
  // SEX_ACT 也要算「这一楼还在写这件事」：第 9 楼还在射精吞精，账本却被复位成穿好，
  // 后面那张图于是给她穿回了睡衣。旧判据只认「裸/脱/露出」，漏掉纯性行为描写。
  const clothingHere =
    NAKED_STATE.test(text) || UNDRESS_ACTION.test(text) || BARE_UPPER.test(text) || BARE_LOWER.test(text) || SEX_ACT.test(text);
  const sceneReset = sceneChanged(text) && !UNDRESS_MARK.test(text);
  for (const record of state.values()) {
    if (record.suitMode === 'always') continue;
    for (const piece of record.pieces) {
      const location = piece.state.location;
      const stripped = ['removed', 'floor', 'chair', 'held'].includes(location ?? '');
      const exposed = !stripped && piece.state.exposure === 'bare';
      // 旧版账本把走光写进了 state.legacy 字符串（"off shoulder, breasts out"）。
      // 它既不是 location 也不是 exposure，旧代码永远不回收，第 1 楼的一次走光
      // 就跟着后面的日常戏一路画下去。这里把它并入同一套陈旧计数。
      const legacyWear = !!piece.state.legacy && LEGACY_WEAR.test(piece.state.legacy);
      if (!stripped && !exposed && !legacyWear) continue;
      const kind = garmentKind(piece.design);
      const mentioned = piece.design ? text.includes(piece.design.trim()) || pieceMentioned(kind, text) : false;
      // 正文明确写了穿衣/整理动作时，先把状态收回来，再走后面的陈旧判定。
      // 换场景（第二天/出门/进另一间房）按「最近一次着装」复原：正文通常不会
      // 专门写一句「她穿好衣服」，但人不会光着去上班。同场景内则保持 sticky，
      // 没有穿衣动作就不许自己穿回去。
      if (REDRESS.test(text) || sceneReset) {
        if (stripped) {
          piece.state.location = 'worn';
        }
        // 掀起来/拉到一边和「露着」一样是可陈旧状态：第二天出门还带着 shirt lift，
        // 模型就会画一件掀到胸口的衬衫陪她上班。复位时三者一起收。
        piece.state.fastening = 'closed';
        piece.state.arrangement = 'normal';
        delete piece.state.exposure;
        if (legacyWear) delete piece.state.legacy;
        piece.state.stale = '0';
        continue;
      }
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
      // 旧逻辑「连续两楼没提就算穿好 / 场景翻篇立刻穿回」会把上一楼脱掉的衣物
      // 在没有任何换装描写的楼层里悄悄穿回去（实测：前一楼掀衣露胸，下一楼
      // 完整着装）。状态必须 sticky，只有正文明确写了穿衣动作才复位。
      if (REDRESS.test(text)) {
        if (stripped) {
          piece.state.location = 'worn';
          piece.state.fastening = 'closed';
          piece.state.arrangement = 'normal';
        }
        delete piece.state.exposure;
        // 走光词是旧版一次性写死的，收回穿着时整串丢掉，让后面的楼按账本重新渲染。
        if (legacyWear) delete piece.state.legacy;
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
    /(?:脱下|脱掉|脱去|脱了|褪下|褪到|褪去|褪了|剥下|剥掉|扒下|扒掉|拽下|扯下|扯掉|扔掉|丢开|甩掉|滑落|掉落|解开|解下|掀起|撩起|穿回|穿上|拉下)[^。！？\n]{0,14}?(?:外套|衬衫|衬衣|雪纺衫|上衣|衣裤|长裙|短裙|裙子|裙装|内裤|开裆裤|胸罩|乳罩|文胸|裹胸|吊带袜|长筒袜|连裤袜|丝袜|长袜|短袜|裤子|短裤|牛仔裤|吊带|背心|衣扣|纽扣|拉链|衣物|衣裳)|(?:外套|衬衫|衬衣|雪纺衫|上衣|裙子|裙装|内裤|开裆裤|胸罩|乳罩|文胸|裹胸|吊带袜|长筒袜|连裤袜|丝袜|长袜|短袜|裤子|短裤|牛仔裤|背心|衣物|衣裳)[^。！？\n]{0,8}?(?:脱下|脱掉|脱去|脱了|褪下|褪去|褪了|剥下|扒下|扯下|扯掉|滑落|掉落|解开|解下|掀起|撩起|拉下)/g;
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
/**
 * 只属于别人脸/头上的东西：眼镜、胡子、疤。模型读同一段正文时，只要楼里提过
 * 一次「他推了推眼镜」，就会把 glasses 写进女主 tag——它没做「这件东西长在谁身上」
 * 的归属判断。契约里已经写明不许，但契约是概率性的，所以在出口再判一次。
 */
const FOREIGN_WEAR =
  /^(?:glasses|sunglasses|eyepatch|monocle|beard|mustache|moustache|stubble|goatee|sideburns)$/i;

/** 英文 tag 在中文小说里怎么出现——归属判断必须做在正文那次出现上。 */
const WEAR_PROSE: Array<[RegExp, RegExp]> = [
  [/^glasses$/i, /眼镜|镜片|镜框|镜架/],
  [/^sunglasses$/i, /墨镜|太阳镜/],
  [/^eyepatch$/i, /眼罩|独眼/],
  [/^monocle$/i, /单片眼镜/],
  [/^beard$/i, /络腮胡|大胡子|胡须/],
  [/^(?:mustache|moustache)$/i, /小胡子|胡子|胡须|髭/],
  [/^stubble$/i, /胡茬|青色的胡|青青的胡/],
  [/^goatee$/i, /山羊胡/],
  [/^sideburns$/i, /鬓角/],
];

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 这件东西在这一段里是不是长在她身上（领属或佩戴/摘取动作都算）。 */
export function wearBelongsTo(token: string, text: string, aliases: readonly string[]): boolean {
  const body = String(text ?? '');
  if (!body.trim()) return false;
  const prose = WEAR_PROSE.find(([tag]) => tag.test(token.trim()))?.[1];
  if (!prose) return true;
  const word = `(?:${prose.source})`;
  const owners = [...new Set(aliases.map((a) => String(a ?? '').trim()).filter(Boolean))].map(escapeRe);
  const own = owners.length
    ? new RegExp(`(?:${owners.join('|')})的?[^。！？；\\n]{0,14}${word}`, 'i')
    : null;
  const herOwn = new RegExp(`她(?:的|戴着|戴着副|架着|挂着|摘下|取下|扶着|推起|推了推)[^。！？；\\n]{0,10}${word}`, 'i');
  const wornOn = new RegExp(`${word}[^。！？；\\n]{0,8}(?:架在她|挂在她|戴在她|在她脸|在她鼻梁)`, 'i');
  return Boolean(own?.test(body) || herOwn.test(body) || wornOn.test(body));
}

/** 把不属于她的脸/头饰物从她的 tag 里删掉。 */
export function dropForeignWear(tag: string, text: string, aliases: readonly string[]): string {
  if (!text.trim()) return tag;
  return tag
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && (!FOREIGN_WEAR.test(t) || wearBelongsTo(t, text, aliases)))
    .join(', ');
}

/**
 * 一句话里，这个穿脱动作是不是落在她们身上。判据只有两条，都要求同一分句：
 * 她的名字/称呼在分句里且后面不是「的」「之」（`小姨子的内裤` 是领属，不算）；
 * 出现「她」/she/her 且以「她」开头或紧贴动作。
 */
function ownerBoundAction(evidence: string, subjectEvidence: string, aliases: readonly string[]): boolean {
  /**
   * 一句话里，这个穿脱动作是不是落在她们身上。判据只有两条，都要求**同一分句**：
   * - 她的名字/称呼出现在分句里，且后面不是「的」「之」（`小姨子的内裤` 是领属，不算）；
   * - 「她」/she/her 以句首或紧贴动作的方式出现（`她褪下内裤` 算；`他把她按在…` 里她只是受事）。
   */
  const bound = (text: string): boolean =>
    text
      .split(/[，,。；;！!？?\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .some((clause) => {
        if (!ACTION.test(clause)) return false;
        const named = aliases.some((name) => {
          const at = clause.indexOf(name);
          if (at < 0) return false;
          const after = clause.slice(at + name.length, at + name.length + 1);
          return after !== '的' && after !== '之';
        });
        if (named) return true;
        return /(?:^|[\s，,、])她(?!的)|\bshe\b|\bher\b/i.test(clause);
      });

  if (bound(evidence)) return true;
  /**
   * 走到这里只剩两种合法情形：动作句里没有主语（插件合成的场景推断句，
   * 「浴室里很快响起水声。」）或用代词指代（「她一边走一边解开衬衫的扣子」），
   * 主体都靠 subjectEvidence 那句点名来定。
   *
   * 但动作句里明写了「他」「自己」作主语时，这句写的是别人 —— 补强也不能翻案。
   * 实测反例：「而自己，赤裸的身体上还残留着…肉棒上挂着黏糊糊的小姨子的内裤和丝袜」
   * 配一句「李斌清楚的看到，小姨子温岚…脸上满是愤怒与错愕」，旧逻辑就把李斌的裸体
   * 记到了她账上，随后一路裸到几十楼。
   */
  // 「他」「自己」当主语时这句写的是别人。注意不能只在词前找空白/逗号：
  // 实测「而自己，赤裸的身体上还残留着…」里「自己」前面是「而」，旧正则漏判，
  // 于是又靠 subjectEvidence 把李斌的裸体记到她账上。这里直接按主语词判。
  if (/自己(?!的)/.test(evidence) || /(^|[^其])他(?!的)/.test(evidence)) return false;
  return aliases.some((name) => {
    const at = subjectEvidence.indexOf(name);
    if (at < 0) return false;
    const after = subjectEvidence.slice(at + name.length, at + name.length + 1);
    return after !== '的' && after !== '之';
  });
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
    else if (c.evidence && !ownerBoundAction(c.evidence, subjectQuote, aliases)) {
      reason = '证据句里的穿脱动作没有落在该人物身上（名字只是领属定语，或动作主语是别人）';
    }
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
          // 露着/半露是画面事实，必须让模型每楼都看见，否则它只当「穿在身上」。
          piece.state?.exposure === 'bare'
            ? '露着'
            : piece.state?.exposure === 'partial'
              ? '半露'
              : '',
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
  // ── 情趣内衣 / 束具 ──
  // 必须排在最前：「情趣睡衣」「蕾丝睡裙」里含「睡衣/睡裙」，排在后面会被 pajamas 抢走，
  // 账本记成普通睡衣，画面里那套情趣装就没了；「情趣内衣」则会被 bra 抢走。
  [/情趣睡衣|情趣内衣|情趣套装|情趣装|蕾丝内衣|镂空内衣|网纱内衣|半透明内衣|开裆连体衣|连体情趣|情趣吊带|蕾丝睡裙|网纱睡裙/, 'lingerie'],
  // ── 睡眠 / 家居 ──
  // 必须排在「裙」「裤」前面:睡裙会被 skirt 抢走、睡裤会被 pants 抢走,
  // 结果「换上睡衣」这句认不出衣物 → adoptChangedClothing 直接 return,
  // 账本停在白天那套 —— 用户看到的「剧情说换了睡衣,图里还是原来那套」。
  [/睡裙|睡袍|浴袍|睡衣裤|睡裤|睡衣|家居服|居家服|晨衣|吊带睡裙|真丝睡裙/, 'pajamas'],
  // ── 泳装 ──
  // 必须排在「裙」「裤」前面：「沙滩裙」「泳裤」会被后两条抢走。
  [/连体泳衣|竞泳泳装|泳衣|泳装|泳裤|比基尼|死库水|沙滩裙|竞泳|三角泳裤|平角泳裤/, 'swimsuit'],
  // 袜带/束具戴在身上但不遮挡任何部位；渲染成 tag 时照英文原样输出。
  [/吊袜带|袜带|束具|皮质束具|皮质绑带|束带|胸背带|乳贴|胸贴/, 'garter belt'],
  // 连体裤是整身衣物,必须排在「裤」之前:当成半身长裤后上半身仍记为穿着,
  // 「脱掉连体裤」永远判不出 nude。
  [/连体裤|连身裤|吊带裤/, 'jumpsuit'],
  // ── 牛仔系(先具体后笼统) ──
  [/短牛仔裤|牛仔短裤/, 'denim shorts'],
  [/长牛仔裤|直筒牛仔裤|紧身牛仔裤|破洞牛仔裤/, 'long jeans'],
  [/牛仔裤/, 'jeans'],
  // ── 内裤系必须排在「裤」之前 ──
  [/开裆裤|开裆内裤|丁字裤|三角裤|安全裤|无痕内裤|珍珠内裤|内裤|底裤|亵裤/, 'panties'],
  // ── 整身裙装 / 各时代长衣 ──
  [/婚纱|礼服裙|晚礼服|礼裙|舞会裙|敬酒服/, 'wedding dress'],
  [/旗袍|旗装|长衫/, 'cheongsam'],
  [/汉服|襦裙|曲裾|齐胸|直裾|袄裙|褙子|明制|宋制|唐制|深衣/, 'hanfu'],
  [/和服|浴衣|振袖|留袖|羽织/, 'kimono'],
  [/韩服|纱丽|奥黛/, 'hanbok'],
  [/道袍|法袍|僧袍|袈裟|长袍|法衣|巫女服|魔女袍|罩袍|大氅|白袍/, 'robe'],
  [/乳胶衣|胶衣|连体紧身衣|全身紧身衣|紧身衣|连体衣|连身衣|体操服|zentai/, 'bodysuit'],
  // 制服类整身衣物：单列并给出各自的具体英文词，否则「女仆装」「白大褂」会被散装上衣/裙抢走，
  // 而且全压成 `uniform` 之后画面里那件衣服就没了辨识度。
  [/女仆装/, 'maid outfit'],
  [/护士服/, 'nurse uniform'],
  [/啦啦队服/, 'cheerleader outfit'],
  [/水手服|jk制服|JK制服|学生装|校服/, 'serafuku'],
  [/空姐制服|教师装|服务生制服/, 'uniform'],
  [/军装|警服/, 'military uniform'],
  [/白大褂|手术服/, 'labcoat'],
  [/修女服/, 'nun habit'],
  [/兔女郎/, 'bunny girl'],
  [/围裙装|围裙/, 'apron'],
  [/连衣裙|洋装|连身裙|裙装|吊带裙/, 'dress'],
  // ── 袜类必须排在「吊带」之前，否则「吊带袜」会被拆成吊带 ──
  [/吊带袜|渔网袜|网袜|连裤袜|丝袜|长袜|短袜|袜圈|袜/, 'pantyhose'],
  // ── 半身裙(先具体后笼统) ──
  [/百褶裙|超短裙|迷你裙|包臀裙|铅笔裙|鱼尾裙|a字裙|A字裙|伞裙|蛋糕裙|蓬蓬裙|纱裙/, 'pleated skirt'],
  [/衬裙|裙撑/, 'skirt'],
  // 沙滩裙是泳装的一类（`CORE_SWIM_ZH` 里有），必须排在「裙」条子之前，
  // 否则它会被记成半身裙：换泳装的整条事件落成「换了一条裙子」，泳装那次全没了。
  [/沙滩裙|沙滩装/, 'swimsuit'],
  [/牛仔裙|皮裙|工装裙|开衩裙|露背裙|半身裙|长裙|短裙|裙子|裙/, 'skirt'],
  // ── 裤装(先具体后笼统) ──
  [/阔腿裤|西装裤|西裤|休闲裤|运动裤|灯笼裤|喇叭裤|哈伦裤|打底裤|瑜伽裤|皮裤|工装裤|背带裤|七分裤|九分裤|骑行裤|马裤/, 'pants'],
  [/长裤|裤子|裤装|裤/, 'pants'],
  [/短裤|热裤/, 'shorts'],
  // ── 上装 ──
  [/白衬衫|衬衫|衬衣|雪纺衫|上衣/, 'shirt'],
  [/t恤|T恤|短袖/, 't-shirt'],
  [/吊带衫|吊带|背心/, 'camisole'],
  [/卫衣|连帽衫/, 'hoodie'],
  [/毛衣|针织衫|开衫|罩衫|线衣/, 'sweater'],
  [/抹胸|肚兜|兜肚|束胸|裹胸|胸围|运动内衣/, 'bra'],
  [/文胸|胸罩|乳罩|内衣|奶罩/, 'bra'],
  // ── 外套 ──
  [/羽绒服|冲锋衣|风衣|大衣|外套|夹克|皮衣|机车夹克|牛仔外套|棉袄|小袄|坎肩|披风|斗篷|披肩|雨衣|西装/, 'jacket'],
  // ── 鞋 ──
  [/高跟鞋|细高跟|长靴|短靴|靴子|皮鞋|运动鞋|帆布鞋|拖鞋|木屐|凉鞋|玛丽珍/, 'shoes'],
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
  [/米|卡其|杏/, 'beige'],
  [/棕|褐|咖啡|栗/, 'brown'],
  [/橙|橘/, 'orange'],
  [/青|天蓝|藏青/, 'navy'],
  [/金/, 'gold'],
  [/银/, 'silver'],
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
      .filter(Boolean)
      // 饰物不进服装账本（见 bodyClothing）：发夹、耳环归外观字段。
      .filter(bodyClothing);
    const wear = readWear(c.tag);
    // 只剩饰物时不要建账：否则 legacyRecord 会造出一条 design 为空的空衣服。
    if (!parts.length && !source) continue;
    if (!parts.length && wear.wear === 'worn') {
      const storyOnly = source
        ? storyGarmentNear(source, [name, c.name, ...characterAliases(name)], image.sourceLine, image.charOffset ?? 0)
        : '';
      if (!storyOnly) continue;
    }
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
const CLOTHING_WORD = /\b(?:dress|sundress|gown|wedding dress|evening gown|shirt|t-shirt|skirt|miniskirt|pleated skirt|pants|trousers|slacks|shorts|jeans|jacket|blazer|coat|raincoat|trench ?coat|windbreaker|overcoat|suit|tailcoat|armou?r|breastplate|chainmail|jersey|bra|bralette|sports bra|bustier|corset|panties|underwear|lingerie|babydoll|teddy|chemise|negligee|bodystocking|stockings|thighhighs|kneehighs|pantyhose|tights|fishnets|garter belt|garter straps?|harness|pasties|socks|shoes|boots|heels|sneakers|loafers|sandals|slippers|uniform|serafuku|sailor uniform|hanfu|hanbok|sari|kimono|yukata|robe|bathrobe|petticoat|crinoline|bustle|collar|sleeves?|clothes|clothing|outfit|sash|belt|cloak|cape|capelet|shawl|gloves|mittens|swimsuit|swimwear|bikini|monokini|tankini|apron|hoodie|sweater|pullover|cardigan|blouse|tunic|leotard|unitard|bodysuit|jumpsuit|playsuit|romper|overalls|dungarees|ruqun|hakama|yukata|obi|geta|miko|qipao|cheongsam|necktie|bow ?tie|neckerchief|sailor collar|neck ribbon|bloomers|buruma|sarong|poncho|dudou|chest wrap|underpants|undergarment|pajamas|pyjamas|nightgown|nightdress|nightwear|sleepwear|housewear|thong|g-string|crotchless panties|crotchless bodysuit|boyshorts|boxers|trunks|tube top|camisole|tank top|crop top|halterneck|labcoat|maid outfit|maid uniform|nurse uniform|cheerleader outfit|bunny girl|nun habit|military uniform|catsuit|zentai|hosiery|mary janes|denim shorts|long jeans|wide-leg pants|cargo pants|pencil skirt|denim jacket|leather jacket|down jacket|bustier|teddy|lace lingerie)\b/i;
/** 戴在头上、脸上、脖子或腕上的饰物：归 appearance 的 extra，服装层不许把它当衣服剥掉。 */
const BODY_ORNAMENT =
  /\b(?:hair ribbon|hair band|hairband|hairpin|hair clip|hair ornament|ribbon|\b(?:neck|choker|circlet|tiara|ankle|wrist) ?(?:lace|band|ribbon|chain|let|cuffs?)\b|glasses|mask|earrings?|earring|piercing|necklace|pendant|choker|bracelet|bangle|anklet|ring|beret|headband|veil|crown)/i;
const WEAR_WORD = /\b(?:nude|naked|topless|bottomless|fully clothed|off shoulder|breasts out|undressed)\b/i;
const CLOTHING_ACTION = /\b(?:holding|grabbing|pulling|lifting|tugging|unbuttoning|taking off|removing)\b/i;
/**
 * Base tag 只写「整幅画面共有」的东西。模型常把一个人的表情与视线塞进 Base
 * （实测第 0 楼 Base 里同时出现 `looking down, closed mouth`，角色块里又写一遍），
 * 同一个概念在 base_caption 与 char_caption 里各算一份权重，画面就被这一个概念拽走。
 * 这里把表情、视线、口部状态从 Base 剥掉；`looking at another` 这类双人关系词保留。
 */
const BASE_PERSONAL =
  /^(?:looking (?:away|down|up|to the side|back)|closed mouth|open mouth|parted lips|smile|light smile|sad smile|smirk|grin|frown|pout|blush|heavy blush|full-face blush|tears|streaming tears|sweat|sweatdrop|expressionless|emotionless|stare|blank stare|wide-eyed|half-closed eyes|closed eyes|one eye closed|wink|shy|embarrassed|nervous|worried|surprised|shocked|scared|angry|annoyed|disgust|sleepy|sigh|laughing|cheek bulge|clenched teeth|tongue out|licking lips|heart-shaped pupils|sparkling eyes|upturned eyes|seductive smile|naughty face|forced smile|evil smile|shivering|trembling|eye contact|ahegao)$/i;
export function stripBasePersonal(tag: string): string {
  const tokens = tag.split(',').map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return tag;
  return tokens.filter((t) => !BASE_PERSONAL.test(t)).join(', ');
}

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
  // 内层（内衣/内裤）只有在外层没盖住时才该出现在 tag 里。
  // 扣好的衬衫 + 牛仔裤里再写 pink bra / panties，画面会照着这句话把内衣画出来
  // （实测第 2 楼次日出门就带着 pink bra）。账本仍然记着它们穿着，只是不出镜。
  const INNER_KINDS = new Set(['bra', 'panties', 'lingerie']);
  const conceals = (upperHalf: boolean) =>
    record.pieces.some((other) => {
      const state = other.state ?? {};
      if (!['worn'].includes(String(state.location))) return false;
      if (INNER_KINDS.has(garmentKind(other.design))) return false;
      const cover = covers(garmentKind(other.design));
      if (upperHalf ? !cover.upper : !cover.lower) return false;
      // carried(搭在手臂上/拎着)与 lifted 一样不算「盖住身体」。
      if ((state.arrangement ?? 'normal') !== 'normal') return false;
      if (state.exposure === 'bare' || state.exposure === 'partial') return false;
      return (state.fastening ?? 'closed') !== 'open';
    });
  const upperConcealed = conceals(true);
  const lowerConcealed = conceals(false);
  // 由外到内渲染:画面按 tag 顺序分配权重,内衣写在衬衫前面会被画在外层。
  // stable sort 保留同一层内的原有顺序(衣物本来是什么顺序还是什么顺序)。
  const ordered = record.pieces
    .map((piece, index) => ({ piece, index }))
    .sort((a, b) => layerOf(a.piece.design) - layerOf(b.piece.design) || a.index - b.index)
    .map(({ piece }) => piece);
  for (const p of ordered) {
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
        // 旧账本把整串「open shirt, pulled down」存在 state.legacy 里，而那一串
        // 描述的是**穿在身上时的样子**。部件已经脱下来时再把它塞进 prompt，
        // 等于告诉画面「她还敞着衬衫」——第 16 楼第二张图浴缸里那身白衬衫就是这么来的。
        // 脱下之后只留「不穿」的结论，旧词一律丢掉。
        if (location === 'removed' && s.legacy) continue;
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
    // 被外层完整盖住的内衣裤不出镜（状态仍在账本里，下一楼掀开时会自动出现）。
    const inner = INNER_KINDS.has(kind);
    const hiddenByOuter =
      inner &&
      (s.exposure === undefined || s.exposure === 'covered') &&
      (s.arrangement ?? 'normal') === 'normal' &&
      (upper && upperConcealed ? true : lower && lowerConcealed ? true : false);
    if (hiddenByOuter) continue;
    tags.push(englishDesign(stripPossessive(p.design).design));
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
    if (p.design) sentences.push(`Wearing ${englishDesign(stripPossessive(p.design).design)}${detail ? `, ${detail}` : ''}.`);
  }
  // 上下两个半身都没有被任何衣物盖住就是 nude。
  // 只看 removed 标记不够：只戴着袜带、束具、项圈这类不遮挡身体的东西时，
  // 账本里没有任何一件 removed，旧判据会输出「garter belt, harness」而没有 nude，
  // 画面于是给她画上了一身看不见的衣服。
  // 判出 nude 时要把「真的没穿」写死，光一个 nude 不够。
  //
  // 实测（NAI 4.5 full，同一份 tag 只换这一行，四组 A/B 出图比对）：
  //   `nude`                                     → 仍然给她画了一身白色薄纱内衣
  //   `unclothed, nude`                          → 同上，还是有内衣
  //   `completely nude, naked, nipples`           → 真的全裸
  //   `completely nude, naked, topless, bottomless, nipples, pussy` → 真的全裸
  // 原因：账本里根本不存在 bra/panties 这两件，NAI 只会把「nude + 没有内衣词」
  // 当作「穿着某种没写出来的内搭」，于是自动补一套看不见的内衣。
  // 解决办法是把否定与肯定两端都写出来（completely nude / naked / nipples），
  // 并且显式 no bra / no panties。这些都是 danbooru 既有常用词。
  const NUDE_TAG = ['completely nude', 'naked', 'nipples', 'no bra', 'no panties'];
  if (record.pieces.length && !upperWorn && !lowerWorn) tags.push(...NUDE_TAG);
  else if (upperRemoved && !upperWorn && lowerRemoved && !lowerWorn) tags.push(...NUDE_TAG);
  else {
    // 半裸同样要说死：只写 topless 时 NAI 会补一件内衣，实测见上面的 A/B。
    if (upperRemoved && !upperWorn) tags.push('topless', 'breasts out', 'no bra');
    if (lowerRemoved && !lowerWorn) tags.push('bottomless', 'pussy', 'no panties');
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
const CORE_SWIM_ZH = /泳衣|泳装|泳裤|比基尼|死库水|连体泳衣|竞泳|沙滩装|沙滩裙/;
const GARMENT_KINDS: Array<[RegExp, string]> = [
  // 情趣内衣必须排在睡衣之前：「情趣睡衣」「蕾丝睡裙」里含「睡衣/睡裙」，
  // 排在后面就会被 pajamas 抢走 —— 账本记成普通睡衣，画面里那套情趣装就没了。
  // 缺这一类的后果不是「少一个标签」：garmentKind 返回空串，部件 ID 落到 piece，
  // patch 被判「未知衣物部件」，换情趣装整条被丢弃。
  [/\b(?:lingerie|babydoll|teddy|chemise|negligee|bodystocking|crotchless bodysuit)\b/i, 'lingerie'],
  [/开裆连体衣/, 'lingerie'],
  [/情趣|蕾丝内衣|镂空内衣|网纱内衣|半透明内衣|连体情趣|蕾丝睡裙|网纱睡裙/, 'lingerie'],
  // 开裆内裤不是情趣套装：lingerie 在 covers() 里算「上下半身都盖住」，
  // 记成 lingerie 会让「只穿一条开裆内裤」判不出下半身露出来。
  [/开裆裤|开裆内裤/, 'panties'],
  // 袜带 / 束具：戴在身上但**不遮挡**任何部位，covers() 两个半身都必须算没穿，
  // 否则「只戴着袜带和束具」会被判成穿着完整，nude / topless 全出不来。
  [/\b(?:garter belt|garter straps?|harness|pasties|nipple covers?)\b/i, 'accessory'],
  [/吊袜带|袜带|束具|束带|胸背带|乳贴|胸贴|皮质绑带|obi|gloves|belt/, 'accessory'],
  // 睡衣排在「裙」「裤」之前:它同时盖住上半身和下半身,而且「睡裙」「睡裤」会被后面的
  // 「裙」「裤」条子抢走 —— 抢走之后就变成「换了一条裙子」而不是换睡衣,
  // 上装留在账本里,图里于是还是原来那套。
  [
    /\b(?:pajamas|pyjamas|nightgown|nightdress|nightwear|bathrobe|sleepwear|housewear)\b/i,
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
  // 连体裤 / 连身裤是整身衣物，必须排在「裤」条子之前。
  [/\bjumpsuit\b/i, 'dress'],
  [/连体裤|连身裤|吊带裤/, 'dress'],
  // 铠甲算上装：脱掉之后上衣层随之清空，否则「铠甲脱了」图里还穿着。
  [/\b(?:armou?r|breastplate|chainmail|platemail)\b/i, 'shirt'],
  [/铠甲|皮甲|锁子甲|板甲|护甲|胸甲/, 'shirt'],
  // 各时代民族服饰与衬裙
  [/\b(?:hanbok|sari|ao dai)\b/i, 'dress'],
  [/韩服|纱丽|奥黛/, 'dress'],
  [/\b(?:petticoat|crinoline|bustle)\b/i, 'skirt'],
  [/衬裙|裙撑/, 'skirt'],

  // 制服类整身衣物：`maid outfit`/`nurse uniform` 这类词 dress 条子认不到，
  // 落到整身衣物里才能整套换、也才能算进 covers() 的上下半身。
  [
    /\b(?:maid outfit|maid uniform|nurse outfit|nurse uniform|cheerleader outfit|apron dress|sailor suit|serafuku|labcoat|bunny girl|nun habit|military uniform)\b/i,
    'dress',
  ],
  [/女仆装|护士服|啦啦队服|学生装|水手服|军装|警服|白大褂|手术服|修女服|兔女郎|空姐制服|教师装|服务生制服/, 'dress'],
  [/\bbralette\b/i, 'bra'],
  [/\bapron\b|围裙/, 'shirt'],
  // 「打底裤 / 瑜伽裤」必须在下面那条「瑜伽服」之前认下来：它含「瑜伽服」的词根，
  // 排在后面会被记成上衣，于是「脱掉打底裤」被记成脱上衣、下半身一直没脱。
  [/打底裤|瑜伽裤|紧身裤/, 'pants'],
  [/瑜伽服|瑜伽裤|雪纺衫|吊带衫/, 'shirt'],
  [
    /\b(?:dress|sundress|frock|robe|kimono|yukata|qipao|cheongsam|hanfu|ruqun|ao dai|gown|jumpsuit|bodysuit|leotard|unitard|uniform|serafuku|sailor uniform|one-piece)\b/i,
    'dress',
  ],
  [
    // 中文款式也要认:正文写「白连衣」「连衣裙」「旗袍」时账本里就是中文 design,
    // 认不出来 → 脱了也渲染不出 `no dress`,画面照旧穿得整整齐齐。
    /连衣裙|连身裙|吊带裙|连衣|裙装|制服|水手服|军装|警服|空姐|教师装|修女服|手术服|服务生制服|兔女郎|深衣|长衫|白袍|罩袍|大氅|巫女服|魔女袍|校服|敬礼服|敬酒服|洋装|乳胶衣|胶衣|连身衣|catsuit|zentai|hakama|旗袍|旗装|汉服|襦裙|曲裾|直裾|袄裙|褙子|齐胸|和服|浴衣|振袖|留袖|羽织|韩服|纱丽|奥黛|礼服|婚纱|长袍|道袍|僧袍|袈裟|法衣|白大褂|紧身衣|连体衣|体操服/,
    'dress',
  ],
  [/\b(?:panties|underwear|underpants|briefs|thong|panty)\b/i, 'panties'],
  [/内裤|底裤|亵裤|丁字裤|三角裤|安全裤|boyshorts|boxers/, 'panties'],
  [/\b(?:bra|lingerie|bikini top|bandeau)\b/i, 'bra'],
  [/胸罩|文胸|奶罩|抹胸|内衣|乳罩|裹胸|胸围|兜肚|肚兜|束胸/, 'bra'],
  [
    /\b(?:shirt|blouse|camisole|sweater|sweatshirt|hoodie|t-shirt|tank top|crop top|turtleneck|corset|tunic|dudou|chest wrap)\b/i,
    'shirt',
  ],
  [
    /衬衫|衬衣|上衣|恤|T恤|背心|吊带(?!袜)|毛衣|卫衣|针织衫|开衫|罩衫|小褂|短褂|褂子|兜肚|肚兜|束胸|短袖|束腰|corset|连帽衫|线衣|束腰|poncho|jersey|tube top/,
    'shirt',
  ],
  // 「吊带袜 / 长筒袜 / 连裤袜」不能被上面那条「吊带」吃掉：shirt 正则里已用
  // `吊带(?!袜)` 排掉；「连裤袜」也不会命中「裤」，因为 socks 条子在 pants 之前。
  [/吊带袜|长筒袜|大腿袜|连裤袜|网袜|丝袜/, 'socks'],
  [/\b(?:mini|micro|pleated|pencil|a-line|wrap|tiered|long|short)?\s?skirts?\b/i, 'skirt'],
  [/(?<!连衣)(?<!连身)裙(?!装)/, 'skirt'],
  [/\b(?:pants|trousers|jeans|shorts|leggings|culottes|overalls|dungarees|joggers)\b/i, 'pants'],
  [/牛仔裤|长裤|短裤|裤子|裤装|西裤|休闲裤|运动裤|打底裤|皮裤|热裤|工装裤|背带裤|瑜伽裤|阔腿裤|灯笼裤|喇叭裤|哈伦裤|七分裤|九分裤|骑行裤|马裤|bloomers|buruma|trunks|slacks|sarong/, 'pants'],
  [/\b(?:jacket|blazer|coat|raincoat|trench ?coat|cloak|cape|cardigan|suit|tuxedo|waistcoat|vest)\b/i, 'jacket'],
  // 「西装裤」含「西装」，排在下面那条 jacket 之后会被记成外套。
  [/西装裤/, 'pants'],
  [/外套|夹克|大衣|西装|风衣|皮衣|羽绒服|冲锋衣|牛仔外套|马甲|披风|斗篷|披肩|小袄|棉袄|坎肩|雨衣|shawl|scarf|windbreaker/, 'jacket'],
  [/\b(?:socks|stockings|thighhighs|pantyhose|tights|leg ?warmers)\b/i, 'socks'],
  [/丝袜|长袜|短袜|连裤袜|网袜|fishnets|袜/, 'socks'],
  [/\b(?:shoes|boots|heels|slippers|sneakers|sandals|loafers)\b/i, 'shoes'],
  [/高跟鞋|皮鞋|靴|鞋|细高跟|木屐|玛丽珍|geta|mary janes/, 'shoes'],
];
export function garmentKind(design: string): string {
  const value = String(design ?? '');
  for (const [expression, kind] of GARMENT_KINDS) if (expression.test(value)) return kind;
  return '';
}
const DESIGN_EN: Record<string, string> = {
  accessory: 'garter belt',
  lingerie: 'lingerie',
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
 * 中文款式 → 具体英文 tag。优先级高于「品类兜底」。
 *
 * 为什么要单列一张表：品类（garmentKind）只够用来算部件 ID 与上下半身，
 * 它把「汉服」「和服」「婚纱」全压成 `dress`，画面里那件衣服就没了特色 ——
 * 剧情写「她换上一身红色汉服」，出图变成普通红裙。这里给每个时代/题材
 * 各留一个精确词，认不出时再退回品类兜底。
 */
const DESIGN_WORD: Array<[RegExp, string]> = [
  // 古代东亚
  [/汉服|襦裙|曲裾|齐胸|直裾|袄裙|褙子|明制|宋制|唐制/, 'hanfu'],
  [/旗袍|旗装|长衫/, 'cheongsam'],
  [/和服|振袖|留袖|羽织/, 'kimono'],
  [/浴衣/, 'yukata'],
  [/韩服/, 'hanbok'],
  [/纱丽/, 'sari'],
  [/奥黛/, 'ao dai'],
  [/道袍|法袍|僧袍|袈裟|法衣|巫女服|魔女袍|罩袍|大氅|白袍|长袍/, 'robe'],
  // 西式礼服
  [/婚纱|礼服裙|晚礼服|礼裙|舞会裙|敬酒服/, 'wedding dress'],
  [/衬裙|裙撑/, 'petticoat'],
  // 制服
  [/女仆装/, 'maid outfit'],
  [/护士服/, 'nurse uniform'],
  [/啦啦队服/, 'cheerleader outfit'],
  [/水手服|jk制服|JK制服|学生装|校服/, 'serafuku'],
  [/空姐制服|教师装|服务生制服/, 'uniform'],
  [/军装|警服/, 'military uniform'],
  [/白大褂|手术服/, 'labcoat'],
  [/修女服/, 'nun habit'],
  [/兔女郎/, 'bunny girl'],
  [/围裙装|围裙/, 'apron'],
  // 贴身 / 情趣
  [/情趣|蕾丝内衣|镂空内衣|网纱内衣|半透明内衣|连体情趣|情趣吊带/, 'lingerie'],
  [/蕾丝睡裙|网纱睡裙/, 'lace lingerie'],
  [/吊袜带|袜带|garter/, 'garter belt'],
  [/束具|皮质绑带|束带|胸背带/, 'harness'],
  [/乳贴|胸贴/, 'pasties'],
  [/开裆裤|开裆内裤/, 'crotchless panties'],
  [/丁字裤/, 'thong'],
  [/开裆连体衣/, 'crotchless bodysuit'],
  // 现代日常（半身）
  [/百褶裙/, 'pleated skirt'],
  [/超短裙|迷你裙/, 'miniskirt'],
  [/包臀裙|铅笔裙/, 'pencil skirt'],
  [/牛仔裙/, 'denim skirt'],
  [/阔腿裤/, 'wide-leg pants'],
  [/西装裤|西裤/, 'slacks'],
  [/工装裤/, 'cargo pants'],
  [/背带裤/, 'overalls'],
  [/打底裤|瑜伽裤/, 'leggings'],
  [/牛仔短裤|短牛仔裤/, 'denim shorts'],
  [/长牛仔裤|直筒牛仔裤|紧身牛仔裤|破洞牛仔裤/, 'jeans'],
  [/短裤|热裤/, 'shorts'],
  [/吊带袜|渔网袜|网袜/, 'fishnets'],
  [/连裤袜|丝袜/, 'pantyhose'],
  [/长靴/, 'boots'],
  [/高跟鞋|细高跟/, 'high heels'],
  [/帆布鞋|运动鞋/, 'sneakers'],
  [/拖鞋/, 'slippers'],
  [/木屐/, 'geta'],
  [/玛丽珍/, 'mary janes'],
  // 整身
  [/连体裤|连身裤|吊带裤/, 'jumpsuit'],
  [/乳胶衣|胶衣|全身紧身衣|连体紧身衣/, 'bodysuit'],
  [/紧身衣|连体衣|连身衣|体操服|zentai/, 'leotard'],
  [/吊带裙/, 'slip dress'],
  [/洋装|连衣裙|连身裙|裙装/, 'dress'],
  [/针织衫|毛衣|线衣/, 'sweater'],
  [/开衫|罩衫/, 'cardigan'],
  [/卫衣|连帽衫/, 'hoodie'],
  [/t恤|T恤|短袖/, 't-shirt'],
  [/吊带衫|吊带|背心/, 'camisole'],
  [/抹胸/, 'tube top'],
  [/束腰/, 'corset'],
  [/肚兜|兜肚|束胸/, 'dudou'],
  [/羽绒服/, 'down jacket'],
  [/冲锋衣/, 'windbreaker'],
  [/皮衣|机车夹克/, 'leather jacket'],
  [/牛仔外套/, 'denim jacket'],
  [/西装/, 'suit'],
  [/马甲|坎肩/, 'vest'],
  [/旅袍|披风|斗篷/, 'cloak'],
  [/披肩/, 'shawl'],
  [/雨衣/, 'raincoat'],
  [/铠甲|皮甲|锁子甲|板甲|护甲|胸甲/, 'armor'],
];
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
  const colour = PROSE_COLOR.find(([expr]) => expr.test(value))?.[1] ?? '';
  const specific = DESIGN_WORD.find(([expr]) => expr.test(value))?.[1];
  // 「长裙」「短裙」是半身裙，只是长度不是款式：先排掉，别被 DESIGN_WORD 里的整身词抢走。
  const half = /(?<!连衣)(?<!连身)(?:长|短|百褶|半身|包臀|伞)裙|裙摆/.test(value) && !/连衣裙|连身裙|连体/.test(value);
  const kind = half ? 'skirt' : garmentKind(value);
  const base = specific ?? DESIGN_EN[kind];
  if (!base) return value;
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
/**
 * 这件东西是不是「会随洗澡/换衣被脱掉的身体衣物」。
 *
 * 发夹、项链、耳环这类饰物归外观（extra），不进服装账本：
 * 它们被当成衣服记下来以后，浴室场景推断会给它写 location=floor + wet，
 * 于是女主洗完澡之后头上那根发夹永远「湿着放在地上」，而画面里她其实一直戴着。
 * 判定沿用 garmentKind：空串（认不出的描写）与 accessory 都不算身体衣物。
 */
function bodyClothing(design: string): boolean {
  const kind = garmentKind(String(design ?? ''));
  return !!kind && kind !== 'accessory';
}
/**
 * 历史账本里已经被写进去的饰物部件（第 4 楼把发夹记成「湿着放在地上」）。
 *
 * `bodyClothing` 只在新建记录时拦，读到旧记录时旧部件照样在，于是发夹会跟着
 * 一路被 `clothingCaption` 渲染成一件衣服、也会被浴室场景记成湿的。这里在读入
 * 账本时统一剔除：饰物归 appearance 的 extra，不该出现在服装账本里。
 */
function pruneOrnaments(record: ClothingRecord): ClothingRecord {
  if (!record?.pieces?.length) return record;
  const kept = record.pieces.filter((piece) => bodyClothing(piece.design));
  if (kept.length === record.pieces.length) return record;
  return { ...record, pieces: kept };
}
/**
 * 引号里的内容是台词或回忆，不是「此刻正在发生」的动作。
 *
 * 「按主人的吩咐，茉莉全裸地绑上礼物彩带，在洗澡的时候把自己送给哥哥了。」
 * 是她在复述过去，旧版直接把这句当本楼剧情，整身记 floor + wet。
 */
function quotedMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  const pairs: Record<string, string> = { '「': '」', '『': '』', '“': '”', '‘': '’' };
  let open = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!open) {
      if (pairs[ch]) {
        open = pairs[ch];
        mask[i] = 1;
      } else if (ch === '"' || ch === '\'') {
        open = ch;
        mask[i] = 1;
      }
      continue;
    }
    mask[i] = 1;
    if (ch === open) open = '';
  }
  return mask;
}
/** 性行为进行中的证据：这几层不能把人「穿回去」。 */
const SEX_ACT =
  /肉棒|阴茎|龟头|阴蒂|小穴|内射|射精|精液|口穴|吞精|吞吐|高潮|抽插|插入|做爱|性交|交合|交欢|口交|乳交|骑乘/;
/** 旧版账本里遗留的走光词（模型当时写进 tag 的），一样会陈旧。 */
const LEGACY_WEAR =
  /\b(?:off shoulder|breasts out|panties aside|panties down|pants down|skirt lift|clothes around|clothes down|open shirt|open jacket|open clothes|loose clothes|sleeves rolled up|torn clothes|wet clothes|no panties|no bra|nude|topless|bottomless|cleavage|pussy|underwear only)\b/i;
/**
 * 衣物层号:由外到内。渲染时按层号排序,画面才不会把「内衣写在衬衫后面」
 * 这种顺序当成真的一层层穿在外面。
 */
const LAYER_OF: Record<string, number> = {
  jacket: 1,
  coat: 1,
  dress: 2,
  pajamas: 2,
  swim: 2,
  shirt: 2,
  skirts: 3,
  skirt: 3,
  pants: 3,
  lingerie: 3,
  bra: 4,
  panties: 4,
  socks: 5,
  stockings: 5,
};
function layerOf(design: string): number {
  return LAYER_OF[garmentKind(design)] ?? 6;
}
/**
 * 这件衣服是不是别人的(他的外套披在她肩上)。
 *
 * 只剥掉领属前缀并把归属记进账本:画面里她确实披着件外套,但
 * 那件外套不属于她的衣橱,脱下来要还回去,也不该在后续楼层被当成
 * 「她的外套」继续穿。
 */
function stripPossessive(design: string): { design: string; holder?: string } {
  const value = String(design ?? '').trim();
  const zh = value.match(/^([^\s,，、]{1,6})的(\S.*)$/);
  if (zh && !/^自己$/.test(zh[1])) return { design: zh[2], holder: zh[1] };
  const en = value.match(/^(?:his|her)\s+(.+)$/i);
  if (en) return { design: en[1], holder: 'other' };
  return { design: value };
}
function covers(kind: string): { upper: boolean; lower: boolean; both: boolean } {
  // pajamas 是一整套(上衣＋睡裤/睡裙)，它必须同时算上、下两个半身：
  // 只算 a半身的话，脱睡衣时另一半身仍被记为「穿着」，clothingCaption 就永远
  // 走不到 nude/topless 那一支，画面停在「还穿着白天那套」。
  const both = kind === 'dress' || kind === 'pajamas' || kind === 'swim' || kind === 'lingerie';
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
  // 「只解开最上面一颗扣」不是「整件敞开」：前者是 loose，后者才是 open。
  // 旧版一律记 open，clothingCaption 就渲染成 open shirt/unbuttoned，画面直接敞开。
  const partialOpen =
    /(?:解开|解了|松开|拉低)[^，。！？；]{0,6}(?:一颗|一粒|最上面一?颗|第一颗|上数|顶上一?颗)|(?:最上面|第一颗|第一粒|顶上一?颗)[^，。！？；]{0,6}(?:扣|纽扣)/.test(
      evidence,
    );
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
  if (open) state.fastening = partialOpen ? 'loose' : 'open';
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

/** 衣物名词的起点（只用来定位「谁的」这件衣服，不参与品类识别）。 */
const GARMENT_NOUN =
  /衣服|衣物|衣裳|衣衫|衣裤|衣领|衣襟|上衣|衬衫|内衣|内裤|胸罩|文胸|裤子|裙子|裙摆|裙腰|外套|睡衣|睡裙|睡裤|泳衣|泳装|比基尼|礼服|旗袍|汉服|和服|浴衣|浴袍|吊带|背心|丝袜|裤袜|袜/;

/**
 * 这件衣服穿在**谁**身上。
 *
 * 脱衣的动作主语常常是施动者，而不是被脱的人：「李斌…双手娴熟的褪下温婉的衣服和裤子」
 * 里 `subjectOf` 取的是本句最先出现的名字「李斌」，而李斌账本里根本没有记录，于是
 * `if (!record) continue` 把整条事件丢掉 —— 正文写着衣服裤子都褪下了，图里她还穿着白衬衫。
 *
 * 服装账本关心的是**衣服的归属**，不是动作的执行者。中文里归属几乎总写成
 * 「名字＋的＋衣物」（「温婉的衣服」「温婉的内裤」），所以取离衣物名词最近的那个前面的名字；
 * 找不到（「她脱下自己的内裤」）再退回 `subjectOf`。
 */
function wearerOf(scope: string, entries: CharTagEntry[], known?: (name: string) => boolean): string {
  let best = '';
  let bestGap = Infinity;
  for (const match of scope.matchAll(new RegExp(GARMENT_NOUN.source, 'g'))) {
    const at = match.index ?? 0;
    const before = scope.slice(Math.max(0, at - 12), at);
    for (const entry of entries) {
      if (known && !known(entry.name)) continue;
      for (const name of [entry.name, ...characterAliases(entry.name)]) {
        const pos = before.lastIndexOf(name);
        if (pos < 0) continue;
        const gap = before.length - pos - name.length;
        if (gap < bestGap) {
          bestGap = gap;
          best = entry.name;
        }
      }
    }
  }
  return best;
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
 * 这一段正文里的裸露/性描写，是不是写她本人。
 *
 * 旧判据只看「这段有没有裸露字样」。真实小说里男主洗澡、自慰、裸着走出浴室是常态，
 * 这些句子一样带「赤裸」「精液」，于是女主的裸体 tag 被放行——第 7 节她只是上楼回家，
 * 出图却是全身裸。归属判据：同一句里要有她的名字，或以「她」开头。
 */
function nudityBelongsTo(text: string, aliases: readonly string[]): boolean {
  const body = String(text ?? '');
  if (!body.trim()) return false;
  for (const sentence of body.split(/[。！？；\n]/)) {
    if (!NUDITY_HINT.test(sentence)) continue;
    if (aliases.some((name) => name && sentence.includes(name))) return true;
    if (/^\s*她/.test(sentence)) return true;
  }
  return false;
}
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
  dress: /裙|旗袍|礼服|汉服|和服|浴衣|连衣|连体裤|连身裤|韩服|纱丽|长袍|道袍/,
  // 睡衣必须在里面：PIECE_PROSE 少了这一类时，`pieceMentioned` 对睡衣永远返回 false，
  // 于是「睡衣被推到胸口上方」这句谁都不点名 → pieces 空 → 整段床戏的服装一条不记。
  pajamas: /睡衣|睡裙|睡袍|浴袍|睡裤|家居服|居家服|晨衣|pajamas|nightgown|bathrobe/i,
  swim: /泳衣|泳装|泳裤|比基尼|死库水|swimsuit|swimwear|bikini|monokini|tankini/i,
  lingerie: /情趣|蕾丝内衣|镂空内衣|网纱内衣|半透明内衣|lingerie|babydoll|teddy|chemise/i,
  accessory: /吊袜带|袜带|束具|束带|胸背带|乳贴|胸贴|garter|harness|pasties/i,
  pants: /牛仔|(?<!内)裤/,
  shirt: /衬衫|上衣|t恤|T恤|背心|吊带|毛衣|卫衣|连衣|抹胸|吊带|上衣/,
  jacket: /外套|夹克|大衣|西装|风衣/,
  socks: /袜/,
  shoes: /鞋/,
};
/**
 * 这件衣服在这一句里被点名了吗。
 *
 * 除了具体件名，还要认**泛称**：正文最常写「双手娴熟的褪下温婉的衣服和裤子」，
 * 而不是逐件报名字。旧版只认具体件名（衬衫/牛仔裤），而「衣服」在 `garmentKind`
 * 里是空串、`PIECE_PROSE` 里也没有，于是这一整句对任何部件都不成立 → 一件都不记
 * → 正文写着衣服裤子都褪下了，图里她还穿着白衬衫（第 16 楼第二张图）。
 *
 * 泛称的归属按 `covers()` 分上下半身：写了「衣服」就动上半身那些件，写了「裤子」
 * 就动下半身，写了「衣裤 / 衣衫」两个都动。内裤不算「裤子」——中文里「裤子」不含内裤，
 * 让泛称把内裤一起脱掉会比正文多脱一件。
 */
function pieceMentioned(kind: string, text: string): boolean {
  const expression = PIECE_PROSE[kind];
  const cover = covers(kind);
  const underwear = kind === 'panties' || kind === 'bra';
  return text.split(/[，。；！？,;]/).some((clause) => {
    const named = expression ? expression.test(clause) : false;
    const generic =
      (cover.upper && /衣服|衣物|衣裳|衣衫|衣裤|上装/.test(clause)) ||
      (cover.lower && !underwear && /裤子|裤装|下装|裙装|衣裤|衣裳|衣物/.test(clause));
    if (!named && !generic) return false;
    // 「褪下内裤，裙子仍然穿着」：同一分句里明写还穿着的部件不动。
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
    //
    // TAKEOFF_ACTION 必须一起算：旧版这一层只认 DISPLACE_ACTION（「衣物＋被推到/掀到」
    // 这一种语序），而网文最常写的「双手娴熟的褪下她的衣服和裤子」「脱下她的内裤」
    // 用的全是「脱下/褪下」，DISPLACE_ACTION 一个都不认 —— 第 16 楼第二张图
    // 正文写着衣服裤子都褪了、人物却还穿着白衬衫，根因就在这。
    {
      expression: new RegExp(`${DISPLACE_ACTION.source}|${TAKEOFF_ACTION.source}`),
      mode: 'undress',
      label: '衣物被移开 / 脱衣动作',
    },
    // 再下一层：没有亲热/脱衣词，只有「胸口露出大半」「肩带从一侧滑落到手臂上」。
    // 泳池边、换衣中途、被扯歪的泳衣都属这一类——旧版这几句既不进 sex 也不进 undress
    // （DISPLACE_ACTION 要求「衣物+位置移动」，肩带滑落不算），于是账本停在「泳装穿得整整齐齐」，
    // enforceClothing 再把模型写的 slipped down 剥掉。
    { expression: BARE_UPPER, mode: 'expose', label: '上身露出' },
    { expression: BARE_LOWER, mode: 'expose', label: '下身露出' },
    { expression: SLIP_ACTION, mode: 'expose', label: '衣物滑落' },
  ];
  const masked = quotedMask(text);
  const handled = new Set<string>();
  for (const scene of scenes) {
    for (const match of text.matchAll(new RegExp(scene.expression.source, 'g'))) {
      const index = match.index ?? 0;
      // 引号里的台词/回忆不驱动当前服装（「按主人的吩咐，茉莉全裸地…」是她在复述过去）。
      if (masked[index]) continue;
      // 主语优先取「本句最先出现的名字」，其次看前几句的句首主语。
      // 旧版直接用句尾之前最近提到的名字，于是「她…盖住苏晚的肩膀…她拉开抽屉」
      // 会把换装记到苏晚头上 —— 苏晚只是被盖了被子。
      const window0 = sentenceWindow(text, index, 80);
      // 服装账本关心的是「这件衣服穿在谁身上」，不是「谁动的手」。
      // 「李斌…双手娴熟的褪下温婉的衣服和裤子」里主语是李斌（他没有账本记录），
      // 旧版直接 `if (!record) continue` 丢掉整条事件 —— 正文衣服裤子都褪了，
      // 图里她还穿着白衬衫。先按「名字＋的＋衣物」认衣服的主人，认不出再退回动作主语。
      const actor = subjectOf(text, window0.start, window0.end, entries);
      const owner = wearerOf(window0.text, entries, (who) => before.has(who));
      const name = (owner && before.has(owner) ? owner : '') || actor;
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
      //
      // 但**只压制「同一句」以内的重复**：旧版只要这一楼出现过 bath，就把整楼所有
      // 「脱下/褪下」全跳过，而洗澡往往发生在脱衣之后（第 16 楼：第 2 句褪下衣服裤子，
      // 第 5 句才进浴缸）。结果是最早那次真正写明的脱衣事件被丢掉，只剩后面靠场景
      // 推断的那一条，两张图之间的服装演化整段丢失。
      if (
        scene.mode === 'undress' &&
        changes.some(
          (c) =>
            c.name === name &&
            Math.abs(c.sourceLine - storyPosition(text, index).line) <= 1,
        )
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
        // 「而自己，赤裸的身体上还残留着…」——裸体写的是李斌，不是她。这一句如果算成
        // 她的裸体，整楼衣服会被一次性记成 removed，然后她一路裸到几十楼。
        // 判据落在「含裸体词的那个小句」上：小句里有她的名字（且不是领属）、或以「她」开头，
        // 且没有「他/自己/李斌」，才算她的裸体。
        const hersClause = (pattern: RegExp): boolean => {
          const clauses = String(evidence ?? '').split(/[。！？；\n，,]/);
          return clauses.some((clause) => {
            if (!pattern.test(clause)) return false;
            if (/他|自己|李斌|男主/.test(clause)) return false;
            if (/^\s*她/.test(clause.trim())) return true;
            if (!name) return true;
            const index = clause.indexOf(name);
            if (index < 0) return false;
            const after = clause.slice(index + name.length, index + name.length + 1);
            return after !== '的' && after !== '之';
          });
        };
        // 整句里没有男性/「自己」时不必做归属判定（大多数正文就是只写她一个人）；
        // 有男性在场时，裸体词必须落在写她的小句上。
        const maleInEvidence = /他|自己|李斌|男主/.test(evidence);
        const naked = NAKED_STATE.test(evidence) && (!maleInEvidence || hersClause(NAKED_STATE));
        const bodyBare = BODY_BARE.test(evidence) && (!maleInEvidence || hersClause(BODY_BARE));
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
          if (!bodyClothing(piece.design)) continue;
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
            pieces.push({
              id: piece.id,
              design: '',
              state: { location: 'removed' },
            });
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
            if (!bodyClothing(piece.design)) continue;
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
        // 场景本身不许脱衣：原先只要 mode 不是 undress（进卧室、进浴室、换到夜里）
        // 就把身上所有衣物记成 removed/floor，「她回房间」那一楼直接变全裸。
        // 现在只有两种证据能整身脱：正文真的写了裸体，或写了她在洗澡/泡澡。
        const wholeText = `${text} ${evidence}`;
        // 裸体与洗澡都必须是她的事。真实正文第 4 节写「而自己，赤裸的身体上还残留着…」——
        // 那是李斌的自述，整句判据会把她的衣服全部脱掉，然后她一路裸到几十楼。
        const herScene = (pattern: RegExp): boolean =>
          wholeText.split(/[。！？；\n]/).some((sentence) => {
            if (!pattern.test(sentence)) return false;
            if (record.name && sentence.includes(record.name)) return true;
            if (/^\s*她/.test(sentence.trim())) return true;
            // 没有主语的场景句（「浴室里很快响起水声」）算她的；写了「他/自己/李斌」的不算。
            return !/他|自己|李斌|男主/.test(sentence);
          });
        const sceneNudity = herScene(/赤裸|全裸|一丝不挂|光着身子|没穿衣服|裸体|\bnaked\b|\bnude\b/i);
        const bathing = herScene(/洗个?澡|淋浴|花洒|冲洗|冲凉|泡澡|泡进|冲澡|热水|浴缸|\bshower\b|\bbath\b/i);
        if (sceneNudity || bathing) {
          for (const piece of record.pieces) {
            const location = piece.state.location;
            if (location && location !== 'worn' && location !== 'unknown') continue;
            if (!bodyClothing(piece.design)) continue;
            pieces.push({
              id: piece.id,
              design: '',
              state: {
                location: bathing && !sceneNudity ? 'floor' : 'removed',
                ...(bathing ? { wetness: 'wet' } : {}),
              },
            });
          }
        } else if (/褪下|褪去|脱下|脱去|脱光|剥光|扒光|扒下/i.test(evidence)) {
          // 点了名的那几件才脱：中文里「衣服和裤子」不含内裤，泛称不能顺手把内裤也记成脱下。
          const namesUpper = /衣|袍|衫/.test(evidence);
          const namesLower = /裤|裙/.test(evidence);
          for (const piece of record.pieces) {
            const location = piece.state.location;
            if (location && location !== 'worn' && location !== 'unknown') continue;
            if (!bodyClothing(piece.design)) continue;
            const kind = garmentKind(piece.design);
            // 内衣要单独点名才脱：中文里「衣服和裤子」不含内裤，泛称顺手脱内衣
            // 就是没写裸体的裸奔。
            if ((kind === 'bra' || kind === 'panties' || kind === 'lingerie') && !/内裤|内衣|胸罩|文胸|胸衣/.test(wholeText)) continue;
            const lower = kind === 'pants' || kind === 'skirt';
            if (lower ? !namesLower : !namesUpper) continue;
            pieces.push({ id: piece.id, design: '', state: { location: 'removed', ...(bathing ? { wetness: 'wet' } : {}) } });
          }
        }
      }
      // 同一条证据句里既写了「褪下」又写了「浴缸」时，上面的两个分支会各推一遍：
      // 同一件衣服不能同时是「已脱下」和「湿着放在地上」。按 id 归并，脱下来的优先。
      if (pieces.length > 1) {
        const removedIds = new Set(pieces.filter((piece) => piece.state.location === 'removed').map((piece) => piece.id));
        const seenIds = new Set<string>();
        const merged: typeof pieces = [];
        for (const piece of pieces) {
          const id = piece.id ?? '';
          if (removedIds.has(id)) {
            if (seenIds.has(id)) continue;
            if (piece.state.location !== 'removed') continue;
          } else if (seenIds.has(id)) continue;
          seenIds.add(id);
          merged.push(piece);
        }
        pieces.length = 0;
        pieces.push(...merged);
        // 洗澡这一楼里离身的衣服统一记湿：不管它是走「褪下」还是走「赤裸」分支进来的。
        const wetHere = /洗个?澡|淋浴|花洒|冲洗|冲凉|泡澡|泡进|冲澡|热水|浴缸|\bshower\b|\bbath\b/i.test(`${text} ${evidence}`);
        if (wetHere) for (const piece of pieces) if (piece.state.location && piece.state.location !== 'worn') piece.state.wetness = 'wet';
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
  // 洗澡这一楼里离身的衣物统一记湿：分支太多（褪下/赤裸/场景推断各一条），
  // 逐个分支补湿态总会漏，出口统一收一次最省事。
  if (/洗个?澡|淋浴|花洒|冲洗|冲凉|泡澡|泡进|冲澡|热水|浴缸|\bshower\b|\bbath\b/i.test(text)) {
    for (const change of changes)
      for (const piece of change.pieces)
        if (piece.state && piece.state.location && piece.state.location !== 'worn') piece.state.wetness = 'wet';
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
const MAIN_GARMENTS = new Set(['shirt', 'skirt', 'pants', 'dress', 'pajamas', 'swim', 'lingerie']);
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
/**
 * 本楼没有「撩起来/拉开/露出」这类动作，却带着上一楼的走光词，就把它摘掉。
 *
 * 实测：第 0 楼衬衫被撩到胸口，第 2 楼「第二天清晨出门」模型仍写 shirt lift——
 * 账本已经复位成穿着整齐，模型却照着上一楼的画面抄状态。状态词只能有两种来源：
 * 本楼正文写了这个动作，或账本还记着（exposure/arrangement 未被复位）。
 */
const EXPOSURE_MOVE = /撩|掀|扯|拉下|拉低|拉开|勾住|滑落|褪|露|探进|掏出|解开|敞开|翻起/;
function stripStaleWearState(tag: string, text: string): string {
  if (!tag || EXPOSURE_MOVE.test(text)) return tag;
  const kept = tag
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !LOCKED_WEAR_STATE.test(t));
  return kept.join(', ');
}
const LOCKED_WEAR_STATE =
  /\b(?:unbuttoned|unzipped|unfastened|undressing|disrobing|stripping|no panties|no bra|panties aside|pants down|skirt lift|breasts out|clothes down|clothes aside|clothes off|dress lift|shirt lift|slipped off|slipped down|taking off|removing clothes|lifting (?:dress|skirt|shirt)|pulling (?:dress|skirt|shirt|pants|panties))\b/i;
/**
 * 只删「与账本冲突」的衣物句，其余原句保留。
 *
 * 旧版用 `CLOTHING_WORD.test(s)` 过滤：只要句子提到任何衣物词就整句删掉，
 * 于是模型写的「她指节把百褶裙压出折痕」这种**衣物具体形态**（正是 nl 该管的部分）
 * 全军覆没，句子被删空后又退回 `Wearing white shirt, unfastened.` 这种账本 dump——
 * 0.2.3 首楼写回的 nl 只剩机械句就是这个原因。
 *
 * 现在的判据只有一条：这句点名的衣物是否**账本里已经脱下来**（removed/floor/chair/held）。
 * 账本说在穿的、或者只是描述在穿衣物怎么贴着的句子，一律留下。
 */
// 与账本矛盾的裸体主张：账本说她穿着衣服，nl 里就不许出现「naked / 没穿」这类断言。
// 实测第 8 楼：tag 写着白衬衫+牛仔短裤，Base nl 却写「lies back naked on the bed」，
// 模型自己前后打架，NAI 会把两句话一起当指令。
// 裸体断言不能靠枚举几个词：模型会写 unclothed / disrobed / stripped / 没穿…，
// 漏一个就从这里漏过去（第 8 楼：账本 shirt/bra/shorts 全 worn，nl 写 completely unclothed）。
// 所以按「词族 + 否定式服装短语」两路一起判。
const NUDITY_CLAIM =
  /\b(?:naked|nude|topless|bottomless|unclothed|disrobed|undressed|stripped|clothesless|nudity)\b|\b(?:no|without) (?:her |his )?(?:clothes|clothing|outfit|shirt|top|bra|panties|pants|shorts|skirt)\b|\bbare (?:chest|breasts?|body|skin|butt)\b|\bnothing on\b/i;

const NUDE_TOKENS = new Set([
  'completely nude', 'naked', 'nude', 'nipples', 'no bra', 'no panties', 'no pants', 'no shirt',
  'topless', 'bottomless', 'undressed', 'unclothed', 'disrobed', 'completely unclothed',
]);

function stripNudeTokens(tag: string): string {
  return tag
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !NUDE_TOKENS.has(t.toLowerCase()))
    .join(', ');
}

function dropNudityClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !NUDITY_CLAIM.test(s));
}

function dropConflictingGarments(text: string, record?: ClothingRecord): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (!record) return sentences.map((s) => s.trim()).filter(Boolean);
  const offWords = record.pieces
    .filter((p) => ['removed', 'floor', 'chair', 'held'].includes(p.state.location))
    .flatMap((p) => p.design.split(',').map((t) => t.trim()))
    .filter((w) => w.length > 2);
  if (!offWords.length) return sentences.map((s) => s.trim()).filter(Boolean);
  return sentences
    .filter((sentence) => !offWords.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sentence)))
    .map((s) => s.trim())
    .filter(Boolean);
}


/**
 * 收尾两道指令：袖长与「nl 复述服装」。
 *
 * 为什么放在最后而不在 enforceClothing 里：外貌层(enforceAppearance)会
 * `tag = unique([...canonical, ...dynamic])` 重建角色 tag，服装层补进去的修饰语
 * 会被整条丢掉——实测正文写「白色短袖衬衣」，写回楼层的 tag 仍是 `white shirt`，
 * 出来就是长袖。所以修饰语在**序列化前**补一次，谁都覆盖不了。
 *
 * nl 同理：模型常把服装再复述一遍（`She wears a white short-sleeved collared shirt
 * and blue denim shorts…`），那正是 tag 已经说完的东西。这种句子不是补充，
 * 只是一句更长的 tag，直接丢掉，让画面靠 tag 定位。
 */
const SLEEVE_TOKENS = /\b(?:short sleeves|long sleeves|sleeveless)\b/i;
const SHIRT_LIKE = /\b(?:shirt|blouse|dress|t-?shirt|sweater|hoodie|jacket|coat|uniform)\b/i;

const GENERIC_SCENE = new Set(['house', 'indoors', 'indoor', 'outdoors', 'outdoor', 'day', 'night', 'blurry background', 'depth of field']);

export function applyTextQualifiers(
  image: ImageInsertion,
  source: string,
  /** 账本：已经记下的「衣还在身上但露着」不受本楼正文有没有提到影响，必须保留。 */
  ledger?: ClothingState,
  /** 本轮事实表：动作类事实同样构成「必须看得见」的要求。 */
  facts?: readonly { kind: string; value: string }[],
): void {
  const text = source || '';
  const sleeve = /短袖/.test(text)
    ? 'short sleeves'
    : /长袖/.test(text)
      ? 'long sleeves'
      : /无袖|吊带/.test(text)
        ? 'sleeveless'
        : '';
  if (sleeve) {
    for (const c of image.characters) {
      if (SHIRT_LIKE.test(c.tag) && !SLEEVE_TOKENS.test(c.tag)) c.tag = `${c.tag}, ${sleeve}`;
    }
    if (image.characters.length === 0 && SHIRT_LIKE.test(image.tag) && !SLEEVE_TOKENS.test(image.tag))
      image.tag = `${image.tag}, ${sleeve}`;
  }

  const clothing = new Set([...TAG_LEXICON.clothing].map((word) => word.toLowerCase()));
  const garmentWords = (text2: string): number =>
    text2
      .toLowerCase()
      .split(/[^a-z ]+/)
      .map((word) => word.trim())
      .filter(Boolean)
      .filter((word) => clothing.has(word)).length;
  // 露点词必须有正文撑腰：本楼正文只写「衣领敞开、露出锁骨」时，
  // 模型补 breasts out / nipples 是它自己的加戏，画出来就和剧情不符。
  const near = (source ? storyNearImage(text, image) : '') || text;
  // 露点词分两档：乳沟/侧乳只要正文写了胸口或领口就成立；
  // breasts out / nipples 得真的写到乳头或裸胸，不能靠「胸口」推。
  const NEAR_SOFT = /胸|领口|乳沟|ru沟/;
  const NEAR_HARD = /乳头|乳晕|乳房|裸胸|奶子|没穿|解开了.{0,6}胸|衣物.{0,4}滑落/;
  const SOFT_EXPOSURE = /\b(?:cleavage|underboob|sideboob)\b/i;
  const HARD_EXPOSURE = /\b(?:breasts out|bare breasts?|exposed breasts?|nipples?|areolae?)\b/i;
  const scrubExposure = (tag: string, pattern: RegExp): string =>
    normaliseLexiconTag(
      tag
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token && !pattern.test(token))
        .join(', '),
    );
  // 账本里已经有 exposure=bare/partial 的部件时，露点是既成事实，不因为
  // 这一楼正文没写「胸」就被剥掉——那正是「前一楼露着、后一楼穿好」的另一半原因。
  const carried = Boolean(
    ledger &&
      [...ledger.values()].some((record) =>
        record.pieces.some((piece) => piece.state?.location === 'worn' && /^(?:bare|partial)$/.test(String(piece.state?.exposure ?? ''))),
      ),
  );
  if (carried) {
    // 保持账本口径：只按账本渲染，不从正文反推。
  } else if (!NEAR_SOFT.test(near)) {
    image.tag = scrubExposure(image.tag, SOFT_EXPOSURE);
    image.tag = scrubExposure(image.tag, HARD_EXPOSURE);
    for (const c of image.characters) {
      c.tag = scrubExposure(c.tag, SOFT_EXPOSURE);
      c.tag = scrubExposure(c.tag, HARD_EXPOSURE);
    }
  } else if (!NEAR_HARD.test(near)) {
    image.tag = scrubExposure(image.tag, HARD_EXPOSURE);
    for (const c of image.characters) c.tag = scrubExposure(c.tag, HARD_EXPOSURE);
  }

  // 归属不明的手：`a person's hand` / `an unseen hand` 会被画成她自己的手。
  // 正文里谁在动是有答案的——他的名字/他的身体部位在场，就写 his hand。
  const malePresent = /他(?:的)?(?:手|掌|指|头|腰|胸|腿|臂)|李斌|男主|\bhis\b/i.test(near);
  const handWord = malePresent ? 'his hand' : 'her hand';
  // 只改「手在做别人的事」的说法：明确无主的（a person's hand / unseen hand），
  // 以及男方在场时压在她身上、抓着她、掐着她却没写主人的手。
  // 「she raises a hand to cover her chest」这种自己的手不动。
  const NAMELESS = /\b(?:someone'?s|somebody'?s|a\s+person'?s|another\s+person'?s|an?\s+unseen)\s+(?:hand|hands|palm|fingers?)\b/gi;
  const ACTING_HAND = /\b(?:a|an|the)\s+(?:hand|palm|fingers?)\b(?=\s+(?:pressing|presses|holding|holds|grabbing|grabs|gripping|grips|pinning|pins|against|on\s+her|around\s+her|over\s+her|inside))\s?/gi;
  const fixOwner = (text2: string): string =>
    text2
      .replace(NAMELESS, (m) => (m.toLowerCase().includes('hands') ? `${handWord}s` : handWord))
      .replace(malePresent ? ACTING_HAND : /$^/g, () => `${handWord} `);
  image.tag = fixOwner(image.tag);
  image.nl = image.nl ? fixOwner(image.nl) : image.nl;
  for (const c of image.characters) {
    c.tag = fixOwner(c.tag);
    if (c.nl) c.nl = fixOwner(c.nl);
  }

  // nl 里出现的手是他的，Base 就得有 1boy：只写 1girl + "his hand" 时，
  // 模型会把那只手画成她自己的，或者干脆不画手。
  // 男主在场时 Base 必须写人数：只写 1girl + "his hand"（哪怕这句落在角色 nl 里），
  // 模型会把那只手画成她自己的。所以 Base nl、角色 nl、角色 tag 全部算证据。
  const hisEvidence = [
    image.nl ?? '',
    image.tag,
    ...image.characters.map((c) => `${c.nl ?? ''} ${c.tag}`),
  ].join(' ');
  // 只有「his hand」这一种证据太窄：实测第 0 楼 Base nl 写的是「he hugs her from behind」，角色 nl 也只用 his hands，但 Base tag 仍只有 1girl，画面里没有男方。
  if (!/\b(?:1boy|2boys|multiple boys)\b/i.test(image.tag) &&
    (/\bhis (?:hand|hands|palm|fingers|arm|chest|waist|hip|hips|head|leg|shoulder|throat|mouth)\b/i.test(hisEvidence) ||
      /\b(?:he|him)\b/i.test(image.nl ?? '') ||
      /他(?:的)?(?:手|掌|指|头|腰|胸|腿|臂|身|肩)|李斌|男主/.test(near))) {
    image.tag = `${image.tag.replace(/,\s*1girl\b/i, ', 1girl, 1boy')}`;
  }

  // 男主块里被塞进女性的身体状态（arched back / spread legs / blush / moaning）时，
  // 画出来是一个张开腿的男人——这是模型把同一段动作的描述复制给了两个人。
  // 男性人物块只该保留他的动作与施动部位，受方状态归女方。
  const MALE_STATE = /^(?:arched back|spread legs|spread pussy|clitoris|pussy juice|blush|moaning|trembling|heavy breathing|ahegao|panties|bra|breasts|nipples|areolae|cleavage)$/i;
  for (const c of image.characters) {
    if (!/\b1boy\b/i.test(c.tag)) continue;
    c.tag = c.tag
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !MALE_STATE.test(t))
      .join(', ');
  }

  // Base 的场所下限：模型爱只写 `house, day`，画面就没有「在楼梯上」这个事实。
  // 只从本楼正文里取（storyPlaces 认不出就返回空），不编。
  const scenes = new Set([...TAG_LEXICON.scene].map((word) => word.toLowerCase()));
  const baseTokens = image.tag.split(',').map((token) => token.trim().toLowerCase()).filter(Boolean);
  const concrete = baseTokens.filter((token) => scenes.has(token) && !GENERIC_SCENE.has(token));
  if (concrete.length < 2) {
    for (const place of storyPlaces(near)) {
      if (baseTokens.includes(place)) continue;
      baseTokens.push(place);
    }
    image.tag = baseTokens.join(', ');
  }

  for (const c of image.characters) {
    if (!c.nl) continue;
    // nl 里凡是「把 tag 已经写过的衣服再念一遍」的部分都删掉：只保留动作与空间。
    // 判据是「分句里出现 tag 里已有的服装词」而不是动词黑名单——
    // `She wears a damp white shirt and denim shorts, hair swaying` 这种句子前半截
    // 有动词 wears 也照样是复述，按动词判会漏。
    const DRESS_MODIFIER = new Set([
      '1girl', '1boy', '2girls', '2boys', 'girl', 'boy', 'solo', 'white', 'black', 'blue', 'pink', 'red',
      'green', 'yellow', 'grey', 'gray', 'brown', 'purple', 'orange', 'pale', 'fair', 'dark', 'light',
      'long', 'short', 'high', 'low', 'open', 'closed', 'wet', 'damp', 'sleeve', 'sleeves', 'hair',
      'eyes', 'eye', 'skin', 'tall', 'slender', 'thin', 'she', 'her', 'his', 'he', 'and', 'with',
    ]);
    const tagGarments = new Set(
      c.tag
        .toLowerCase()
        .split(/[^a-z0-9 ]+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 2 && !DRESS_MODIFIER.has(word)),
    );
    const pieces = c.nl.split(/(?<=[.!?])\s+|,\s+(?=and\s|her\s|his\s|she\s|he\s)/);
    const kept = pieces.filter((piece) => {
      const lower = piece.toLowerCase();
      const garmentHits = lower.split(/[^a-z ]+/).filter((word) => word && tagGarments.has(word)).length;
      // 「她穿着 X」「X is on the floor」这类句子就是在念 tag，动作词再多也不留
      if (/^(?:she|he)?\s*(?:is\s+)?(?:wears?|wearing|dressed|clad)\b|\bis\s+(?:on|around)\s+the\s+(?:floor|chair|bed)\b/i.test(piece.trim())) return false;
      if (!garmentHits) return true;
      const action = /\b(holds?|holding|rests?|resting|turns?|looks?|leans?|steps?|walks?|reaches?|raises?|pulls?|pushes?|covers?|covering|glances?|tilts?|shifts?|fingers?|palm|hand|shoulder|back)\b/i.test(piece);
      return action;
    });
    const next = kept.join(', ').replace(/,\s*,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '').trim();
    const leftoverGarments = garmentWords(next) >= 2 && !/\b(holds?|holding|rests?|turns?|looks?|leans?|steps?|walks?|stands?|sits?|reaches?|raises?|pulls?|pushes?|covers?|covering)\b/i.test(next);
    if (!next || leftoverGarments) {
      console.warn('[墨影] 角色 nl 只是复述服装，整段丢弃');
      c.nl = '';
      continue;
    }
    if (next !== c.nl.trim()) console.warn('[墨影] 角色 nl 里的服装复述已删掉');
    c.nl = next;
  }
  // 景别覆盖：正文点名要看下半身/手，而上半身特写装不下时，把景别换成装得下的。
  // 这是事实约束，不是审美判断——「写了丝袜却只画上半身」就是这么来的。
  // 同一属性互斥（封闭集合）：短袖 vs 长袖、穿着 vs 脱下、裸体 vs 着装、solo vs 男方。
  // 放在这里而不是序列化出口，是因为需要正文来判断「哪边是真的」。
  const baseResolved = resolveTagConflicts(image.tag, text);
  if (baseResolved.notes.length) {
    console.warn(`[墨影] Base 的 tag 互斥检查：${baseResolved.notes.join('；')}`);
    image.tag = baseResolved.tag;
  }
  for (const character of image.characters) {
    const resolved = resolveTagConflicts(character.tag, text);
    const attrs = collapseAttributes(resolved.tag, text);
    if (attrs.notes.length) {
      console.warn(`[墨影] ${character.name} 的同类属性合并：${attrs.notes.join('；')}`);
      resolved.tag = attrs.tag;
    }
    if (resolved.notes.length) {
      console.warn(`[墨影] ${character.name} 的 tag 互斥检查：${resolved.notes.join('；')}`);
      character.tag = resolved.tag;
    }
  }

  // 可见性只看这一格自己的正文（图附近的窗口），不是整楼：整楼前面提过鞋袜，
  // 就会把后面递信那张图强行拉成全身，动作反而被缩小到看不清。
  image.tag = groundScenes(image.tag, near || text);
  const needs = seeNeeds(near || text);
  // 事实表里写下的动作也算：模型这一轮可能把「她的手按在他胸口」只写进 fact，
  // 没写进 tag/nl；只看正文就会漏掉「必须装得下手」这条可见性要求。
  const factNeeds = facts?.length ? needsFromFacts(facts) : null;
  if (factNeeds) { needs.lower ||= factNeeds.lower; needs.upper ||= factNeeds.upper; needs.face ||= factNeeds.face; needs.hands ||= factNeeds.hands; }
  if (needs.lower || needs.hands) {
    const covered = enforceShotCoverage(image.tag, needs);
    if (covered.changed.length) {
      console.warn(`[墨影] 景别按正文可见内容调整：${covered.changed.join('/')} → 换掉`);
      image.tag = covered.tag;
    }
  }
}
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
    if (!record) {
      // 账本还空着（首次出场、或前几楼一次都没报 outfitChanges）时，模型写裸必须由本楼正文自己撑腰。
      // 真实小说里常有「精液喷在小姨子的内裤上」这类句子，模型会把女主顺手画成没穿。
      const near = source ? storyNearImage(source, image) : '';
      const naked = /(?:completely nude|naked|nipples|no bra|no panties|topless|bottomless)/i;
      const hers = nudityBelongsTo(near, [...new Set([canonical, c.name, ...characterAliases(canonical)])]);
      if (near && !hers && naked.test(c.tag)) {
        c.tag = c.tag
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t && !naked.test(t))
          .join(', ');
      }
      continue;
    }
    // 饰物归属：眼镜这类东西在楼里属于别人时，先从她的 tag 里摘掉，再走服装合并。
    const aliases = [...new Set([canonical, c.name, ...characterAliases(canonical)])];
    c.tag = dropForeignWear(c.tag, source, aliases);
    /**
     * 账本说她脱光了，但这一楼正文的裸露根本不是她的 —— 那是账本被别人的裸体污染后的
     * 残影（实测：李斌洗澡自慰，她只是上楼回家）。此时不能让她光着出图：
     * 把账本里被误记成 removed 的部件穿回去，再照常合并。
     */
    // 只有正文里出现穿衣动作，才允许把账本里的「脱下」改回穿着。
    // 旧判据用的是「这一楼没提裸露」——那是「裤裆没被提到」，不是「她穿好了」，
    // 于是前一楼掀衣露胸、后一楼没写服装的楼层被悄悄穿回整套衣服。
    const nearText = source ? storyNearImage(source, image) || '' : '';
    // 两种复位来源：①正文明确写了穿衣动作；②这一楼写的是别人的裸体
    // （他的裸体被账本记到她头上时，她那身衣服本来就是被冤枉脱掉的）。
    // 其余情况一律保持账本状态——「没提到」不等于「穿好了」。
    const foreignNude = /赤裸|裸体|\bnaked\b|\bnude\b/i.test(nearText) && !nudityBelongsTo(nearText, aliases);
    const nextScene = NEXT_SCENE.test(nearText) && !EXPOSURE_MOVE.test(nearText) && !/赤裸|裸体|\bnaked\b|\bnude\b/i.test(nearText);
    if (
      source &&
      (REDRESS.test(nearText) || nextScene || foreignNude) &&
      ledgerShowsUndress(record) &&
      !nudityBelongsTo(nearText, aliases)
    ) {
      // 不只看 removed：模型常把脱下的衣服记成 floor / chair / held，
      // 这些状态同样会让 caption 渲染成「没穿」。有穿衣证据时一律穿回去。
      for (const piece of record.pieces) {
        if (piece.state?.location && piece.state.location !== 'worn' && piece.state.location !== 'unknown')
          piece.state = { ...piece.state, location: 'worn' };
        // 场景翻篇/重新穿好的那一刻，上一格的「掀着/拨到一侧/敞开/露着」全部作废：
        // 只复原 location 会留下 shirt lift + breasts out，画面还是半裸。
        const state: Record<string, string> = { ...(piece.state ?? {}) };
        if (state.arrangement && state.arrangement !== 'unknown') state.arrangement = 'normal';
        if (state.fastening && state.fastening !== 'unknown') state.fastening = 'closed';
        delete state.exposure;
        delete state.legacy;
        piece.state = state;
      }
      // 模型是从账本那句「已脱下」推出来「没穿」的，账本改回穿着之后，这些裸体词
      // 也得跟着走，否则合并时它们会作为「模型补充」留在画面里。
      const nude = new Set(['completely nude', 'naked', 'nipples', 'no bra', 'no panties', 'topless', 'bottomless']);
      c.tag = c.tag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && !nude.has(t.toLowerCase()))
        .join(', ');
    }
    // 账本已经全套穿着整齐、本楼又没有掀/拉/露的动作时，模型带过来的
    // shirt lift / panties aside 是上一楼的残影，摘掉再合并。
    const ledgerDressed = record.pieces.every(
      (piece) =>
        piece.state?.exposure === undefined &&
        (piece.state?.arrangement ?? 'normal') === 'normal' &&
        (piece.state?.fastening ?? 'closed') === 'closed',
    );
    if (ledgerDressed && !EXPOSURE_MOVE.test(nearText)) c.tag = stripStaleWearState(c.tag, nearText);
    // 动作依赖的状态会过期：`shirt lift` / `panties aside` 是「这一格的手在做什么」，
    // 不是长期穿着状态。本段正文里没有任何掀/拉/露的动作、又没有裸露时，把
    // arrangement 退回 normal（location 与 exposure 不动）——否则他手早松开了，
    // 衣服还永远掀着。脱掉/褪到膝盖这类是事实，不在此列。
    if (nearText && !EXPOSURE_MOVE.test(nearText)) {
      for (const piece of record.pieces) {
        const arrangement = String(piece.state?.arrangement ?? '');
        if ((arrangement === 'lifted' || arrangement === 'pulled_aside') && piece.state?.exposure !== 'bare')
          piece.state = { ...piece.state, arrangement: 'normal' };
      }
      // 「只解开最上面一颗」被模型写成 open 时按 loose 收（与正文同口径）。
      const partialFasten =
        /(?:解开|解了|松开|拉低)[^，。！？；]{0,6}(?:一颗|一粒|最上面一?颗|第一颗|上数|顶上一?颗)|(?:最上面|第一颗|第一粒|顶上一?颗)[^，。！？；]{0,6}(?:扣|纽扣)/.test(
          nearText,
        );
      if (partialFasten)
        for (const piece of record.pieces)
          if (piece.state?.fastening === 'open') piece.state = { ...piece.state, fastening: 'loose' };
    }
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
    if (
      caption.tag.trim() &&
      source &&
      nudityBelongsTo(storyNearImage(source, image), aliases) &&
      !ledgerShowsUndress(record)
    ) {
      managed++;
      continue;
    }
    // 正文写的是另一身衣服，而账本那身在本楼一次都没提 —— 以正文为准。
    //
    // 为什么需要：账本只跟着「换装动作」走（换上/穿上/脱掉）。剧情从泳池直接切到
    // 「第二天早上，教室的窗子刚被推开，林夏坐在靠窗的位置抄昨天的笔记，制服衬衫扣到
    // 第二颗」这种**陈述式回到另一套衣服**的写法，没有任何换装动词，账本停在泳衣上，
    // enforceClothing 就把 swimsuit 塞回角色 tag，于是「正文写校服、图里穿泳衣」。
    // 判据很窄：模型写的衣物词在本楼正文里出现过，而账本那身一个词都没出现。
    const near = source ? storyNearImage(source, image) : '';
    if (near && storyGarments(near).length) {
      const textGarments = new Set(storyGarments(near));
      const ledgerGarments = caption.tag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && isClothingDescription(t));
      const ledgerInText = ledgerGarments.some((w) => near.includes(w) || textGarments.has(w));
      if (!ledgerInText) {
        managed++;
        continue;
      }
    }
    managed++;
    // 模型已经自己写了衣物时，不要再把账本那一套并进来：
    // 第 12 楼账本是白衬衫+牛仔短裤，模型按当时画面写了 t-shirt+skirt，
    // 两份并进同一个 tag 就变成「她同时穿两套衣服」，NAI 只会画出混乱的中间态。
    // 账本那套只有在「模型没写衣物」或「正文确实提到账本这套」时才补。
    const modelGarments = c.tag
      .split(',')
      .map((t) => t.trim())
      // 裸体词不算「她写的衣服」：否则模型写 nude 就会被当成已有一套穿搭，
      // 账本里真实存在的 camisole 不再并进来，画面与剧情两头落空。
      .filter((t) => t && isClothingDescription(t) && !NUDE_TOKENS.has(t.toLowerCase()));
    const ledgerMentioned =
      !source ||
      caption.tag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && isClothingDescription(t))
        .some((w) => source.includes(w));
    const dynamic = dropProps(
      c.tag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && !isClothingDescription(t) && !LOCKED_WEAR_STATE.test(t)),
    );
    // 账本的「状态词」（no shirt / unfastened / on the floor…）永远要带上：
    // 它说的是这一件现在什么状态，模型写的衣物词不能覆盖它。
    // 只跳过账本的「品类词」——模型已经自己写了另一套衣服时不要再并一份。
    const ledgerTokens = caption.tag
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const stateTokens = ledgerTokens.filter(
      (t) => LOCKED_WEAR_STATE.test(t) || /^(?:no|un)\b|\bunfastened\b|\b(?:floor|chair|off)\b/i.test(t),
    );
    const ledgerTags =
      modelGarments.length && !ledgerMentioned
        ? stateTokens
        : ledgerTokens;
    c.tag = [...new Set([...dynamic, ...modelGarments, ...ledgerTags])].join(', ');

    // 正文写「白色**短袖**衬衣」，模型只取 `shirt` 就丢掉了「短」——出来是长袖。
    // 修饰语是封闭集合（袖长三种），能判就补；判不出（正文没写）就不猜。
    const sleeve = /短袖/.test(source || '')
      ? 'short sleeves'
      : /长袖/.test(source || '')
        ? 'long sleeves'
        : /无袖|吊带/.test(source || '')
          ? 'sleeveless'
          : '';
    const hasSleeveWord = /\b(?:short sleeves|long sleeves|sleeveless)\b/i.test(c.tag);
    const hasShirtLike = /\b(?:shirt|blouse|dress|t-?shirt|sweater|hoodie|jacket|coat)\b/i.test(c.tag);
    if (sleeve && !hasSleeveWord && hasShirtLike) c.tag = `${c.tag}, ${sleeve}`;
    if (nl) {
      // 双通道分工：服装的**品类与状态**归 tag（caption.tag 已并入），
      // 衣物与接触的**具体形态**归 nl（模型写的）。旧版无条件用 caption.nl 覆盖，
      // 等于把模型那句全删了再换成「Wearing white shirt, unfastened.」这种账本 dump——
      // 实测第 0 楼写回的 nl 只剩这两类机械句，模型的「ribbon hangs loose」整段消失。
      // 现在只删「与账本冲突的衣服句」（她说穿着的东西账本说没有），
      // 模型那句还剩就留着；一句不剩（整段都在写衣服）才退回账本渲染。
      const dressed = record.pieces.some((p) => p.state.location === 'worn');
      const hasOff = record.pieces.some((p) =>
        ['removed', 'floor', 'chair', 'held'].includes(p.state.location),
      );
      // 正文自己写了裸露（洗澡、上床）时，模型写的 nude 是对的，别剥；
      // 只有账本说穿着、而这一楼正文没说裸露，才把裸体词当矛盾清掉。
      if (dressed && !hasOff && !NUDITY_HINT.test(source || '')) c.tag = stripNudeTokens(c.tag);
      // nl 不在这里改写：模型那句话是唯一的「动作怎么完成」来源，
      // 服装层删句只会把句子删成残句。冲突交给出口的统一清洗（一次），
      // 这里只记一笔，方便诊断面板看出模型写了什么。
      // **绝不退回 caption.nl**：那是账本渲染出来的「Wearing white shirt, collared
      // shirt, short sleeves, unfastened. Wearing pink bra. Wearing denim shorts.」——
      // 一串名词短语，不是一句英文，而且把 tag 已经说过的品类又复述一遍。
      // 模型那句被删空就留空：留空只是少一条空间信息，塞 dump 会让模型以为
      // 「nl 就是复述 tag」，下一楼继续学坏。
      if (!c.nl.trim()) console.warn('[墨影] 这个角色的 nl 是空的，出口会留空（不回填账本 dump）');
    }
  }
  if (managed && independent) {
    image.tag = dropProps(
      image.tag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && !isClothingDescription(t) && !LOCKED_WEAR_STATE.test(t)),
    ).join(', ');
    if (nl) {
      // 同上：只删与账本冲突的衣物句。留空也接受 —— Base 的空间信息可以没有，
      // 服装的品类与状态已经在 Base tag 与角色 tag 里说死了。
      // 同上：Base nl 也不在这里改写。
    }
    if (image.characters.length) image.tag = stripBasePersonal(image.tag);
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
    image.tag = stripBasePersonal(image.tag);
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
      const whole = kind === 'dress' || kind === 'pajamas' || kind === 'swim' || kind === 'lingerie';
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
      // id 必须与事实层写账本用的类别名一致（bra / panties / shirt…）。
      // 以前这里加 `_story` 后缀，于是同一件胸罩会同时存在 `bra` 与 `bra_story` 两条记录，
      // 渲染出来是「两件胸罩」叠穿，事实继承时还会各继承一遍。
      pieces.push({ id: kind || 'piece', design, state: { location: 'worn' } });
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
      (p) => (p.state.location ?? 'worn') === 'worn' && ['dress', 'pajamas', 'swim', 'lingerie'].includes(garmentKind(p.design)),
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

/**
 * 这句「第二天」到底是真翻篇，还是她在担心/假设里的第二天？
 *
 * 实测踩过的坑：第 9 楼正文写「如果有路人偷拍，那么第二天这萝莉的艳照就会…」——
 * 这是担忧，不是时间流逝。旧版只看关键词命中就把上一楼脱掉的衣物全部穿回，
 * 于是正在做爱的那一楼账本被复位成「穿好」，画面立刻变回一身衣服。
 */
const HYPOTHETICAL =
  /(?:如果|假如|要是|若是|万一|恐怕|否则|就算|即使|即便|哪怕|不免|可能会|说不定|难保|就会|便会|想必)/;

/** 本楼是否真的翻篇（忽略假设/担忧里的时间词）。 */
function sceneChanged(text: string): boolean {
  const source = String(text ?? '');
  if (!SCENE_RESET.test(source)) return false;
  for (const match of source.matchAll(new RegExp(SCENE_RESET.source, 'g'))) {
    const at = match.index ?? 0;
    const window = sentenceWindow(source, at, 40);
    if (!HYPOTHETICAL.test(window.text)) return true;
  }
  return false;
}

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
  // 性行为进行中也算「还没结束」，不能借翻篇把她穿回去（第 9 楼射精吞精曾被穿回睡衣）。
  if (!sceneChanged(text) || UNDRESS_MARK.test(text) || SEX_ACT.test(text)) return { changes, notes };
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

/**
 * 事实表回写账本（只做「明确事实覆盖陈旧状态」这一件事）。
 *
 * 以前账本只从计划里的 outfitChanges 与 tag 字符串反推，一旦某一楼把衣物记成
 * 脱下（可能是误判、也可能是别人身上的衣物），后面只能靠「穿衣动作」或「场景翻篇」
 * 才能复位。事实表补上了第三个来源：正文里明确写着「她穿着白衬衫」时，账本里
 * 记着 removed 的同一件衣服就该恢复穿着——证据等级 explicit 高于继承来的状态。
 *
 * 反方向（事实说 removed）不在这里处理：那条路径已有 acceptClothingChanges 的
 * 归属判据，两处都动会互相打架。
 */
export function applyExplicitFacts(state: ClothingState, facts: readonly StoryFact[]): string[] {
  if (!facts.length) return [];
  const changes: string[] = [];
  for (const [name, record] of state) {
    for (const piece of record.pieces) {
      const location = String(piece.state?.location ?? '');
      if (!location || location === 'worn') continue;
      const design = `${piece.design} ${piece.id}`.toLowerCase();
      const hit = facts.find(
        (fact) =>
          fact.kind === 'wear' &&
          fact.confidence === 'explicit' &&
          fact.subject === name &&
          fact.value
            .toLowerCase()
            .split(',')
            .map((token) => token.trim())
            .filter(Boolean)
            .some((token) => design.includes(token) || garmentKind(token) === garmentKind(piece.design)),
      );
      if (!hit) continue;
      piece.state = { ...piece.state, location: 'worn', arrangement: 'normal' };
      changes.push(`${name} 的 ${piece.design || piece.id}（正文：${hit.evidence || hit.value}）`);
    }
  }
  return changes;
}
