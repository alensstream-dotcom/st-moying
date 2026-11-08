/**
 * 素材库召回层(loreIndex):把「正文 + 设置」压成一段能直接塞进 prompt 的候选清单。
 *
 * 分层:
 * - wardrobe.ts / poseBank.ts / faceBank.ts 只存数据(款式指纹);
 * - loreMatch.ts 只做打分排序;
 * - 本文件负责「召回策略 + 渲染成给模型看的文字」,是唯一被 autoTag 调用的入口。
 *
 * 三处策略,都是冲着「生成结果雷同」这个现象定的:
 *
 * 1. **单类命中时放大配额。** 正文只写了「黑丝」,匹配结果必然全落在 hosiery 一类;
 *    这时如果还按「每类 2 条」截断,模型看到的候选就只有 2 条,还是回到老路。
 *    所以命中类别越少,单类配额越大(1 类 → 6 条,2 类 → 3 条,≥3 类 → 2 条),
 *    保证「一个泛词」也能拿到足够多的差异款。
 * 2. **候选只用于「照抄」,不用于「参考」。** 块头写死:库里有对应条目时必须用库里的版本,
 *    不得替换成更泛的词。否则模型会把 `lace-trimmed sheer black pantyhose` 又简化回 `pantyhose`,
 *    整个库白建。
 * 3. **没命中就不注入。** 宁可少一块上下文,也不要塞一堆无关条目把正文挤到后面去。
 */

import { WARDROBE_CATEGORIES, WARDROBE_ITEMS } from '@/data/wardrobe';
import { POSE_CATEGORIES, POSE_ITEMS } from '@/data/poseBank';
import { BODY_PRESETS, FACE_PRESETS, FANDOM_PRESETS } from '@/data/faceBank';
import { BODY_EXTRA, FACE_EXTRA, FANDOM_EXTRA } from '@/data/faceExtra';
import { FANDOM_EXTRA_2 } from '@/data/fandomExtra2';
import { scoreLore } from '@/data/loreMatch';
import {
  LOOK_DIMENSION_LABEL,
  compareLook,
  isLookPin,
  lookTextOf,
  scanLook,
} from '@/data/lookMatch';
import { customPoses, customWardrobe } from '@/data/customLore';
import type {
  BodyPreset,
  FacePreset,
  FandomPreset,
  LoreItemBase,
  NsfwLevel,
  PoseEntry,
  WardrobeItem,
} from '@/data/loreTypes';

export interface LoreOptions {
  /** 允许出现的最高 NSFW 档;默认 3。 */
  maxNsfw?: NsfwLevel;
  /** 服装候选条数上限,默认 8。 */
  wardrobeLimit?: number;
  /** 姿势候选条数上限,默认 6。 */
  poseLimit?: number;
  /** 是否召回人物外貌指纹;默认开(含同人骨相)。 */
  faces?: boolean;
  /** 人物外貌候选条数上限,默认 8。 */
  faceLimit?: number;
  /** 角色气质词,用于给对味条目加权。 */
  vibes?: string[];
  /**
   * 轮转摇号种子。同一种子的同一句话召回结果固定(单测可复现);
   * 不同种子在**同分候选**之间换人,治「同一句『事业女』永远同一套衣服」。
   * 缺省 0 = 不摇号,严格按分数(旧行为)。
   */
  rollSeed?: number;
}

export interface LoreHit<T extends LoreItemBase> {
  item: T;
  score: number;
  /** 命中的触发词,按长度降序;渲染进候选行,便于解释「为什么它在这里」。 */
  hits: string[];
  category: string;
  /**
   * 是否由正文**直接点名**该角色/作品命中。
   * 同人骨相靠它区分「正文提到了这个人」与「只是泛词撞上」,两类在渲染时措辞不同。
   */
  direct?: boolean;
  /**
   * 正文的外形描写与这条条目**高度重合**(发色/瞳色/种族等多维对上且无冲突)。
   * 渲染时改写成「照抄这条,不要自己编」,并压到候选第一位。
   */
  pinned?: boolean;
  /** pinned 时命中/冲突的维度中文名,写进候选行。 */
  lookNote?: string;
}

export interface LoreCandidates {
  wardrobe: LoreHit<WardrobeItem>[];
  poses: LoreHit<PoseEntry>[];
  faces: LoreHit<FaceCard>[];
}

/** 人物指纹的三种来源:脸型 / 体型 / 同人角色。 */
export type FaceCardKind = 'face' | 'body' | 'fandom';
export type FaceCard = (FacePreset | BodyPreset | FandomPreset) & { kind: FaceCardKind };

/**
 * 三类人物预设拼成一张表。
 *
 * 为什么不直接把 three tables 塞进 pickDiverse:命中词不同来源不同(「清冷」是脸型词,
 * 「精灵」是同人词),拼在一起后 categoryOf 用 kind 区分,配额就自然按三类分。
 */
export const FACE_CARDS: FaceCard[] = [
  ...[...FACE_PRESETS, ...FACE_EXTRA].map(preset => ({ ...preset, kind: 'face' as const })),
  ...[...BODY_PRESETS, ...BODY_EXTRA].map(preset => ({ ...preset, kind: 'body' as const })),
  ...[...FANDOM_PRESETS, ...FANDOM_EXTRA, ...FANDOM_EXTRA_2].map(preset => ({ ...preset, kind: 'fandom' as const })),
];

const WARDROBE_CATEGORY_LABEL = new Map<string, string>(WARDROBE_CATEGORIES.map(c => [c.id, c.label]));
const POSE_CATEGORY_LABEL = new Map<string, string>(POSE_CATEGORIES.map(c => [c.id, c.label]));

/**
 * 按「命中类别数」自适应配额挑选:分数降序,同类别累计不超过 perCat。
 * 纯函数,便于单测与 UI 复用。
 *
 * **同分摇号**:给了 rollSeed 时,分数相同的候选先按种子打乱再排序。
 * 这是治「同一个泛词永远同一套衣服」的关键——只按分数截断时,
 * 一句「事业女」命中的条目集合固定、排序也固定,模型每次看到的候选就是同一批,
 * 它当然每次都挑第一条。摇号只动**同分**的部分,高分条目照样在前,不会挑出明显更差的款。
 */
export function pickDiverse<T extends LoreItemBase>(
  items: readonly T[],
  text: string,
  categoryOf: (item: T) => string,
  options: { limit: number; maxNsfw?: NsfwLevel; vibes?: string[]; rollSeed?: number },
): LoreHit<T>[] {
  const maxNsfw = options.maxNsfw ?? 3;
  const vibes = options.vibes ?? [];
  // limit 0 表示「这一类不要」,必须直接返回空:否则下面的循环会在 push 后才 break,
  // 仍然漏出一条出去(设置页把条数调到 0 时就会多出一块不该有的候选)。
  if (!(options.limit > 0)) return [];
  const scored: LoreHit<T>[] = [];
  for (const item of items) {
    if (item.nsfw > maxNsfw) continue;
    const { score, hits } = scoreLore(item, text, vibes);
    if (score > 0) scored.push({ item, score, hits, category: categoryOf(item) });
  }
  if (!scored.length) return [];
  const tieOrder = tieBreaker(options.rollSeed ?? 0);
  scored.sort((a, b) =>
    b.score - a.score || (options.rollSeed ? tieOrder(a.item.id) - tieOrder(b.item.id) : a.item.id.localeCompare(b.item.id)),
  );
  const categories = new Set(scored.map(hit => hit.category));
  const perCat = categories.size <= 1 ? 6 : categories.size === 2 ? 3 : 2;
  const used = new Map<string, number>();
  const picked: LoreHit<T>[] = [];
  for (const hit of scored) {
    const count = used.get(hit.category) ?? 0;
    if (count >= perCat) continue;
    used.set(hit.category, count + 1);
    picked.push(hit);
    if (picked.length >= options.limit) break;
  }
  return picked;
}

/**
 * 同分排序键:种子为 0 时退回 id 字典序(旧行为,单测稳定);
 * 有种子时按 (id, 种子) 哈希成一个稳定伪随机数,同分条目每次都换个先后。
 */
function tieBreaker(seed: number): (id: string) => number {
  if (!seed) return () => 0;
  const cache = new Map<string, number>();
  return (id: string) => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    let hash = 2166136261 ^ seed;
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const value = (hash >>> 0) / 4294967296;
    cache.set(id, value);
    return value;
  };
}

/**
 * 人物外貌召回。
 *
 * 与服装/姿势的三点不同,每一点都对着「同人角色从来没被抽到过」这个现象:
 *
 * 1. **三类各给配额,不再共用 pickDiverse。** 原先 face/body/fandom 三类塞进同一个
 *    pickDiverse,categoryOf 返回 kind,≥3 类时 perCat 被压到 2,faces 的 limit 又只有 4
 *    —— 脸型、体型、同人互相挤,同人几乎排不进来(它分数还常常最低)。
 *    现在脸型/体型各 2~3 条,同人单独给 3~4 条。
 * 2. **同人不必等正文点名作品。** 原先块头写「同人角色只在正文明确指向该作品的该角色时使用」,
 *    而正文几乎从不写作品名,模型当然一次都不选。现在同人条目靠三类线索召回:
 *    点名(aliases 里的角色名/作品名,最高分)、气质词(vibe)、外形容貌词(hair/eyes 词对得上
 *    正文写的发色瞳色),并在渲染时按命中类型分开写用法。
 * 3. **同人条目的 tags 自带权重语法 `0.6::xxx::`。** 命中时原样照抄即可,权重由库里定,
 *    不靠模型自己拿捏「像到什么程度」。
 */
function collectFaceCandidates(
  body: string,
  options: LoreOptions,
): LoreHit<FaceCard>[] {
  const limit = Math.max(0, options.faceLimit ?? 8);
  if (!limit) return [];
  const maxNsfw = options.maxNsfw ?? 3;
  const vibes = options.vibes ?? [];
  const picked: LoreHit<FaceCard>[] = [];
  // 同分次序:有种子时按种子摇号,没种子(0)时退回 id 字典序(与 pickDiverse 同口径)
  const rollSeed = options.rollSeed ?? 0;
  const tieOrder = tieBreaker(rollSeed);
  const tie = (a: string, b: string): number =>
    rollSeed ? tieOrder(a) - tieOrder(b) : a.localeCompare(b);

  // 同人:外形重合 > 点名 > 气质 > 外形词。
  //
  // 外形重合排在最前是刻意的:正文把角色写成「银白长发、紫瞳、尖耳精灵」时,库里有条一模一样的
  // 骨相,那就不该让模型再凭空编一张脸——命中维度够多且无冲突时打 pinned,顶到第一位。
  // 点名其次:只写了名字没写外形时,同人条目照样是这张脸的底子。
  const fandom: LoreHit<FaceCard>[] = [];
  const hay = body.toLowerCase();
  const bodyLook = scanLook(body);
  for (const card of FACE_CARDS) {
    if (card.kind !== 'fandom' || card.nsfw > maxNsfw) continue;
    const preset = card as FandomPreset;
    const franchise = (preset.franchise ?? '').trim();
    // 只有「不是泛词」的命中才算点名:同人表里也有 长发 / 精灵 / 人妻 这类泛词,
    // 把它们当点名会让 direct 永远成立,「正文点名」与「只是外形撞上」就分不开了。
    const named = preset.aliases.filter(alias => alias.length >= 2 && body.includes(alias) && !GENERIC_ALIASES.has(alias));
    const direct = named.length > 0 || (franchise.length >= 2 && hay.includes(franchise.toLowerCase()));
    const { score, hits } = scoreLore(card, body, vibes);
    // 没有点名时,正文的发色/瞳色与条目的 hair/eyes 对得上也算线索:
    // 「白色长发」这种写法在正文里很常见,而 aliases 里只有人名和作品名,永远撞不上。
    // 这一类只给弱分(3/词),保证它排在任何真人名命中之后,但足以让同人条目进候选。
    const looks = looksLike(card, hay);
    // 外形多维重合:与「对上一两个色词」是两件事,单独算一份并压过一切。
    const look = compareLook(bodyLook, scanLook(lookTextOf(card)));
    const pinned = isLookPin(look);
    // 注意用 looks.length:空数组是 truthy,写 !looks 会让零线索的条目混进来(分数还是 0)。
    if (!score && !looks.length && !pinned) continue;
    // 点名命中直接抬到最高档:正文写了「碧蓝档案」就该优先给它的人,而不是同分的路人骨相。
    // 只对上报色瞳色的给弱分(每词 3 分),够进候选但排在点名之后。
    // pinned 再压一层(命中维度越多越高),外形写得越具体越该照抄库里的,而不是自己编。
    const base = direct ? score + 100 : score || looks.length * 3;
    const finalScore = pinned ? base + 200 + look.matched * 10 : base;
    fandom.push({
      item: card,
      score: finalScore,
      hits: looks ? [...hits, ...looks] : hits,
      category: 'fandom',
      direct,
      pinned,
      lookNote: pinned ? look.dimensions.map(dimension => LOOK_DIMENSION_LABEL[dimension]).join('、') : undefined,
    });
  }
  fandom.sort(
    (a, b) =>
      b.score - a.score ||
      (a.direct === b.direct ? tie(a.item.id, b.item.id) : a.direct ? -1 : 1),
  );

  // 脸型与体型:正文写了气质/外形词才召回,与原先口径一致。
  const byKind = (kind: FaceCardKind): LoreHit<FaceCard>[] => {
    const scored: LoreHit<FaceCard>[] = [];
    for (const card of FACE_CARDS) {
      if (card.kind !== kind || card.nsfw > maxNsfw) continue;
      const { score, hits } = scoreLore(card, body, vibes);
      if (score > 0) scored.push({ item: card, score, hits, category: kind });
    }
    // 同分摇号同样要作用在这里:脸型/体型的库大、同分极多,不摇号的话
    // 「清冷」永远只出同一张脸,用户看到的是每个新角色长一个样。
    scored.sort((a, b) => b.score - a.score || tie(a.item.id, b.item.id));
    return scored;
  };

  // 同人先占位:有 pinned / direct 命中时给 4 条(多个同人同框的场合够用),
  // 只有气质/外形擦边时给 2 条,把位置让给脸型体型。
  const directHit = fandom.some(hit => hit.direct || hit.pinned);
  const fandomLimit = directHit ? Math.min(4, limit) : Math.min(2, limit);
  picked.push(...fandom.slice(0, fandomLimit));

  const rest = limit - picked.length;
  if (rest > 0) {
    // 没有同人命中时,脸型 + 体型才能补满;有同人时每类各留 1~2 条做底。
    const perKind = directHit ? Math.max(1, Math.floor(rest / 2)) : Math.ceil(rest / 2);
    picked.push(...byKind('face').slice(0, perKind));
    picked.push(...byKind('body').slice(0, limit - picked.length));
  }

  // 兜底:一条都没召回时不能给空块。
  //
  // 正文只写「蓝发黄瞳」这种纯色描述时,气质词一个都没有,而同人表里又恰好没有
  // 蓝发黄瞳的组合,上面两步就全军覆没——模型拿到的是空候选,只能自己编。
  // 此时按摇号顺序塞几条脸型/体型当底子,总比空块强;它们没命中词,渲染时也不会
  // 被说成「正文点名」,只是「挑一条最近的」。
  if (!picked.length) {
    const anyKind = (kind: FaceCardKind): LoreHit<FaceCard>[] =>
      FACE_CARDS.filter(card => card.kind === kind && card.nsfw <= maxNsfw)
        .sort((a, b) => tie(a.id, b.id))
        .map(card => ({ item: card, score: 0, hits: [], category: kind }));
    picked.push(...anyKind('face').slice(0, Math.max(1, Math.ceil(limit / 2))));
    picked.push(...anyKind('body').slice(0, limit - picked.length));
  }
  return picked.slice(0, limit);
}

/**
 * 正文的发色/瞳色是否与条目的 hair/eyes 对得上。
 *
 * 只在正文里**同时**出现那份发色和瞳色时才给分(两条都要,只对上一条太容易),
 * 每条按 3 分计——低于任何一个真人名命中的长度分,所以它永远排在点名之后,
 * 只用来「填满候选」,不会把正文点名的角色顶掉。
 *
 * 正文通常是中文(「白色长发」「紫瞳」),所以颜色要按中文词表比对英文词;
 * 只认颜色名,不认长度与发质,避免 long hair 撞上「长」这种满篇都有的字。
 */
function looksLike(card: FaceCard, hay: string): string[] {
  if (card.kind !== 'fandom') return [];
  const preset = card as FandomPreset;
  const colors = (text: string): string[] =>
    text
      .toLowerCase()
      .split(/[,，]/)
      .flatMap(part => part.replace(/\b(hair|eyes)\b/g, ' ').split(/\s+/))
      .map(color => COLOR_ALIASES[color] ?? color)
      .filter(color => color && color.length >= 2);
  const hair = colors(preset.hair ?? '');
  const eyes = colors(preset.eyes ?? '');
  if (!hair.length || !eyes.length) return [];
  // 发色与瞳色必须各自命中,而且不能是同一个色(白毛紫瞳对得上,白毛蓝瞳也对不上)。
  const hairHit = hair.find(color => hay.includes(color));
  const eyeHit = eyes.find(color => hay.includes(color));
  if (!hairHit || !eyeHit) return [];
  return [hairHit, eyeHit];
}

/**
 * 泛词:同人表里也收了一堆这类别名,不能当「正文点名了这个人」的证据。
 * 判据是「这个词套在任何角色身上都成立」——长发、精灵、人妻、弟子都是。
 */
const GENERIC_ALIASES = new Set([
  '长发',
  '短发',
  '银发',
  '金发',
  '黑发',
  '白发',
  '精灵',
  '人妻',
  '弟子',
  '大魔法使',
  '学生',
  '少女',
  '姐姐',
  '恶魔',
  '天使',
  '女仆',
  '骑士',
  '巫女',
  '修女',
  '会长',
  '社长',
]);

/**
 * 颜色词的英文 → 中文近似写法。只为比对正文用,不影响写进 tag 的词。
 * 收常见发色瞳色;另外把相近色并到同一组,免得「白发」对不上 white 之外的 silver。
 */
const COLOR_ALIASES: Record<string, string> = {
  white: '白',
  silver: '银',
  blonde: '金',
  golden: '金',
  black: '黑',
  brown: '棕',
  red: '红',
  pink: '粉',
  purple: '紫',
  violet: '紫',
  lilac: '紫',
  lavender: '紫',
  blue: '蓝',
  azure: '蓝',
  green: '绿',
  orange: '橙',
  grey: '灰',
  gray: '灰',
  cyan: '青',
  turquoise: '青',
  teal: '青',
  multicolored: '挑染',
  streaked: '挑染',
};

/** 服装 + 姿势 + 人物外貌一次召回。正文为空/无命中时对应数组为空。 */
export function collectLoreCandidates(text: string, options: LoreOptions = {}): LoreCandidates {
  const body = (text ?? '').trim();
  if (!body) return { wardrobe: [], poses: [], faces: [] };
  return {
    wardrobe: pickDiverse(allWardrobeItems(), body, item => item.category, {
      limit: options.wardrobeLimit ?? 8,
      maxNsfw: options.maxNsfw,
      vibes: options.vibes,
      rollSeed: options.rollSeed,
    }),
    poses: pickDiverse(allPoseItems(), body, item => item.category, {
      limit: options.poseLimit ?? 6,
      maxNsfw: options.maxNsfw,
      vibes: options.vibes,
      rollSeed: options.rollSeed,
    }),
    faces: options.faces ? collectFaceCandidates(body, options) : [],
  };
}

/** 一行的渲染:`- [分类] 名字: tags`(命中词与 note 追加在后面,不占主行)。 */
function renderLine<T extends LoreItemBase>(
  hit: LoreHit<T>,
  categoryLabel: string,
  extra?: string,
): string {
  const hits = hit.hits.slice(0, 3).join('、');
  const note = (hit.item.note ?? '').trim();
  const tail = [hits ? `命中：${hits}` : '', note].filter(Boolean).join('；');
  const head = `- [${categoryLabel}] ${hit.item.name}: ${hit.item.tags}`;
  return tail ? `${head}${extra ? ` | ${extra}` : ''}\n  （${tail}）` : head;
}

/**
 * 渲染注入 prompt 的候选块。返回空串表示不需要注入。
 *
 * 块的措辞是有意的:它不请求模型「参考」,而是要求「照抄」——因为这个协议里
 * tag 是字段值,不是创作。候选行自带命中词,模型能自己核对是哪句正文触发的。
 */
export function buildLoreBlock(text: string, options: LoreOptions = {}): string {
  const { wardrobe, poses, faces } = collectLoreCandidates(text, options);
  if (!wardrobe.length && !poses.length && !faces.length) return '';
  const parts: string[] = [];

  if (wardrobe.length) {
    const lines = wardrobe.map(hit =>
      renderLine(hit, WARDROBE_CATEGORY_LABEL.get(hit.category) ?? hit.category, hit.item.slot),
    );
    parts.push(
      [
        '【服装候选库】[candidate-only; copy one tag set verbatim]',
        '正文里的衣着词已经命中下列款式指纹。用法:',
        '- **【服装现状】优先于本候选库**:若某个角色在【服装现状】或【近期已出图的实拍 tag】里已经有穿着/半脱的衣服,且本楼正文没有明确写她换装,必须直接照抄【服装现状】里那一套,**严禁从下面候选里重新挑一套换掉她身上的衣服**!本候选库只供首次出场、尚无服装记录的角色,或正文明确写了换装的角色使用。',
        '- 同一角色同一部位只挑一条,挑中的 `tags` 原样照抄进角色的 tag 串(允许按正文删掉明显不符的部件,但不许换成更泛的词,例如不许把 `lace-trimmed sheer black pantyhose` 简化成 `pantyhose`)。',
        '- 正文明确写了款式而库里有对应条目时,用库里的版本,不要凭印象另写一套。',
        '- **上了身就锁死**:一个角色一旦选定一套之后,本楼与后续楼层**所有图**都必须逐字复用同一串服装 tag。候选有多条是为了让你挑最贴正文的那一条,不是让每张图或每层楼各挑一条。多张图之间的差异用姿势、机位、景别和衣物状态词(`unzipped`/`slipped down`/`wet`/`pulled aside`/`torn`)表现,不靠换衣服。',
        '- 只有正文明确写了换装、脱下或衣物被毁,才允许换成另一条候选,并从那一张起生效;正文没写就换,读者会看见同一段剧情里她在莫名其妙地换衣服。',
        '- **但不同的人不许穿同一件**:同框或前后楼的两个角色职业相同(两个事业女、两个学生)时,身份词会把同一批候选递给所有人,这时按候选的类别标签挑不同廓形——一个裤装一个裙装、一个长外搭一个短上衣、一个硬挺一个垂坠。已在场的同职业角色穿了什么就避开那条,共用一个条目的后果是两个人看着像同一个人的两套衣服。',
        '',
        ...lines,
      ].join('\n'),
    );
  }

  if (poses.length) {
    const lines = poses.map(hit => {
      const meta = [hit.item.camera ? `机位 ${hit.item.camera}` : '', hit.item.direction ?? '']
        .filter(Boolean)
        .join(' / ');
      return renderLine(hit, POSE_CATEGORY_LABEL.get(hit.category) ?? hit.category, meta);
    });
    parts.push(
      [
        '【姿势与机位候选库】[candidate-only; copy one tag set verbatim]',
        '正文的亲密动作已经命中下列姿势指纹。用法:',
        '- 每条都包含「体位 + 肢体关系 + 机位」;照抄整组才能保住构图,只抄体位名会退回最普通的画面。',
        '- 机位一栏是该体位最不容易画崩人体的机位;正文没写机位时优先采用它。',
        '- 同一张图只用一条候选;多张图之间应体现姿势推进(前戏 → 正体位 → 高潮 → 事后),不要并列堆叠。',
        '',
        ...lines,
      ].join('\n'),
    );
  }

  if (faces.length) {
    const lines = faces.map(hit => {
      const extra =
        hit.item.kind === 'fandom'
          ? ((hit.item as FandomPreset).franchise ?? '')
          : hit.item.kind === 'body'
            ? ((hit.item as BodyPreset).archetype ?? '')
            : '';
      const tail = hit.pinned
        ? `外形重合：${hit.lookNote ?? ''}｜照抄`
        : hit.direct && hit.item.kind === 'fandom'
          ? '正文点名'
          : extra;
      return renderLine(hit, FACE_KIND_LABEL[hit.item.kind], tail);
    });
    const hasFandom = faces.some(hit => hit.item.kind === 'fandom');
    const hasDirect = faces.some(hit => hit.direct);
    const hasPinned = faces.some(hit => hit.pinned);
    // 全是兜底条目(正文里连一个可比对的词都没有):说清它们不是「命中」,
    // 否则模型会以为正文点名了,把它们当成铁定要照抄的答案。
    const allLoose = faces.every(hit => !hit.hits.length && !hit.direct && !hit.pinned);
    parts.push(
      [
        '【人物外貌候选库】[candidate-only; copy one tag set verbatim, fandom entries carry their own weight syntax]',
        '正文的外形与身份线索已经命中下列指纹。用法:',
        '- 每条是一整套「脸型 + 眼型 + 睫毛 + 唇形 + 关键痣/颊色」,或一整套「胸腰臀腿比 + 肉感反馈」。整组照抄,不要只抽一两个词,单抽必然退回大众脸。',
        hasPinned
          ? '- **标了「外形重合」的条目就是正文写的这个人**:正文的发色、瞳色、种族、体形已经逐维对上,不要再自己编脸。把这一条的 tags 整组照抄进该角色的外貌(发色瞳色完全一致,只按正文补它没写的部位),也不要再拿别的同人条目替换它。'
          : '',
        hasFandom
          ? hasDirect
            ? '- `同人角色` 条目的 tags 自带 `0.6::角色 (作品)::` 权重语法,原样照抄即可。**正文点名了作品或角色时,优先用对应的同人条目当骨相**,它是这张脸的底子,比 `脸型` / `体型` 条更能定住长相;再按需配一条脸型或体型条补气质。'
            : '- `同人角色` 条目即使正文没有点名作品也可以用:它的 tags 自带 `0.6::角色 (作品)::` 权重语法,原样照抄就只是「借这张脸的骨相」,不会把原作剧情一起带进来。角色的发色瞳色与条目的 hair/eyes 冲突时,以角色的固定外貌为准,把冲突的发色瞳色词删掉。'
          : '',
        '- 同人条目的权重已经写死在 tags 里,照抄,不要再自己加括号权重。',
        allLoose
          ? '- 这一批没有命中正文的任何外形词(正文没写发色/瞳色/气质),只是按摇号给的底子:挑最接近正文身份的那一条当起点,再按正文补发色、发型与瞳色。'
          : '',
        '- 已建档角色仍以【角色固定外貌库】为准;候选只用于新建档、或补该角色库里缺的字段。同一角色只挑一条同人条目,不要叠两条。',
        '',
        ...lines,
      ]
        .filter((line, index, all) => line || all[index - 1] !== '')
        .join('\n'),
    );
  }

  return parts.join('\n\n');
}

const FACE_KIND_LABEL: Record<FaceCardKind, string> = {
  face: '脸型',
  body: '体型',
  fandom: '同人角色',
};

/** UI 用:按分类分组(服装)。 */
export function wardrobeByCategory(): Map<string, WardrobeItem[]> {
  const map = new Map<string, WardrobeItem[]>();
  for (const item of allWardrobeItems()) {
    const list = map.get(item.category);
    if (list) list.push(item);
    else map.set(item.category, [item]);
  }
  return map;
}

/** UI 用:按分类分组(姿势)。 */
export function posesByCategory(): Map<string, PoseEntry[]> {
  const map = new Map<string, PoseEntry[]>();
  for (const item of allPoseItems()) {
    const list = map.get(item.category);
    if (list) list.push(item);
    else map.set(item.category, [item]);
  }
  return map;
}

/** UI 用:分类展示名。 */
export function wardrobeCategoryLabel(id: string): string {
  return WARDROBE_CATEGORY_LABEL.get(id) ?? id;
}

export function poseCategoryLabel(id: string): string {
  return POSE_CATEGORY_LABEL.get(id) ?? id;
}

/**
 * 内置 + 自定义的完整候选池。
 *
 * 为什么做成函数而不是常量:自定义条目存在 localStorage,导入/删除后池子必须立刻变;
 * 常量快照会让「刚导入的款式这一轮还用不上」。
 */
export function allWardrobeItems(): WardrobeItem[] {
  return [...WARDROBE_ITEMS, ...customWardrobe()];
}

export function allPoseItems(): PoseEntry[] {
  return [...POSE_ITEMS, ...customPoses()];
}

export function allFandomItems(): FandomPreset[] {
  return [...FANDOM_PRESETS, ...FANDOM_EXTRA, ...FANDOM_EXTRA_2];
}
