import { suitLibrary } from './materialLibrary';
import { fandomCatalog } from './fandomCatalog';
import { compatibleCostumeMaterial, type CostumeContext } from '@/autoTag/costumeContext';
/**
 * 素材库召回层(loreIndex):把「正文 + 设置」压成一段能直接塞进 prompt 的候选清单。
 *
 * 分层:
 * - wardrobe.ts / poseBank.ts 只存数据(款式指纹);
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
import { POSE_ITEMS } from '@/data/poseBank';

import { scoreLore } from '@/data/loreMatch';
import { customFandom, customPoses, customWardrobe } from '@/data/customLore';
import type {
  FandomPreset,
  LoreItemBase,
  NsfwLevel,
  PoseEntry,
  WardrobeItem,
} from '@/data/loreTypes';

export interface LoreOptions {
  costume?: CostumeContext;
  /** 允许出现的最高 NSFW 档;默认 3。 */
  maxNsfw?: NsfwLevel;
  /** 服装候选条数上限,默认 8。 */
  wardrobeLimit?: number;
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
}

const WARDROBE_CATEGORY_LABEL = new Map<string, string>(WARDROBE_CATEGORIES.map((c) => [c.id, c.label]));

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
  options: {
    limit: number;
    maxNsfw?: NsfwLevel;
    vibes?: string[];
    rollSeed?: number;
  },
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
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (options.rollSeed ? tieOrder(a.item.id) - tieOrder(b.item.id) : a.item.id.localeCompare(b.item.id)),
  );
  const categories = new Set(scored.map((hit) => hit.category));
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

/** 衣橱候选召回。正文为空/无命中时返回空数组。 */
export function collectLoreCandidates(text: string, options: LoreOptions = {}): LoreCandidates {
  const body = (text ?? '').trim();
  if (!body) return { wardrobe: [] };
  return {
    wardrobe: pickDiverse(
      suitLibrary().filter(
        (item) =>
          item.automatic &&
          !(options.costume?.era === 'ancient' && item.era === 'modern') &&
          !(options.costume?.era === 'modern' && ['ancient', 'fantasy'].includes(item.era)) &&
          compatibleCostumeMaterial(item, options.costume),
      ),
      body,
      (item) => item.category,
      {
        limit: options.wardrobeLimit ?? 8,
        maxNsfw: options.maxNsfw,
        vibes: options.vibes,
        rollSeed: options.rollSeed,
      },
    ),
  };
}

/** 一行的渲染:`- [分类] 名字: tags`(命中词与 note 追加在后面,不占主行)。 */
function renderLine<T extends LoreItemBase>(hit: LoreHit<T>, categoryLabel: string, extra?: string): string {
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
  const { wardrobe } = collectLoreCandidates(text, options);
  if (!wardrobe.length) return '';
  return [
    '【新版衣橱候选】仅在首次没有穿搭，或原文明示换装时使用。不是每张图重新挑款。',
    '已有楼层衣物与人工绑定最高优先；没换装就逐字继承 design，穿脱只改 state。',
    '正文明确款式优先于候选，不匹配就跳过候选。只有脱衣/解扣/掀裙不等于换装，不得因此选新衣服。',
    '只复制候选中逗号分隔的独立英文标签。不补写形容词长句、人物外貌、画师、画风或状态。',
    '候选中的长袖、领型等属于对应衣物；部件与状态应一起继承。',
    ...wardrobe.map((hit) =>
      renderLine(hit, WARDROBE_CATEGORY_LABEL.get(hit.category) ?? hit.category, hit.item.slot),
    ),
  ].join('\n');
}

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

/**
 * 内置 + 自定义的完整候选池。
 *
 * 为什么做成函数而不是常量:自定义条目存在 localStorage,导入/删除后池子必须立刻变;
 * 常量快照会让「刚导入的款式这一轮还用不上」。
 */
export function allWardrobeItems(): WardrobeItem[] {
  return suitLibrary().filter((item) => item.automatic);
}

export function allPoseItems(): PoseEntry[] {
  return [...POSE_ITEMS, ...customPoses()];
}

export function allFandomItems(): FandomPreset[] {
  return fandomCatalog();
}
