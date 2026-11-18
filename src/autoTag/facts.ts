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
import { garmentKind, type ClothingChange, type ClothingPiece, type ClothingState } from '@/autoTag/outfitTimeline';
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
/** 用正文补一次款式属性（只补缺失项，不改已有项）。 */
function completeDesign(design: string, source: string, evidence = ''): string {
  const tokens = design.split(',').map((token) => token.trim()).filter(Boolean);
  const lower = design.toLowerCase();
  const add = (needle: RegExp, token: string) => {
    if (needle.test(lower)) return;
    if (tokens.some((t) => t.toLowerCase() === token)) return;
    tokens.push(token);
  };
  // 颜色与袖长不只属于衬衣：睡裙、连衣裙、裙子、外套只要正文点了颜色，
  // 就要留在款式里（`white short nightgown`），否则下一楼只剩 `pajamas`，
  // 生成模型自己挑颜色和裙长，同一个人的衣服就开始漂。
  const GARMENT_LINE = /衬衣|衬衫|上衣|shirt|blouse|top|睡裙|睡衣|睡衣裤|睡袍|连衣裙|长裙|短裙|裙子|半身裙|旗袍|泳衣|泳装|外套|风衣|大衣|夹克|jacket|coat|dress|skirt|nightgown|pajamas/i;
  if (GARMENT_LINE.test(design)) {
    // 颜色同理：模型只写 shirt，正文写着「白色短袖衬衣」，白色与短袖都必须留在款式里，
    // 否则下一楼就只剩一个光秃秃的 shirt，生成模型自己挑颜色——衣服就是这样漂走的。
    // 优先只用模型引用的那句证据：整楼正文里「白色短连衣裙」会把旁边的 `pajamas`
    // 也刷成白色，长出一件不存在的 `white-pajamas`。没有证据时才退回整楼。
    const ctx = evidence.trim() ? evidence : source;
    const sentences = ctx.split(/[。！？；\n]/).filter((line) => GARMENT_LINE.test(line));
    const near = sentences.join(' ') || ctx;
    const COLOR: Array<[RegExp, string]> = [
      [/白色|白衬|雪白/, 'white'],
      [/黑色|黑衬/, 'black'],
      [/蓝色|蓝衬/, 'blue'],
      [/红色|红衬/, 'red'],
      [/粉色|粉衬/, 'pink'],
      [/灰色|灰衬/, 'grey'],
      [/米色|杏色/, 'beige'],
      [/绿色/, 'green'],
      [/紫色/, 'purple'],
    ];
    // 颜色只能挂在同一件衣服上：正文写「白色短连衣裙」不能顺手给「睡衣」也刷成白色，
    // 否则会凭空长出 `white-pajamas` 这种第二件衣服，账本立刻变成两件叠穿。
    const KIND_ZH: Array<[RegExp, RegExp]> = [
      [/\b(?:shirt|blouse|top)\b/i, /衬衣|衬衫|上衣|短袖/],
      [/\bdress\b/i, /连衣裙|长裙|短裙|裙子|裙/],
      [/\b(?:nightgown|nightdress|negligee)\b/i, /睡裙|睡袍|睡衣裙/],
      [/\b(?:pajamas|pyjamas)\b/i, /睡衣/],
      [/\bskirt\b/i, /裙子|半身裙|百褶裙/],
      [/\b(?:coat|jacket)\b/i, /外套|风衣|大衣|夹克/],
      [/\b(?:swimsuit|swim)\b/i, /泳衣|泳装/],
    ];
    const sameKind = KIND_ZH.find(([en]) => en.test(design));
    const kindLine = sameKind ? sameKind[1].test(near) || sameKind[1].test(source) : true;
    const hasColor = /\b(?:white|black|blue|red|pink|grey|gray|beige|green|purple|navy)\b/i.test(design);
    if (!hasColor && kindLine)
      for (const [pattern, token] of COLOR)
        if (pattern.test(near)) {
          // 颜色是修饰词，要贴在衣物词前面（white shirt），不能自己单独成一项（white, shirt）。
          tokens[0] = `${token} ${tokens[0]}`;
          break;
        }
    if (/短袖/.test(near)) add(/short sleeves?/, 'short sleeves');
    else if (/长袖/.test(near)) add(/long sleeves?/, 'long sleeves');
    else if (/无袖|吊带/.test(near)) add(/sleeveless/, 'sleeveless');
  }
  return tokens.join(', ');
}

/** 本楼没写某人的穿着事实时，用账本里已有的款式补一条继承事实。 */
export function inheritWearFacts(facts: readonly StoryFact[], wardrobe: ClothingState): StoryFact[] {
  const covered = new Set(facts.filter((f) => f.kind === 'wear').map((f) => f.subject));
  const extra: StoryFact[] = [];
  for (const record of wardrobe.values()) {
    if (!record?.name || covered.has(record.name)) continue;
    const designs = (record.pieces ?? [])
      .filter((piece) => piece.state?.location === 'worn' && piece.design)
      .map((piece) => piece.design);
    for (const design of designs)
      extra.push({
        subject: record.name,
        kind: 'wear',
        value: design,
        evidence: '（沿用上一楼账本）',
        confidence: 'inherited',
      });
  }
  return extra;
}

/** 连体类归并：这三件同时出现在 facts 里时，她身上只能穿其中一件。 */
// 连体衣占同一格：睡衣、连衣裙、泳装同时在账本里会渲染成「两件套在身上」，
// 画面里就出现「短睡裙 + 白连衣裙」这种根本不存在的穿法。写入时只留最新一件。
const ONEPIECE_KINDS = new Set(['pajamas', 'dress', 'swim']);

function dropOtherOnepieces(pieces: ClothingPiece[], keep: string): void {
  if (!ONEPIECE_KINDS.has(keep)) return;
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const kind = garmentKind(pieces[index].design) || pieces[index].id;
    if (kind !== keep && ONEPIECE_KINDS.has(kind)) pieces.splice(index, 1);
  }
}

const AREA_OF_KIND: Record<string, string> = {
  shirt: 'upper',
  jacket: 'upper',
  dress: 'onepiece',
  pajamas: 'onepiece',
  swim: 'onepiece',
  skirt: 'lower',
  pants: 'lower',
  bra: 'inner-top',
  panties: 'inner-bottom',
  socks: 'feet',
  shoes: 'feet',
  lingerie: 'inner-top',
  accessory: 'accessory',
};

const OUTFIT_FAMILY: Record<string, string> = {
  nightgown: 'onepiece',
  pajamas: 'onepiece',
  dress: 'onepiece',
  swimsuit: 'onepiece',
  swim: 'onepiece',
};

export function factsToClothingChanges(
  facts: readonly StoryFact[],
  segments: ReadonlyArray<{ id: string }>,
  source = '',
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
      // 款式要「首次补全一次」：正文写了白色短袖衬衣，模型在 facts 里只写 white shirt，
      // 袖长就永久丢了（后面每楼只能照抄 white shirt）。这里把正文能读出的属性补进款式，
      // 存进账本后由继承长期沿用，源文之后不再提它也不会掉。
      const design = completeDesign(fact.value.replace(/\s+/g, ' ').trim(), source, fact.evidence);
      if (!design) continue;
      const state: Record<string, string> = { location: 'worn' };
      for (const other of own) {
        if (other.kind !== 'state') continue;
        if (!mentionsGarment(other.value, design) && !appliesToArea(other.value, design)) continue;
        Object.assign(state, stateFromValue(other.value));
      }
      // id 用「衣物类别」而不是整串：账本按 id 合并，每次都换 id 会养出一堆同名残件
      // （实测 tag 里的 `shirt lift` 被当成一件独立衣服记进账本，location=unknown）。
      // 部件 id 只认「品类」（garmentKind 是唯一口径）：同一条牛仔短裤写成
      // blue denim shorts / denim shorts / jean shorts / shorts 时，按整串生成 id
      // 会记成四条独立的裤子，账本里就叠了四条腿的裤子。品类认不出才退回整串。
      const kind = garmentKind(design) || garmentForToken(design) || design.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
      const area = AREA_OF_KIND[kind] ?? kind;
      // 同一身体区域只能有一件：模型常把「睡裙」「睡衣」「连衣裙」当成三件分别写进 facts，
      // 全都当 wear 记录就会变成「她同时穿了三件」——出图时模型只能挑一件画，字幕就漂。
      // 这里按「家庭」归并：连体类（睡裙/睡衣/连衣裙/泳装）算一件，款式取更具体的那条。
      // 同一身体区域只留一件：上衣/下装/内衣/袜/鞋各一件，连体类另有家庭归并。
      // 模型把「运动套装」「校服」「牛仔裤」各写一遍是很常见的，按区域归并才能
      // 避免「同一条腿穿三条裤子」这种叠穿账本。
      const existing = pieces.find((piece) =>
        piece.id === kind ||
        (OUTFIT_FAMILY[piece.id] && OUTFIT_FAMILY[piece.id] === OUTFIT_FAMILY[kind]) ||
        area !== 'onepiece' && area !== 'accessory' && (AREA_OF_KIND[piece.id] ?? piece.id) === area,
      );
      if (existing) {
        // 连体衣物同族合并时，留描述更全的那个 design（`white short nightgown` 比
        // `pajamas` 有信息量）；同长度再按 mergeDesign 补属性。否则「白色、短款」
        // 这些画面真正要用的限定词会在归并里被最短的那件吃掉。
        // 同族之间只是叫法不同（睡衣/睡裙/连衣裙），谁词多留谁，不做拼接——
        // 拼起来会变成 `pajamas, nightgown` 这种叠穿词串，画面会真穿两件。
        const richer = design.split(/\s+/).length > existing.design.split(/\s+/).length ? design : existing.design;
        existing.design = richer;
        Object.assign(existing.state, state);
        continue;
      }
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
/** 同一件衣服的款式合并：保留旧细节、追加新出现的属性；完全换一件才整体替换。 */
function mergeDesign(oldDesign: string, nextDesign: string): string {
  const tokens = (value: string) =>
    value
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  const oldTokens = tokens(oldDesign);
  const nextTokens = tokens(nextDesign);
  if (!nextTokens.length) return oldDesign;
  if (!oldTokens.length) return nextDesign;
  const nextSet = new Set(nextTokens);
  // 泛化（下一楼只写「衬衫」）：保留完整款式。
  if (nextTokens.every((token) => oldTokens.includes(token))) return oldDesign;
  // 完全不相交且新描述本身够具体：按换了一件衣服处理。
  if (nextTokens.length >= 2 && oldTokens.every((token) => !nextSet.has(token))) return nextDesign;
  // 其余是「补充属性」：旧顺序不动，把新出现的追加在后面。
  const merged = [...oldTokens];
  for (const token of nextTokens) if (!merged.includes(token)) merged.push(token);
  return merged.join(', ');
}

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
        // 款式只许变详细，不许被泛化：模型为了表示「还是那件」只写 `wear=shirt`，
        // 如果直接覆盖，上一楼的 `white shirt, short sleeves` 就退化成 `shirt`，
        // 下一轮生成模型只能重新猜颜色与袖长——这是衣服跨楼漂移的第一条根因。
        if (piece.design) hit.design = mergeDesign(hit.design, piece.design);
      } else {
        dropOtherOnepieces(record.pieces, id);
        record.pieces.push({
          id,
          design: piece.design || id,
          state: cleanState,
          garmentId: piece.garmentId || `${change.name}#g${record.pieces.length + 1}`,
        });
      }
      if (hit && !hit.garmentId) hit.garmentId = `${change.name}#g${record.pieces.indexOf(hit) + 1}`;
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
    // 「肉棒上挂着黏糊糊的小姨子的内裤和丝袜」：衣物确实属于她，但挂在别人身上，
    // 那既不是她穿着，也不是她脱下。整句里的名字/代词都通不过这一关。
    const carried = /(?:肉棒|阴茎|龟头|精液|囊袋|他的?手|他的?身上)[^。！？；\n]{0,24}(?:内裤|内衣|胸罩|丝袜|袜|裤|裙)/.test(evidence);
    if (carried) return false;
    const pronoun = /(?:^|[\s，,。；;])她(?!的)/.test(evidence);
    if (pronoun && !others.test(evidence)) return true;
    return false;
  });
}

/**
 * 记住「最近一次完整穿搭」。
 *
 * 跨天恢复要的是「她上次好好穿衣服时到底是什么样」，而不是上一楼那张图的 tag。
 * 只在看起来真的穿整齐了（上身有件、下身有件，或整件连衣裙）时更新，半脱/全裸不覆盖。
 */
export function rememberCompleteOutfit(state: ClothingState, at: number): string[] {
  const updated: string[] = [];
  for (const record of state.values()) {
    const worn = record.pieces.filter((piece) => piece.state?.location !== 'removed');
    if (!worn.length) continue;
    const kinds = worn.map((piece) => garmentKind(piece.design));
    const upper = kinds.some((kind) => /shirt|blouse|top|sweater|jacket|coat|dress|pajamas|swim/.test(kind));
    const lower = kinds.some((kind) => /skirt|pants|shorts|jeans|dress|pajamas|swim/.test(kind));
    if (!(upper && lower)) continue;
    const dressed = worn.every(
      (piece) =>
        piece.state?.location === 'worn' &&
        (piece.state?.arrangement ?? 'normal') === 'normal' &&
        (piece.state?.fastening ?? 'closed') !== 'open' &&
        !piece.state?.exposure,
    );
    if (!dressed) continue;
    record.lastComplete = worn.map((piece) => ({ ...piece, state: { ...piece.state } }));
    updated.push(record.name);
  }
  return updated;
}

/**
 * 跨场景恢复：把「最近完整穿搭」变成显式事实，交回给统一的写入口。
 *
 * 不直接改账本，是为了让这次复原和其它事实一样有出处、能被账本层复核；
 * 也不按整楼扫「第二天」就全员复位——只对当前确实没穿齐的人复原。
 */
export function restoreOutfitFacts(
  state: ClothingState,
  reason: string,
): { facts: StoryFact[]; restored: string[] } {
  const facts: StoryFact[] = [];
  const restored: string[] = [];
  for (const record of state.values()) {
    const snapshot = record.lastComplete ?? [];
    if (!snapshot.length) continue;
    const worn = record.pieces.filter((piece) => piece.state?.location === 'worn');
    const exposed = worn.some(
      (piece) => piece.state?.exposure || piece.state?.arrangement === 'lifted' || piece.state?.arrangement === 'pulled_aside',
    );
    if (worn.length && !exposed) continue;
    restored.push(record.name);
    for (const piece of snapshot)
      facts.push({
        subject: record.name,
        kind: 'wear',
        value: piece.design,
        evidence: `[跨场景恢复] ${reason}`,
        confidence: 'inherited',
      });
  }
  return { facts, restored };
}

/**
 * 用「最终的 tag」校准账本：tag 里确实画在身上的衣物必须在账本里是 worn，
 * 且账本里同一品类被记成 removed/floor 的残件要被这次真实穿着纠正。
 *
 * 为什么需要这一层：facts 是模型自述，会漏（她穿白衬衣没写进 facts）、也会错
 * （把别人的内裤写成她脱下）。tag 是这一楼真正要画的画面，两者不一致时，
 * 以 tag 为准——否则会出现「tag 穿着衬衣、账本说她一丝不挂，下一楼沿用裸奔」。
 */
export function reconcileLedgerWithTags(
  state: ClothingState,
  frames: ReadonlyArray<{ name: string; tag: string }>,
): string[] {
  const touched: string[] = [];
  for (const frame of frames) {
    const record = state.get(frame.name);
    if (!record) continue;
    const tokens = frame.tag.split(',').map((token) => token.trim()).filter(Boolean);
    const rendered = new Set(tokens.map((token) => garmentKind(token)).filter(Boolean) as string[]);
    const seen = new Set<string>();
    for (const token of tokens) {
      // `no pants` / `no bra` 是否定词：它说的是「没穿」，不是「穿着这件」。
      // 当成穿着会让账本凭空多出一条裤子（实机第 12 楼 tag 里写着 `no pants`，
      // 账本却把牛仔裤补成 worn，与短裙同时穿在身上）。
      if (/^(?:no|without|not)\b/i.test(token)) continue;
      const kind = garmentKind(token);
      if (!kind) continue;
      seen.add(kind);
      // 历史件可能是空 design、id 却正好是品类名；只按 design 认品类会把它当成
      // 「另一件」，同一品类就叠成两条（实机第 16 楼出现 shirt+shirt、skirt+skirt）。
      const same = record.pieces.filter((piece) => (garmentKind(piece.design) || piece.id) === kind);
      if (!same.length) {
        // tag 里画着一件账本没记过的衣服：补一条 worn（款式取 tag 原词）。
        // 连体衣先清掉同格位的旧件，否则睡裙与连衣裙会在账本里同时穿着。
        dropOtherOnepieces(record.pieces, kind);
        record.pieces.push({
          id: kind,
          design: token,
          state: { location: 'worn', arrangement: 'normal', fastening: 'closed' },
        } as ClothingPiece);
        touched.push(`${frame.name}:${kind}=补记`);
        continue;
      }
      for (const piece of same) {
        const location = piece.state?.location;
        if (location && location !== 'worn') {
          piece.state = { ...piece.state, location: 'worn' };
          touched.push(`${frame.name}:${kind}=穿回`);
        }
      }
    }
    // 同一格位只能穿一件：这一楼画的是 T 恤 + 短裙，账本里却还留着上一楼的牛仔裤
    // 与睡袍（实机第 12 楼 `pants` 与 `skirt` 同时 worn，tag 里根本没有裤子）。
    // 模型这一楼真正画出来的那件为准，同区域其余被穿着的旧件收起。
    // 按格位分组（不是按品类）：裤子与短裙同属下半身，两个品类却互相不知道对方。
    // 首版按品类遍历，`pants` 与 `skirt` 各只有一件，永远凑不满两条，白写。
    const byArea = new Map<string, ClothingPiece[]>();
    for (const piece of record.pieces) {
      if (piece.state?.location !== 'worn') continue;
      const kind = garmentKind(piece.design) || piece.id;
      const area = AREA_OF_KIND[kind] ?? '';
      if (!area || area === 'onepiece' || area === 'accessory') continue;
      byArea.set(area, [...(byArea.get(area) ?? []), piece]);
    }
    for (const [area, worn] of byArea) {
      if (worn.length < 2) continue;
      // 这一楼真正画出来的那件留（tag 里出现的），其余收起。
      const keep = worn.find((piece) => rendered.has(garmentKind(piece.design) || piece.id)) ?? worn[worn.length - 1];
      for (const piece of worn) {
        if (piece === keep) continue;
        piece.state = { ...piece.state, location: 'removed' };
        touched.push(`${frame.name}:${area}=同格位收起`);
      }
    }
    // 反过来：这一楼既没画、也没被点名穿着的衣服要收起来。不收会越长越多
    // （连衣裙、外套、袜子一层层叠上去），下一楼模型看见一堆穿着就会挑错，
    // 画面里出现正文没写的衣服。内衣例外——它常常被外衣盖住，渲染不出来不代表没穿。
    const keepInner = new Set(['bra', 'panties', 'lingerie']);
    // 这一楼根本没写衣着（特写、背影、被裁掉的画面）时不要收——没有证据
    // 不等于没穿：第 2 楼就是这么把睡裙收没的，只剩内衣挂了一路。
    if (!rendered.size) continue;
    const before = record.pieces.length;
    record.pieces = record.pieces.filter((piece) => {
      const kind = garmentKind(piece.design) || piece.id;
      return rendered.has(kind) || seen.has(kind) || keepInner.has(kind);
    });
    if (record.pieces.length !== before) touched.push(`${frame.name}=收起 ${before - record.pieces.length} 件未出镜衣物`);
  }
  return touched;
}
