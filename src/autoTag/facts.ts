/**
 * 本楼事实表。
 *
 * 为什么要有这一层：提示词里的 tag 与 nl 都是「编译产物」，真正该被记住的是
 * 事实——谁穿着什么、什么被脱下了、这一刻人在哪、哪只手动的手。以前这些事实
 * 只存在于计划 JSON 的字符串里，一旦计划被丢弃就全没了，重试只能照原文再猜一遍。
 *
 * 于是要求模型在同一份回复里先写 facts 再写 images：一次请求付一次首字延迟，
 * 但「先事实、后镜头」的顺序还在；代码把 facts 收下来做一致性检查与按楼缓存，
 * 重试时把已提取的事实发回去，模型不用从零再猜。
 */
import type { ClothingChange, ClothingPiece, ClothingState } from '@/autoTag/outfitTimeline';
import type { ImageInsertion } from '@/autoTag/protocol';

export type FactConfidence = 'explicit' | 'inherited' | 'unknown';

export interface StoryFact {
  /** 人物名（与 characters[].name 同口径）或 'scene'。 */
  subject: string;
  /** wear=穿着品类 / state=穿着状态 / place=场所 / body=身体状态 / action=动作。 */
  kind: 'wear' | 'state' | 'place' | 'body' | 'action';
  /** 简短词，例如 white shirt / removed / breasts out / bathroom / his hand。 */
  value: string;
  /** 逐字引用的原文句。 */
  evidence: string;
  confidence: FactConfidence;
}

const KINDS = new Set<StoryFact['kind']>(['wear', 'state', 'place', 'body', 'action']);
const CONFIDENCE = new Set<FactConfidence>(['explicit', 'inherited', 'unknown']);
const NUDE = /^(?:nude|naked|topless|bottomless|completely nude|completely unclothed|undressed|unclothed)$/i;

export const BBI_FACTS_EXTRA_KEY = 'bbiFacts';

export interface StoredFacts {
  v: 1;
  hash: string;
  at: number;
  facts: StoryFact[];
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

/** 宽松解析：坏条目丢掉，不因一条脏数据整份失败。 */
export function parseFacts(raw: unknown, knownNames: ReadonlySet<string>): StoryFact[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryFact[] = [];
  for (const entry of raw.slice(0, 24)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const kind = text(row.kind, 12).toLowerCase() as StoryFact['kind'];
    if (!KINDS.has(kind)) continue;
    const value = text(row.value, 60);
    if (!value) continue;
    const subjectRaw = text(row.subject, 24) || 'scene';
    // 允许模型写中文全名；只接受画面里已经出现过的人名或 scene，防止幻觉生成的第三者。
    const subject = knownNames.has(subjectRaw) ? subjectRaw : subjectRaw === 'scene' ? 'scene' : '';
    if (!subject) continue;
    const confidence = (text(row.confidence, 12).toLowerCase() as FactConfidence) || 'unknown';
    out.push({
      subject,
      kind,
      value,
      evidence: text(row.evidence, 120),
      confidence: CONFIDENCE.has(confidence) ? confidence : 'unknown',
    });
  }
  return out;
}

/** 给重试用的紧凑文本；不解释字段，直接列事实。 */
export function factsBlock(facts: StoryFact[]): string {
  if (!facts.length) return '';
  const lines = facts.slice(0, 24).map((fact) => {
    const conf = fact.confidence === 'explicit' ? '' : ` [${fact.confidence}]`;
    const evidence = fact.evidence ? `（原文：${fact.evidence}）` : '';
    return `- ${fact.subject} · ${fact.kind} · ${fact.value}${conf}${evidence}`;
  });
  return ['--- 上一轮已提取的本楼事实 ---', ...lines, '沿用这些事实，不要重新推断；与正文冲突时以正文为准并说明。'].join(
    '\n',
  );
}

const NUDITY_TOKENS = new Set([
  'completely nude',
  'naked',
  'nude',
  'topless',
  'bottomless',
  'nipples',
  'no bra',
  'no panties',
]);

/**
 * 用事实表纠正画面里的裸体断言：只要这楼有「某人穿着某件衣服」的明确事实，
 * 且没有任何「裸露」事实，就把裸体词从她的 tag 里摘掉。只做减法，不新增内容。
 */
export function repairByFacts(image: ImageInsertion, facts: StoryFact[]): string[] {
  const changes: string[] = [];
  const explicitNude = facts.some(
    (fact) => fact.kind === 'state' && NUDE.test(fact.value) && fact.confidence === 'explicit',
  );
  if (explicitNude) return changes;
  for (const character of image.characters ?? []) {
    const worn = facts.filter(
      (fact) => fact.subject === character.name && fact.kind === 'wear' && fact.confidence !== 'unknown',
    );
    if (!worn.length) continue;
    const tokens = character.tag
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
    const kept = tokens.filter((token) => !NUDITY_TOKENS.has(token.toLowerCase()));
    if (kept.length === tokens.length) continue;
    character.tag = kept.join(', ');
    changes.push(`${character.name}: ${tokens.length - kept.length} 个裸体词被事实表否定`);
  }
  return changes;
}

/** 露点/掀开到哪一类词：跨场景时必须重新落地，不能继承。 */
const EXPOSURE_VALUE =
  /\b(?:breasts out|nipples|areolae|cleavage|shirt lift|skirt lift|dress lift|clothes pulled aside|clothes aside|panties aside|pussy|pussy juice|topless|bottomless|nude|naked|no bra|no panties)\b/i;

/**
 * 跨场景（第二天/换了地方）时丢掉继承来的露点事实。
 *
 * 实测教训：她第二天清晨出门那一楼，账本已经复位成「穿着整齐」，模型却写了一条
 * `inherited · state · shirt lift, breasts out` —— 它是从前面几楼的正文里继承的，
 * 于是画面让她敞着怀走出家门。explicit 的事实照留（正文真写了就成立），
 * inherited 的露点状态必须由本楼正文重新证明。
 */
export function factsAcrossSceneBreak(facts: readonly StoryFact[], sceneBreak: boolean): StoryFact[] {
  if (!sceneBreak) return [...facts];
  return facts.filter((fact) => !(fact.confidence !== 'explicit' && fact.kind === 'state' && EXPOSURE_VALUE.test(fact.value)));
}

/** 把跨场景不该继承的露点/掀开词从 tag 里摘掉（只摘词，不改别的）。 */
export function stripExposureTokens(tag: string): string {
  return tag
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token && !EXPOSURE_VALUE.test(token))
    .join(', ');
}

/**
 * 继承来的露点事实必须由账本背书。
 *
 * 关键词判「跨场景」太窄（「清晨她推开门」不含出门/上学就被漏掉），所以改成结构判据：
 * 账本里这个人没有任何一件衣服处于露着/掀开状态时，inherited 的露点事实就是凭空继承的，
 * 直接丢掉；explicit 的不动（那是本楼正文写的）。
 */
export function factsBackedByLedger(
  facts: readonly StoryFact[],
  exposed: (subject: string) => boolean,
): StoryFact[] {
  return facts.filter(
    (fact) =>
      fact.confidence === 'explicit' ||
      fact.kind !== 'state' ||
      !EXPOSURE_VALUE.test(fact.value) ||
      exposed(fact.subject),
  );
}

/**
 * 跨场景/账本没背书时，把 nl 里「衣摆掀着、胸口露着」这类句子整句删掉。
 *
 * 只删句子，不改写：tag 已经收干净了，留一句自相矛盾的散文会让 NAI 两份 caption 打架。
 */
const EXPOSURE_CLAIM =
  /(?:lifted|raised|pulled aside|pulled down|open|unbuttoned)\s+(?:her\s+)?(?:shirt|top|blouse|dress|bra|panties)|chest (?:is )?(?:bare|exposed|visible)|breasts? (?:out|exposed|visible)|nipples?|bare chest|掀|撩起|露着|敞着|胸口露|胸脯露|衣摆掀/i;
export function dropExposureClaims(nl: string): string {
  if (!nl) return '';
  return nl
    .split(/(?<=[.!?。！？])\s*/)
    .filter((sentence) => sentence.trim() && !EXPOSURE_CLAIM.test(sentence))
    .join(' ')
    .trim();
}

/**
 * 事实 → 服装变更（唯一的模型写入口）。
 *
 * 以前模型有两条自由通道：outfitChanges（部件级 patch）与 tag 字符串反推。
 * 两条通道对同一件事给出不同说法时，赢的是后写入的那条，于是「谁写进去的」没法追，
 * 归属校验也只在其中一条上生效（第 5 楼她一路裸到几十楼就是旁路写进去的）。
 * 现在模型只写 facts，这里把它翻译成部件级变更，交给与人工干预同一条校验管线。
 */
export function factsToClothingChanges(
  facts: readonly StoryFact[],
  segments: ReadonlyArray<{ id: string }>,
): ClothingChange[] {
  const position = segments[0]?.id ?? 'P1';
  const bySubject = new Map<string, StoryFact[]>();
  for (const fact of facts) {
    if (fact.subject === 'scene') continue;
    if (fact.kind !== 'wear' && fact.kind !== 'state') continue;
    if (fact.confidence === 'unknown') continue;
    const list = bySubject.get(fact.subject) ?? [];
    list.push(fact);
    bySubject.set(fact.subject, list);
  }
  const changes: ClothingChange[] = [];
  for (const [subject, own] of bySubject) {
    const pieces: ClothingChange['pieces'] = [];
    for (const fact of own) {
      if (fact.kind !== 'wear') continue;
      const design = fact.value.replace(/\s+/g, ' ').trim();
      if (!design) continue;
      const state: Record<string, string> = { location: 'worn' };
      for (const other of own) {
        if (other.kind !== 'state') continue;
        if (!mentionsGarment(other.value, design) && !appliesToArea(other.value, design)) continue;
        Object.assign(state, stateFromValue(other.value));
      }
      // id 用「衣物类别」而不是整串：账本按 id 合并，每次都换 id 会养出一堆同名残件
      // （实测 tag 里的 `shirt lift` 被当成一件独立衣服记进账本，location=unknown）。
      const kind = garmentForToken(design) || design.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
      pieces.push({ id: kind, design, state });
    }
    // 只有状态事实、没有穿着事实时，按状态里的部位补一条（例如「no bra」）。
    for (const fact of own) {
      if (fact.kind !== 'state') continue;
      const tokens = fact.value.split(',').map((token) => token.trim());
      for (const token of tokens) {
        // 「shirt lift」「breasts out」这类是状态，不是一件衣服：只有去掉状态词后
        // 还剩下衣物词时才算「补一件」。
        const garmentOnly = token
          .replace(/\b(?:lift|lifted|aside|pulled|out|open|unbuttoned|removed|down|off)\b/gi, ' ')
          .replace(/掀|撩|拉开|拉到一边|露着|敞开|解开|脱下|半露/g, ' ')
          .trim();
        const inferred = garmentForToken(garmentOnly);
        if (!inferred) continue;
        if (pieces.some((piece) => mentionsGarment(token, piece.design))) continue;
        pieces.push({
          id: inferred.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24),
          design: inferred,
          state: stateFromValue(token),
        });
      }
    }
    if (!pieces.length) continue;
    changes.push({
      name: subject,
      position,
      sourceLine: 0,
      charOffset: 0,
      operation: 'patch',
      pieces,
      evidence: own.find((fact) => fact.evidence)?.evidence ?? '',
    } as ClothingChange);
  }
  return changes;
}

const GARMENT_HINTS: Array<[RegExp, string]> = [
  [/bra|胸罩|文胸/i, 'bra'],
  [/panties|内裤|underwear/i, 'panties'],
  [/shirt|blouse|衬衣|衬衫/i, 'shirt'],
  [/skirt|百褶裙|裙/i, 'skirt'],
  [/jeans|pants|trousers|牛仔|裤/i, 'pants'],
  [/dress|连衣裙/i, 'dress'],
  [/stockings|thighhighs|丝袜|长袜/i, 'stockings'],
  [/socks|袜/i, 'socks'],
  [/shoes|sneakers|loafers|鞋/i, 'shoes'],
];

function garmentForToken(token: string): string {
  for (const [pattern, kind] of GARMENT_HINTS) if (pattern.test(token)) return kind;
  return '';
}

function mentionsGarment(value: string, design: string): boolean {
  const lower = design.toLowerCase();
  return value
    .toLowerCase()
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .some((token) => lower.includes(token) || (garmentForToken(token) && garmentForToken(token) === garmentForToken(design)));
}

function stateFromValue(value: string): Record<string, string> {
  const lower = value.toLowerCase();
  const state: Record<string, string> = {};
  if (/no (?:bra|panties)|removed|taken off|脱/.test(lower)) state.location = 'removed';
  if (/lift|掀|撩/.test(lower)) state.arrangement = 'lifted';
  if (/pulled aside|aside|拉到一边/.test(lower)) state.arrangement = 'pulled_aside';
  if (/breasts out|nipples|pussy|裸|露着/.test(lower)) state.exposure = 'bare';
  if (/cleavage|半露/.test(lower)) state.exposure = 'partial';
  if (/open|unbuttoned|解开|敞开/.test(lower)) state.fastening = 'open';
  return state;
}

/** 露点/状态词没说衣物名时，按它落在哪个部位挂到对应衣物上。 */
const AREA_OF: Array<[RegExp, RegExp]> = [
  [/breasts? out|nipples|areolae|cleavage|bare breasts|乳|胸/, /shirt|blouse|bra|dress|top|pajamas/i],
  [/pussy|panty|panties|下体|秘处|私处/, /pants|jeans|skirt|panties|shorts/i],
];

function appliesToArea(value: string, design: string): boolean {
  return AREA_OF.some(([area, garment]) => area.test(value) && garment.test(design));
}

/**
 * 把事实变更直接写进账本（模型的唯一写入口）。
 *
 * 为什么不复用 acceptClothingChanges：那一套闸门是为「模型自由自报的换装」设计的——
 * 要动作动词、要能定位的原文、要已知部件。事实本身已经带了主语与原文引用，
 * 再过一遍只会在「她穿着白衬衫」这种陈述句上被拒，然后由 tag 反推补一条 legacy 残件。
 * 所以这里直接按键写状态；校验仍然生效的部分（件名归一、状态白名单）都在下面。
 */
export function applyFactClothing(state: ClothingState, changes: readonly ClothingChange[]): string[] {
  const applied: string[] = [];
  for (const change of changes) {
    const existing = state.get(change.name);
    const record = existing ?? {
      name: change.name,
      outfitId: `facts-${change.name}`,
      pieces: [] as ClothingPiece[],
      source: 'facts',
    };
    for (const piece of change.pieces ?? []) {
      const id = piece.id || 'piece';
      const hit = record.pieces.find((p) => p.id === id);
      const cleanState: Record<string, string> = {};
      for (const [key, value] of Object.entries(piece.state ?? {}))
        if (value && /^(?:location|arrangement|fastening|exposure)$/.test(key)) cleanState[key] = value;
      if (!cleanState.location) cleanState.location = 'worn';
      if (hit) {
        hit.state = { ...hit.state, ...cleanState };
        if (piece.design) hit.design = piece.design;
      } else record.pieces.push({ id, design: piece.design || id, state: cleanState });
      applied.push(`${change.name} 的 ${piece.design || id}`);
    }
    if (!record.pieces.length) continue;
    state.set(change.name, record);
  }
  return applied;
}

/**
 * 同一个（主语, 类别, 值）只留一条；同一（主语, 类别, 部位）以 explicit 优先。
 * 模型每楼都会把「穿着白衬衫」重写一遍，不去重会把同一件事说三遍，
 * 账本合并与下发的提示词都会被这些重复句撑长。
 */
export function dedupeFacts(facts: readonly StoryFact[]): StoryFact[] {
  const order: Array<'explicit' | 'inherited' | 'unknown'> = ['explicit', 'inherited', 'unknown'];
  const best = new Map<string, StoryFact>();
  for (const fact of facts) {
    const key = `${fact.subject}|${fact.kind}|${fact.value.trim().toLowerCase()}`;
    const prev = best.get(key);
    if (!prev || order.indexOf(fact.confidence) < order.indexOf(prev.confidence)) best.set(key, fact);
  }
  return [...best.values()];
}
/**
 * 事实层的归属闸门。
 *
 * 抓到的真实错例：正文写「依旧还保持着充血状态的肉棒上挂着黏糊糊的小姨子的内裤和丝袜」，
 * 模型把「内衣与丝袜已脱下」记成温岚的 explicit 事实——她的名字只以「小姨子的」这种领属出现，
 * 动作与所属都是李斌那一侧。这类事实一旦进账本，下一楼就会把她画成全裸。
 *
 * 判据只做一件事：这条事实的主语是不是句子的施事。
 * - evidence 里出现她的名字且后面不是「的/之」→ 认；
 * - 只出现「X的」→ 看是否有别人当主语（他/自己/李斌/男主）；有就不算她的；
 * - 完全没有她的名字也没有「她」→ 不算她的（scene 除外）。
 */
export function gateFactOwnership(facts: readonly StoryFact[], aliases: readonly string[]): StoryFact[] {
  const names = aliases.filter((name) => name && name !== 'scene');
  const others = /(?:^|[\s，,。；;])(?:他|自己|李斌|男主)(?!的)/;
  return facts.filter((fact) => {
    if (fact.kind !== 'wear' && fact.kind !== 'state') return true;
    const evidence = fact.evidence ?? '';
    if (!evidence) return false;
    const hasName = names.some((name) => {
      const index = evidence.indexOf(name);
      if (index < 0) return false;
      const after = evidence.slice(index + name.length, index + name.length + 1);
      return after !== '的' && after !== '之';
    });
    if (hasName) return true;
    const pronoun = /(?:^|[\s，,。；;])她(?!的)/.test(evidence);
    if (pronoun && !others.test(evidence)) return true;
    return false;
  });
}