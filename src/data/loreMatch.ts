/**
 * 素材库匹配内核:把正文里的「泛词」翻成「具名条目候选」。
 *
 * 只做一件事:数触发词。不做语义向量、不调模型——正文里写「黑丝」就命中一批丝袜条目,
 * 写「后入」就命中一批后入姿势条目;打分只为排序,最终挑哪条由主模型在候选里决定。
 * 这样匹配结果永远可解释(命中了哪些原词),出错时一眼能看出是词表问题还是正文问题。
 */

import type { LoreItemBase, NsfwLevel } from '@/data/loreTypes';

export interface MatchOptions {
  /** 允许出现的最高 NSFW 档;默认 3(全开)。 */
  maxNsfw?: NsfwLevel;
  /** 返回条数上限,默认 8。 */
  limit?: number;
  /** 每个分类最多几条,默认 2——同类堆太多会把别类挤掉。 */
  perCategory?: number;
  /** 条目气质词命中时的加权倍数,默认 1.35。 */
  vibeBoost?: number;
  /** 角色/场景气质词(中文即可),用于给「对味」的条目加权。 */
  vibes?: string[];
}

export interface MatchHit<T extends LoreItemBase> {
  item: T;
  score: number;
  /** 命中的触发词,按长度降序。 */
  hits: string[];
}

const DEFAULT_OPTIONS: Required<Omit<MatchOptions, 'vibes'>> = {
  maxNsfw: 3,
  limit: 8,
  perCategory: 2,
  vibeBoost: 1.35,
};

/** 正文里出现过的英文缩写/中文混排都可能是触发词,统一小写比对;全角逗号不影响包含判断。 */
function normalize(s: string): string {
  return s.toLowerCase();
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/**
 * 在 text 里为每个条目数命中词。
 *
 * 打分口径(可解释优先):
 * - 每个命中词基础分 = min(词长, 8):「吊带袜」比「袜子」值钱,但不会因为长词就压死一切;
 * - 同一条目命中多个词只累加,不重复计同一个词;
 * - 加 quality(1–5,默认 3),让「推荐款」在同等命中时靠前;
 * - 气质词命中 ×vibeBoost。
 */
export function scoreLore<T extends LoreItemBase>(
  item: T,
  text: string,
  vibes: readonly string[],
): { score: number; hits: string[] } {
  const haystack = normalize(text);
  const hits: string[] = [];
  let score = 0;
  for (const alias of unique(item.aliases)) {
    const needle = normalize(alias).trim();
    if (needle.length < 2) continue;
    if (!haystack.includes(needle)) continue;
    hits.push(alias);
    score += Math.min(needle.length, 8);
  }
  if (!hits.length) return { score: 0, hits: [] };
  score += item.quality ?? 3;
  const itemVibes = 'vibe' in item ? ((item as { vibe?: string[] }).vibe ?? []) : [];
  if (vibes.length && itemVibes.length) {
    const vibeHit = itemVibes.some(v => vibes.some(w => w && (v.includes(w) || w.includes(v))));
    if (vibeHit) score *= DEFAULT_OPTIONS.vibeBoost;
  }
  hits.sort((a, b) => b.length - a.length);
  return { score, hits };
}

/**
 * 匹配主入口。categoryOf 决定「每分类限几条」的口径(服装按分类,姿势按姿势类)。
 * 结果按分数降序;分类上限按「已入选的同类条数」计,不按候选总数。
 */
export function matchLore<T extends LoreItemBase>(
  items: readonly T[],
  text: string,
  categoryOf: (item: T) => string,
  options: MatchOptions = {},
): MatchHit<T>[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const vibes = options.vibes ?? [];
  const scored: MatchHit<T>[] = [];
  for (const item of items) {
    if (item.nsfw > opts.maxNsfw) continue;
    const { score, hits } = scoreLore(item, text, vibes);
    if (score > 0) scored.push({ item, score, hits });
  }
  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  const perCategory = new Map<string, number>();
  const picked: MatchHit<T>[] = [];
  for (const hit of scored) {
    const category = categoryOf(hit.item);
    const used = perCategory.get(category) ?? 0;
    if (used >= opts.perCategory) continue;
    perCategory.set(category, used + 1);
    picked.push(hit);
    if (picked.length >= opts.limit) break;
  }
  return picked;
}

/** 当前正文里「有没有这类内容」的粗判:任一高 NSFW 档条目命中即算。用于决定要不要注入整块。 */
export function hasSensualSignal<T extends LoreItemBase>(
  items: readonly T[],
  text: string,
  minNsfw: NsfwLevel = 1,
): boolean {
  const haystack = normalize(text);
  return items.some(item => {
    if (item.nsfw < minNsfw) return false;
    return item.aliases.some(alias => {
      const needle = normalize(alias).trim();
      return needle.length >= 2 && haystack.includes(needle);
    });
  });
}
