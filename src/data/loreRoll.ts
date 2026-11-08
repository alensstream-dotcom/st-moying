import { allFandomItems, allPoseItems, allWardrobeItems } from '@/data/loreIndex';
import { POSE_CATEGORIES } from '@/data/poseBank';
import { WARDROBE_CATEGORIES } from '@/data/wardrobe';
import { guessWardrobeCategory, guessWardrobeSlot } from '@/data/customLore';
import type {
  FandomPreset,
  NsfwLevel,
  PoseCategoryId,
  PoseEntry,
  WardrobeItem,
  WardrobeSlot,
} from '@/data/loreTypes';

export type RollKind = 'wardrobe' | 'pose' | 'fandom';

/**
 * 素材 Roll —— 打一个词（或完全留空直接大抽奖），随机给你一套细化过的搭配/姿势/同人角色。
 *
 * 三层结构：
 *   骨架(1 条) → 部件丰富(0–2 个 tag) → 氛围修饰(2 个) → 机位(1 个)
 * 当输入留空时，从全库中完全随机抽取，让用户能随时随地「探索新灵感」；
 * 当输入关键词在库里有收录时，精准按关键词召回骨架；
 * 服装/姿势保留自由构图；同人未命中时交给调用层通过 LLM 解析后再出图。
 */
export interface RollResult {
  /** 建议存进库的名字：关键词 + 随机后缀，避免同名冲突。 */
  name: string;
  tags: string;
  aliases: string[];
  category: string;
  slot: string;
  nsfw: NsfwLevel;
  /** 骨架来自哪一条，方便用户回头对照。 */
  source: string;
  /** 这条 roll 的随机种子，便于 UI 显示或复现。 */
  seed: number;
  kind: RollKind;
  /** 匹配到的原始条目 id（同人条目保存预览图时作为索引键） */
  id?: string;
  franchise?: string;
  materialTags?: string;
  hair?: string;
  eyes?: string;
  resolutionNote?: string;
}

type Rng = () => number;

const DEFAULT_RNG: Rng = () => Math.random();

/** 不同尺度的取景。素材预览图用竖构图，取景只影响「看多少」。 */
const SHOTS = [
  'full body, standing',
  'full body, walking',
  'full body, from side',
  'full body, from behind',
  'full body, from above',
  'full body, from below',
  'cowboy shot',
  'cowboy shot, from side',
];

/** 光线与氛围。全是中性词，不改变服装识别。 */
const MOODS = [
  'soft lighting',
  'backlighting',
  'rim lighting',
  'dim lighting',
  'window light',
  'cinematic lighting',
  'blurry background',
  'depth of field',
];

/** 只加一点点身体状态，让图不那么像衣架。 */
const STATES = ['bare shoulders', 'collarbone', 'looking at viewer', 'parted lips', 'solo focus'];

function pick<T>(items: readonly T[], rng: Rng): T | null {
  if (!items.length) return null;
  return items[Math.floor(rng() * items.length) % items.length];
}

function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

/** 匹配关键词的库条目：名字、触发词、tag 串、分类任一处包含即算。若 keyword 为空，返回全部条目。 */
function matchItems<T extends { name: string; tags: string; aliases: string[]; category?: string }>(
  items: readonly T[],
  keyword: string,
): T[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [...items];
  const scored: { item: T; score: number }[] = [];

  for (const item of items) {
    let score = 0;
    const nameLower = item.name.toLowerCase();
    if (nameLower === kw) {
      score = Math.max(score, 100);
    } else if (nameLower.includes(kw)) {
      score = Math.max(score, 50);
    }

    for (const alias of item.aliases) {
      const aLower = alias.toLowerCase();
      if (aLower === kw) {
        score = Math.max(score, 100);
      } else if (aLower.includes(kw)) {
        score = Math.max(score, 50);
      } else if (kw.length > 2 && aLower.length >= 2 && kw.includes(aLower)) {
        score = Math.max(score, 20 + aLower.length);
      }
    }

    if (item.category && (item.category.toLowerCase() === kw || item.category.toLowerCase().includes(kw))) {
      score = Math.max(score, 30);
    }
    if (item.tags.toLowerCase().includes(kw)) {
      score = Math.max(score, 15);
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  if (!scored.length) return [];
  const maxScore = Math.max(...scored.map(s => s.score));
  const topThreshold = maxScore >= 50 ? 50 : maxScore >= 30 ? 30 : 10;
  return scored.filter(s => s.score >= topThreshold).map(s => s.item);
}

export function normalizeFandomQuery(value: string): string {
  const from = '寧愛電將軍麗絲華葉風雲櫻兒學國師羅亞夢龍緋紅綠銀髮優蘭雙瀨繪裡曉時崎宮輝夜蓮澤';
  const to   = '宁爱电将军丽丝华叶风云樱儿学国师罗亚梦龙绯红绿银发优兰双濑绘里晓时崎宫辉夜莲泽';
  return [...value.normalize('NFKC').toLowerCase()].map(c => { const i = from.indexOf(c); return i < 0 ? c : to[i]; }).join('').replace(/[\s_·・:：()（）\\-]/g, '');
}

/** 匹配同人角色条目：名字、作品、别名、发色、瞳色、tag 串任一处包含即算。若 keyword 为空，返回全部条目。 */
export function matchFandomItems(items: readonly FandomPreset[], keyword: string): FandomPreset[] {
  const kw = normalizeFandomQuery(keyword);
  if (!kw) return [...items];
  const aliasCounts = new Map<string, number>();
  for (const item of items) for (const alias of new Set(item.aliases.map(normalizeFandomQuery))) {
    if (alias) aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
  }
  const scored = items.map(item => {
    const name = normalizeFandomQuery(item.name), work = normalizeFandomQuery(item.franchise);
    let score = 0;
    if (name === kw) score = 100;
    else if (name && name.includes(kw)) score = 50;
    else if (name.length >= 2 && kw.includes(name)) score = 80;
    for (const alias of item.aliases) {
      const a = normalizeFandomQuery(alias);
      if (!a) continue;
      if (a === kw) score = Math.max(score, 100);
      else if (a.includes(kw)) score = Math.max(score, 50);
      // A shared work alias inside a longer query must not hide an unknown character.
      else if (a.length >= 2 && kw.includes(a) && (aliasCounts.get(a) ?? 0) <= 2 && a !== work) score = Math.max(score, 70);
    }
    if (work && (work === kw || work.includes(kw))) score = Math.max(score, 30);
    if (normalizeFandomQuery(item.tags).includes(kw)) score = Math.max(score, 15);
    if ([item.hair, item.eyes].some(t => t && normalizeFandomQuery(t).includes(kw))) score = Math.max(score, 10);
    // When a work is supplied, favor the matching version of a shared character name.
    if (score >= 50 && work && kw.includes(work) && kw !== work) score += 5;
    return { item, score };
  }).filter(s => s.score > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map(s => s.score));
  return scored.filter(s => s.score === best).map(s => s.item);
}

function uniquePush(target: string[], tags: string[], limit: number): void {
  for (const tag of tags) {
    if (target.length >= limit) return;
    if (!target.includes(tag)) target.push(tag);
  }
}

/**
 * 按关键词 roll 一身服装。
 * 关键词为空时，从全库 600+ 套服装中完全随机抽取；
 * 关键词未命中内置库时，按关键词自由生成灵感搭配，绝不失败拦截。
 */
export function rollWardrobe(keyword: string = '', rng: Rng = DEFAULT_RNG): RollResult | null {
  const all = allWardrobeItems();
  const kw = keyword.trim();
  const pool = kw ? matchItems(all, kw) : all;
  const seed = Math.floor(rng() * 1e9);

  let source: WardrobeItem;
  let categoryLabel: string;
  let isCustom = false;

  if (pool.length) {
    source = pick(pool, rng) as WardrobeItem;
    categoryLabel = WARDROBE_CATEGORIES.find(c => c.id === source.category)?.label ?? source.category;
  } else if (kw) {
    isCustom = true;
    const cat = guessWardrobeCategory(kw);
    const slot = guessWardrobeSlot(kw) as WardrobeSlot;
    source = {
      id: `u-roll-${seed}`,
      name: kw,
      tags: kw,
      aliases: [kw],
      category: cat,
      slot,
      nsfw: 1,
    };
    categoryLabel = WARDROBE_CATEGORIES.find(c => c.id === cat)?.label ?? '自定义搭配';
  } else {
    return null;
  }

  const tags = splitTags(source.tags);

  if (!isCustom) {
    // 同分类再补 1–2 个部件
    const siblings = all.filter(item => item.category === source.category && item.id !== source.id);
    const mate = pick(siblings, rng);
    if (mate) uniquePush(tags, splitTags(mate.tags).slice(0, 2), tags.length + 2);

    // 整套或上装可概率混搭配饰/鞋袜部件
    if (source.slot === 'full' || source.slot === 'top') {
      const accessories = all.filter(item => item.slot === 'accessory' || item.slot === 'hosiery');
      const extraAcc = pick(accessories, rng);
      if (extraAcc && rng() > 0.4) {
        uniquePush(tags, splitTags(extraAcc.tags).slice(0, 1), tags.length + 1);
      }
    }
  }

  const shot = pick(SHOTS, rng);
  if (shot) tags.push(shot);
  const mood = pick(MOODS, rng);
  if (mood) tags.push(mood);
  const state = pick(STATES, rng);
  if (state) tags.push(state);

  return {
    id: source.id,
    name: `${categoryLabel} · ${kw || source.name}`,
    tags: tags.join(', '),
    aliases: [kw || source.aliases[0] || source.name],
    category: source.category,
    slot: source.slot,
    nsfw: source.nsfw,
    source: isCustom ? '自由灵感搭配' : source.name,
    seed,
    kind: 'wardrobe',
  };
}

/**
 * 按关键词 roll 一个姿势。
 * 关键词为空时，从全库 200+ 姿势中完全随机抽取。
 */
export function rollPose(keyword: string = '', rng: Rng = DEFAULT_RNG): RollResult | null {
  const all = allPoseItems();
  const kw = keyword.trim();
  const pool = kw ? matchItems(all, kw) : all;
  const seed = Math.floor(rng() * 1e9);

  let source: PoseEntry;
  let categoryLabel: string;
  let isCustom = false;

  if (pool.length) {
    source = pick(pool, rng) as PoseEntry;
    categoryLabel = POSE_CATEGORIES.find(c => c.id === source.category)?.label ?? source.category;
  } else if (kw) {
    isCustom = true;
    source = {
      id: `up-roll-${seed}`,
      name: kw,
      tags: kw,
      aliases: [kw],
      category: 'standing',
      nsfw: 1,
    };
    categoryLabel = '自由姿势';
  } else {
    return null;
  }

  const tags = splitTags(source.tags);
  if (!isCustom) {
    const siblings = all.filter(item => item.category === source.category && item.id !== source.id);
    const mate = pick(siblings, rng);
    if (mate) uniquePush(tags, splitTags(mate.tags).slice(0, 1), tags.length + 1);
  }
  if (source.camera && !tags.includes(source.camera)) tags.push(source.camera);
  const mood = pick(MOODS, rng);
  if (mood) tags.push(mood);

  return {
    id: source.id,
    name: `${categoryLabel} · ${kw || source.name}`,
    tags: tags.join(', '),
    aliases: [kw || source.aliases[0] || source.name],
    category: source.category,
    slot: 'full',
    nsfw: source.nsfw,
    source: isCustom ? '自由输入' : source.name,
    seed,
    kind: 'pose',
  };
}

/**
 * 按关键词（角色名 / 作品名 / 外貌词）roll 一个同人角色。
 * 关键词为空时，从全库 230+ 同人角色中完全随机抽取。
 */
export function rollFandom(keyword: string = '', rng: Rng = DEFAULT_RNG): RollResult | null {
  const all = allFandomItems();
  const kw = keyword.trim();
  const pool = kw ? matchFandomItems(all, kw) : all;
  const seed = Math.floor(rng() * 1e9);

  // Unknown names must be resolved by the saved LLM before image generation.
  if (!pool.length) return null;
  const source = pick(pool, rng) as FandomPreset;

  const tags = splitTags(source.tags);
  const shot = pick(
    ['upper body, looking at viewer', 'cowboy shot, looking at viewer', 'portrait, face focus'],
    rng,
  );
  if (shot) tags.push(shot);
  const mood = pick(MOODS, rng);
  if (mood) tags.push(mood);

  const franchiseLabel = source.franchise && source.franchise !== '自由同人' ? ` (${source.franchise})` : '';

  return {
    id: source.id,
    materialTags: source.tags, hair: source.hair, eyes: source.eyes,
    name: `${source.name}${franchiseLabel}`,
    tags: tags.join(', '),
    aliases: source.aliases,
    category: source.franchise || 'fandom',
    slot: 'fandom',
    nsfw: source.nsfw,
    source: `${source.name}${franchiseLabel}`,
    seed,
    kind: 'fandom',
    franchise: source.franchise,
  };
}

/** 当前词在库里能 roll 出多少条候选（给 UI 提示）。留空时返回全库总数。 */
export function rollPoolSize(keyword: string, kind: RollKind): number {
  const kw = keyword.trim();
  if (kind === 'pose') {
    return kw ? matchItems(allPoseItems(), kw).length : allPoseItems().length;
  }
  if (kind === 'fandom') {
    return kw ? matchFandomItems(allFandomItems(), kw).length : allFandomItems().length;
  }
  return kw ? matchItems(allWardrobeItems(), kw).length : allWardrobeItems().length;
}

/** 姿势分类合法性（写库前校验用）。 */
export function isPoseCategory(id: string): id is PoseCategoryId {
  return POSE_CATEGORIES.some(category => category.id === id);
}
