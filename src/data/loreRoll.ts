import { allPoseItems, allWardrobeItems } from '@/data/loreIndex';
import { POSE_CATEGORIES } from '@/data/poseBank';
import { WARDROBE_CATEGORIES } from '@/data/wardrobe';
import type { NsfwLevel, PoseCategoryId, PoseEntry, WardrobeItem } from '@/data/loreTypes';

/**
 * 素材 Roll —— 打一个词，随机给你一身「细化过」的搭配。
 *
 * 为什么不是让 LLM 现场编 tag 串：生图模型对没见过的组合很敏感，随手编的词经常
 * 出不来东西（或者出来四不像）。所以这里从**库里已有的、验证过的条目**取骨架，
 * 再叠同类的部件和氛围修饰——出来的串每个词都在库里，画得准；又因为是随机抽取，
 * 同一个词每次都能看到不同款式，看到喜欢的再存进库。
 *
 * 三层结构：
 *   骨架(1 条) → 同分类部件(0–2 个 tag) → 氛围修饰(2 个) → 机位(1 个)
 * 后两层刻意只用常见的构图/光线词，不碰主体，避免把「JK 制服」roll 成看不出是 JK。
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

/** 匹配关键词的库条目：名字、触发词、tag 串任一处包含即算。 */
function matchItems<T extends { name: string; tags: string; aliases: string[] }>(
  items: readonly T[],
  keyword: string,
): T[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  return items.filter(item => {
    if (item.name.toLowerCase().includes(kw)) return true;
    if (item.tags.toLowerCase().includes(kw)) return true;
    return item.aliases.some(alias => alias.toLowerCase().includes(kw) || kw.includes(alias.toLowerCase()));
  });
}

function uniquePush(target: string[], tags: string[], limit: number): void {
  for (const tag of tags) {
    if (target.length >= limit) return;
    if (!target.includes(tag)) target.push(tag);
  }
}

/**
 * 按关键词 roll 一身服装。
 *
 * @returns null = 库里一条都没匹配上（调用方应提示先补库，而不是硬编一串没验证过的 tag）
 */
export function rollWardrobe(keyword: string, rng: Rng = DEFAULT_RNG): RollResult | null {
  const pool = matchItems(allWardrobeItems(), keyword);
  if (!pool.length) return null;
  const seed = Math.floor(rng() * 1e9);
  // 优先从 quality 高的里面抽:低分条目常年是「能用但不惊艳」的那批。
  const strong = pool.filter(item => (item.quality ?? 3) >= 4);
  const source: WardrobeItem = pick(strong.length ? strong : pool, rng) as WardrobeItem;
  const tags = splitTags(source.tags);
  // 同分类再补 1–2 个部件:同一类的东西叠上去仍然认得出来，跨类容易打架。
  const siblings = allWardrobeItems().filter(
    item => item.category === source.category && item.id !== source.id,
  );
  const mate = pick(siblings, rng);
  if (mate) uniquePush(tags, splitTags(mate.tags).slice(0, 2), tags.length + 2);
  const shot = pick(SHOTS, rng);
  if (shot) tags.push(shot);
  const mood = pick(MOODS, rng);
  if (mood) tags.push(mood);
  const state = pick(STATES, rng);
  if (state) tags.push(state);
  const label = WARDROBE_CATEGORIES.find(c => c.id === source.category)?.label ?? source.category;
  return {
    name: `${label} · ${keyword.trim() || source.name}`,
    tags: tags.join(', '),
    aliases: [keyword.trim() || source.aliases[0] || source.name],
    category: source.category,
    slot: source.slot,
    nsfw: source.nsfw,
    source: source.name,
    seed,
  };
}

/** 按关键词 roll 一个姿势。姿势多叠一个机位词，比服装更需要一次只给一种拍法。 */
export function rollPose(keyword: string, rng: Rng = DEFAULT_RNG): RollResult | null {
  const pool = matchItems(allPoseItems(), keyword);
  if (!pool.length) return null;
  const seed = Math.floor(rng() * 1e9);
  const source: PoseEntry = pick(pool, rng) as PoseEntry;
  const tags = splitTags(source.tags);
  const siblings = allPoseItems().filter(
    item => item.category === source.category && item.id !== source.id,
  );
  const mate = pick(siblings, rng);
  if (mate) uniquePush(tags, splitTags(mate.tags).slice(0, 1), tags.length + 1);
  if (source.camera && !tags.includes(source.camera)) tags.push(source.camera);
  const mood = pick(MOODS, rng);
  if (mood) tags.push(mood);
  const label = POSE_CATEGORIES.find(c => c.id === source.category)?.label ?? source.category;
  return {
    name: `${label} · ${keyword.trim() || source.name}`,
    tags: tags.join(', '),
    aliases: [keyword.trim() || source.aliases[0] || source.name],
    category: source.category,
    slot: 'full',
    nsfw: source.nsfw,
    source: source.name,
    seed,
  };
}

/** 当前词在库里能 roll 出多少条候选（给 UI 提示「只有 1 条会一直重复」）。 */
export function rollPoolSize(keyword: string, kind: 'wardrobe' | 'pose'): number {
  return kind === 'pose'
    ? matchItems(allPoseItems(), keyword).length
    : matchItems(allWardrobeItems(), keyword).length;
}

/** 姿势分类合法性（写库前校验用）。 */
export function isPoseCategory(id: string): id is PoseCategoryId {
  return POSE_CATEGORIES.some(category => category.id === id);
}
