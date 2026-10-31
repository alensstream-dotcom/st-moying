/**
 * 自定义素材层:用户自己导入的服装 / 姿势条目。
 *
 * 为什么单独一层而不是往 wardrobe.ts 里加:
 * 1. 内置表随版本分发,升级插件会整文件替换;用户自己攒的东西必须放在可写层,不能被覆盖。
 * 2. 自定义条目可能上百条,塞进打包体积没有意义——它们只在本机用。
 * 3. 召回时把两层拼起来即可,内置与自定义在 prompt 里长得完全一样,模型不需要区分。
 *
 * 存储口径:localStorage 单键一段 JSON。读写都做校验与截断,坏数据宁可丢也不能让
 * 整个素材库打不开——这个文件被设置页与素材库页共用,它抛异常等于整个插件白屏。
 */

import { WARDROBE_CATEGORIES } from '@/data/wardrobe';
import type { NsfwLevel, PoseCategoryId, PoseEntry, WardrobeItem, WardrobeSlot } from '@/data/loreTypes';
import { POSE_CATEGORIES } from '@/data/poseBank';

const STORAGE_KEY = 'moying_image_custom_lore';

/** 上限:再多就不是"挑几套自己喜欢"的量级了,而且召回要遍历全部条目。 */
const MAX_WARDROBE = 600;
const MAX_POSES = 200;

const SLOT_IDS: ReadonlySet<string> = new Set<WardrobeSlot>([
  'full',
  'top',
  'bottom',
  'underwear',
  'hosiery',
  'shoes',
  'accessory',
  'state',
]);

export const WARDROBE_SLOT_LABELS: ReadonlyArray<{ id: WardrobeSlot; label: string }> = [
  { id: 'full', label: '整套 / 全身' },
  { id: 'top', label: '上衣' },
  { id: 'bottom', label: '下身' },
  { id: 'underwear', label: '内衣' },
  { id: 'hosiery', label: '袜类 / 腿饰' },
  { id: 'shoes', label: '鞋履' },
  { id: 'accessory', label: '配饰' },
  { id: 'state', label: '半脱 / 状态' },
];

export interface CustomLoreStore {
  wardrobe: WardrobeItem[];
  poses: PoseEntry[];
}

/** 表单提交的形状:UI 只填必要字段,id 与清洗由这里负责。 */
export interface CustomWardrobeInput {
  name: string;
  tags: string;
  aliases: string;
  category: string;
  slot: WardrobeSlot;
  nsfw: NsfwLevel;
  quality?: number;
  note?: string;
}

export interface CustomPoseInput {
  name: string;
  tags: string;
  aliases: string;
  category: PoseCategoryId;
  nsfw: NsfwLevel;
  camera?: string;
  note?: string;
}

/** 空 store:localStorage 不可用(SSR / 测试 / 隐私模式)时的安全返回值。 */
function emptyStore(): CustomLoreStore {
  return { wardrobe: [], poses: [] };
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 把逗号/顿号/竖线分隔的输入拆成干净数组(全角逗号也要认)。 */
export function splitList(raw: string): string[] {
  return String(raw ?? '')
    .split(/[,，、|\n]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

/** 中文名称去重键:同名视为同一条,便于"我加过了"的提示。 */
function nameKey(item: { name: string }): string {
  return item.name.trim().toLowerCase();
}

function normalizeWardrobe(raw: unknown, index: number): WardrobeItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? '').trim();
  const tags = String(o.tags ?? '').trim();
  if (!name || !tags) return null;
  const category = String(o.category ?? '').trim();
  const slotRaw = String(o.slot ?? '').trim();
  const nsfwRaw = Number(o.nsfw);
  const nsfw = (Number.isFinite(nsfwRaw) ? Math.min(3, Math.max(0, Math.round(nsfwRaw))) : 2) as NsfwLevel;
  const qualityRaw = Number(o.quality);
  return {
    id: String(o.id ?? '').trim() || `u-${index}`,
    name,
    tags,
    aliases: Array.isArray(o.aliases)
      ? o.aliases.map(alias => String(alias).trim()).filter(Boolean)
      : splitList(String(o.aliases ?? '')),
    nsfw,
    quality: Number.isFinite(qualityRaw) ? Math.min(5, Math.max(1, Math.round(qualityRaw))) : 4,
    note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined,
    category: WARDROBE_CATEGORIES.some(c => c.id === category) ? category : 'costume',
    slot: (SLOT_IDS.has(slotRaw) ? slotRaw : 'full') as WardrobeSlot,
  };
}

function normalizePose(raw: unknown, index: number): PoseEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? '').trim();
  const tags = String(o.tags ?? '').trim();
  if (!name || !tags) return null;
  const category = String(o.category ?? '').trim();
  const matched = POSE_CATEGORIES.find(c => c.id === category);
  if (!matched) return null;
  const nsfwRaw = Number(o.nsfw);
  const nsfw = (Number.isFinite(nsfwRaw) ? Math.min(3, Math.max(1, Math.round(nsfwRaw))) : 2) as NsfwLevel;
  return {
    id: String(o.id ?? '').trim() || `up-${index}`,
    name,
    tags,
    aliases: Array.isArray(o.aliases)
      ? o.aliases.map(alias => String(alias).trim()).filter(Boolean)
      : splitList(String(o.aliases ?? '')),
    nsfw,
    category: matched.id,
    camera: typeof o.camera === 'string' && o.camera.trim() ? o.camera.trim() : undefined,
    direction: o.direction === 'heroine-active' || o.direction === 'male-active' || o.direction === 'mutual' || o.direction === 'solo'
      ? o.direction
      : undefined,
    note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined,
  };
}

let cache: CustomLoreStore | null = null;

/** 读全量自定义条目(带缓存;写操作会重置缓存)。 */
export function loadCustomLore(): CustomLoreStore {
  if (cache) return cache;
  const box = storage();
  if (!box) {
    cache = emptyStore();
    return cache;
  }
  try {
    const parsed = JSON.parse(box.getItem(STORAGE_KEY) || 'null') as Record<string, unknown> | null;
    const wardrobeRaw = Array.isArray(parsed?.wardrobe) ? (parsed!.wardrobe as unknown[]) : [];
    const posesRaw = Array.isArray(parsed?.poses) ? (parsed!.poses as unknown[]) : [];
    cache = {
      wardrobe: wardrobeRaw
        .map((item, index) => normalizeWardrobe(item, index))
        .filter((item): item is WardrobeItem => !!item)
        .slice(0, MAX_WARDROBE),
      poses: posesRaw
        .map((item, index) => normalizePose(item, index))
        .filter((item): item is PoseEntry => !!item)
        .slice(0, MAX_POSES),
    };
  } catch {
    cache = emptyStore();
  }
  return cache;
}

function persist(store: CustomLoreStore): void {
  cache = store;
  const box = storage();
  if (!box) return;
  try {
    box.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 配额满/隐私模式:内存里仍然生效,只是这次会话结束会丢,不打断用户操作
  }
}

export function customWardrobe(): WardrobeItem[] {
  return loadCustomLore().wardrobe;
}

export function customPoses(): PoseEntry[] {
  return loadCustomLore().poses;
}

/** 新条目的 id:时间戳 + 序号,足够在单机内唯一,也不与内置的 w2- 前缀冲突。 */
function nextId(prefix: string, existing: ReadonlyArray<{ id: string }>): string {
  const base = `${prefix}${Date.now().toString(36)}`;
  let candidate = base;
  let seq = 0;
  const taken = new Set(existing.map(item => item.id));
  while (taken.has(candidate)) {
    seq += 1;
    candidate = `${base}-${seq}`;
  }
  return candidate;
}

export interface AddResult<T> {
  ok: boolean;
  error?: string;
  item?: T;
}

/** 新增一条自定义服装。返回 ok=false 时 error 直接可读给用户看。 */
export function addCustomWardrobe(input: CustomWardrobeInput): AddResult<WardrobeItem> {
  const store = loadCustomLore();
  const name = input.name.trim();
  const tags = input.tags.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: '名称不能为空' };
  if (!tags) return { ok: false, error: 'tag 串不能为空——至少要有一组英文 danbooru tag' };
  const aliases = splitList(input.aliases);
  if (!aliases.length) return { ok: false, error: '至少给一个中文触发词，否则剧情里出现这身衣服也召回不到' };
  if (store.wardrobe.some(item => nameKey(item) === name.toLowerCase())) {
    return { ok: false, error: `已经有同名条目「${name}」了` };
  }
  if (store.wardrobe.length >= MAX_WARDROBE) {
    return { ok: false, error: `自定义服装已达上限 ${MAX_WARDROBE} 条，先删几条再导入` };
  }
  const item: WardrobeItem = {
    id: nextId('u-', store.wardrobe),
    name,
    tags,
    aliases,
    nsfw: input.nsfw,
    quality: input.quality ?? 4,
    note: input.note?.trim() || undefined,
    category: WARDROBE_CATEGORIES.some(c => c.id === input.category) ? input.category : 'costume',
    slot: input.slot,
  };
  persist({ wardrobe: [...store.wardrobe, item], poses: store.poses });
  return { ok: true, item };
}

/** 新增一条自定义姿势。 */
export function addCustomPose(input: CustomPoseInput): AddResult<PoseEntry> {
  const store = loadCustomLore();
  const name = input.name.trim();
  const tags = input.tags.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: '名称不能为空' };
  if (!tags) return { ok: false, error: 'tag 串不能为空' };
  const aliases = splitList(input.aliases);
  if (!aliases.length) return { ok: false, error: '至少给一个中文触发词' };
  if (!POSE_CATEGORIES.some(category => category.id === input.category)) {
    return { ok: false, error: '姿势分类不在内置分类表里，请从下拉里选' };
  }
  if (store.poses.some(item => nameKey(item) === name.toLowerCase())) {
    return { ok: false, error: `已经有同名条目「${name}」了` };
  }
  if (store.poses.length >= MAX_POSES) {
    return { ok: false, error: `自定义姿势已达上限 ${MAX_POSES} 条` };
  }
  const item: PoseEntry = {
    id: nextId('up-', store.poses),
    name,
    tags,
    aliases,
    nsfw: input.nsfw,
    category: input.category,
    camera: input.camera?.trim() || undefined,
    note: input.note?.trim() || undefined,
  };
  persist({ wardrobe: store.wardrobe, poses: [...store.poses, item] });
  return { ok: true, item };
}

/** 修改一条自定义服装(id 不变,历史预览图因此不会失效)。 */
export function updateCustomWardrobe(id: string, input: CustomWardrobeInput): AddResult<WardrobeItem> {
  const store = loadCustomLore();
  const index = store.wardrobe.findIndex(item => item.id === id);
  if (index < 0) return { ok: false, error: '找不到要修改的条目(可能已被删除)' };
  const name = input.name.trim();
  const tags = input.tags.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: '名称不能为空' };
  if (!tags) return { ok: false, error: 'tag 串不能为空' };
  const aliases = splitList(input.aliases);
  if (!aliases.length) return { ok: false, error: '至少给一个中文触发词' };
  if (store.wardrobe.some((item, at) => at !== index && nameKey(item) === name.toLowerCase())) {
    return { ok: false, error: `已经有同名条目「${name}」了` };
  }
  const before = store.wardrobe[index];
  const item: WardrobeItem = {
    ...before,
    name,
    tags,
    aliases,
    nsfw: input.nsfw,
    quality: input.quality ?? before.quality ?? 4,
    note: input.note?.trim() || undefined,
    category: WARDROBE_CATEGORIES.some(c => c.id === input.category) ? input.category : before.category,
    slot: SLOT_IDS.has(input.slot) ? (input.slot as WardrobeSlot) : before.slot,
  };
  const wardrobe = [...store.wardrobe];
  wardrobe[index] = item;
  persist({ wardrobe, poses: store.poses });
  return { ok: true, item };
}

/** 修改一条自定义姿势。 */
export function updateCustomPose(id: string, input: CustomPoseInput): AddResult<PoseEntry> {
  const store = loadCustomLore();
  const index = store.poses.findIndex(item => item.id === id);
  if (index < 0) return { ok: false, error: '找不到要修改的条目(可能已被删除)' };
  const name = input.name.trim();
  const tags = input.tags.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: '名称不能为空' };
  if (!tags) return { ok: false, error: 'tag 串不能为空' };
  const aliases = splitList(input.aliases);
  if (!aliases.length) return { ok: false, error: '至少给一个中文触发词' };
  if (!POSE_CATEGORIES.some(category => category.id === input.category)) {
    return { ok: false, error: '姿势分类不在内置分类表里，请从下拉里选' };
  }
  if (store.poses.some((item, at) => at !== index && nameKey(item) === name.toLowerCase())) {
    return { ok: false, error: `已经有同名条目「${name}」了` };
  }
  const before = store.poses[index];
  const item: PoseEntry = {
    ...before,
    name,
    tags,
    aliases,
    nsfw: input.nsfw,
    category: input.category,
    camera: input.camera?.trim() || undefined,
    note: input.note?.trim() || undefined,
  };
  const poses = [...store.poses];
  poses[index] = item;
  persist({ wardrobe: store.wardrobe, poses });
  return { ok: true, item };
}

/** 删除一条自定义条目(只能删自定义的,内置条目不动)。 */
export function removeCustomLore(kind: 'wardrobe' | 'pose', id: string): boolean {
  const store = loadCustomLore();
  if (kind === 'wardrobe') {
    const next = store.wardrobe.filter(item => item.id !== id);
    if (next.length === store.wardrobe.length) return false;
    persist({ wardrobe: next, poses: store.poses });
    return true;
  }
  const next = store.poses.filter(item => item.id !== id);
  if (next.length === store.poses.length) return false;
  persist({ wardrobe: store.wardrobe, poses: next });
  return true;
}

/** 解析出来的素材草稿:还没入库,先让用户看一眼改分类。 */
export interface TagBundleDraft {
  /** 建议名称(第一个中文说明;没有中文时退回第一个 tag)。 */
  name: string;
  /** 规整后的 tag 串,逗号加空格分隔。 */
  tags: string;
  /** 中文说明直接当触发词用——它们本来就是正文里会出现的词。 */
  aliases: string[];
  note: string;
}

function normalizeFullwidth(raw: string): string {
  return String(raw ?? '')
    .replace(/[（【]/g, '(')
    .replace(/[）】]/g, ')')
    .replace(/[，、；;]/g, ',')
    .replace(/[：]/g, ':');
}

/** 按逗号切,但括号里的逗号不算分隔符(中文说明里常有顿号)。 */
function splitPieces(text: string): string[] {
  const pieces: string[] = [];
  let buffer = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === '\n' || ch === '|') && depth === 0) {
      if (buffer.trim()) pieces.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  if (buffer.trim()) pieces.push(buffer.trim());
  return pieces;
}

/** 把一段文字规整成 danbooru 风格的 tag:小写、下划线、去掉非字母数字。 */
function cleanTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_:]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * 解析网上分享的「英文 tag（中文说明）」列表。
 *
 * 这类文本几乎都是 `champagne_tulle_gown（香槟色薄纱晚礼服）, halter_neckline（挂脖领口）`
 * 的形状:tag 负责画得准,中文负责让用户认得出、也顺便当触发词。用户把它贴进 JSON 框
 * 只会在第二个括号上报错,所以单独走一条解析路径。
 */
export function parseTagBundle(raw: string): TagBundleDraft {
  const text = normalizeFullwidth(raw);
  const tags: string[] = [];
  const labels: string[] = [];
  for (const piece of splitPieces(text)) {
    const open = piece.indexOf('(');
    const head = open >= 0 ? piece.slice(0, open) : piece;
    const tag = cleanTag(head);
    if (tag && /^[a-z0-9_]+$/.test(tag)) tags.push(tag);
    if (open >= 0) {
      const inside = piece.slice(open).replace(/[()]/g, ' ');
      for (const label of inside.split(/[,/|]+/)) {
        const value = label.trim();
        if (value) labels.push(value);
      }
    } else if (!tag && piece.trim()) {
      // 整片没有括号也没有英文:多半是纯中文说明,留着当触发词
      labels.push(piece.trim());
    }
  }
  const uniqueTags = [...new Set(tags)];
  const uniqueLabels = [...new Set(labels)].filter(value => value.length >= 2);
  return {
    name: uniqueLabels[0] ?? uniqueTags[0] ?? '',
    tags: uniqueTags.join(', '),
    aliases: uniqueLabels.slice(0, 6),
    note: '',
  };
}

/** 从 tag 串猜分类:猜错只是排序位置不对,但总比一律塞进 costume 强。 */
export function guessWardrobeCategory(tags: string, labels: string[] = []): string {
  const hay = `${tags} ${labels.join(' ')}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/pantyhose|thighhigh|thigh_high|stocking|tights|\bsocks?\b|leggings?|garter_strap/, 'hosiery'],
    [/\bbra\b|panty|panties|lingerie|garter|thong|teddy|bodysuit_lingerie|corset|chemise/, 'lingerie'],
    [/swimsuit|bikini|swimwear|one-piece_swim|beach/, 'swim'],
    [/pajama|nightgown|nightdress|sleepwear|négligée|negligee|loungewear/, 'sleep'],
    [/gown|evening_dress|dress\b|cocktail/, 'date'],
    [/school_uniform|blazer|sailor|serafuku|jk\b|pleated_skirt/, 'campus'],
    [/\bsuit\b|blouse|office|pencil_skirt|business/, 'office'],
    [/kimono|hanfu|qipao|cheongsam|yukata|ao_dai/, 'eastern'],
    [/armor|cloak|witch|robe|elf\b|fantasy/, 'fantasy'],
    [/leotard|latex|cosplay|bunny_girl|maid|nurse|cheerleader|wet_look/, 'costume'],
    [/sport|jersey|yoga|gym|tracksuit|sneaker/, 'sport'],
    [/sweater|cardigan|apron|homewear|knit/, 'home'],
  ];
  for (const [pattern, id] of rules) {
    if (pattern.test(hay)) return id;
  }
  return 'costume';
}

export function guessWardrobeSlot(tags: string, labels: string[] = []): string {
  const hay = `${tags} ${labels.join(' ')}`.toLowerCase();
  if (/pantyhose|thighhigh|thigh_high|stocking|tights|\bsocks?\b|leggings?/.test(hay)) return 'hosiery';
  if (/\bbra\b|panties|lingerie_set|garter|thong|teddy|corset|chemise/.test(hay)) return 'underwear';
  if (/high_heels|heels|boots|shoes|sneaker|sandals|flats/.test(hay)) return 'shoes';
  if (/necklace|earring|choker|gloves|bracelet|ring\b|hairpin|veil/.test(hay)) return 'accessory';
  return 'full';
}

/** 导出成 JSON 文本(可直接贴给别人,或存进网盘当备份)。 */
export function exportCustomLoreJson(): string {
  const store = loadCustomLore();
  return JSON.stringify({ version: 1, wardrobe: store.wardrobe, poses: store.poses }, null, 2);
}

export interface ImportReport {
  wardrobe: number;
  poses: number;
  skipped: number;
  error?: string;
}

/**
 * 批量导入:认三种形状 —— 本函数导出的 {wardrobe,poses}、裸数组(按有 category 且
 * category 属于姿势类 → 姿势,否则服装)、以及单条对象。坏条目跳过并计数,不整体失败。
 */
export function importCustomLoreJson(raw: string): ImportReport {
  const text = String(raw ?? '').trim();
  if (!text) return { wardrobe: 0, poses: 0, skipped: 0, error: '内容为空' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 不是 JSON 就按「网上分享的 tag 串」再试一次:用户从别处复制一段 tag 列表粘进来
    // 是常态,让他为此去学 JSON 语法没有意义——原来的报错「多了逗号或少了括号」正是
    // 把人卡在这里的那句话。
    const draft = parseTagBundle(text);
    if (!draft.tags) {
      return {
        wardrobe: 0,
        poses: 0,
        skipped: 0,
        error: '这段既不是 JSON，也没解析出英文 tag。如果只有中文，请用「新增素材」手填。',
      };
    }
    if (!draft.aliases.length) {
      return {
        wardrobe: 0,
        poses: 0,
        skipped: 1,
        error: '解析出了英文 tag，但没有任何中文说明。中文触发词是剧情命中的唯一入口，请补上一两个（正文里会怎么写这件衣服）再导入。',
      };
    }
    const category = guessWardrobeCategory(draft.tags, draft.aliases);
    const slot = guessWardrobeSlot(draft.tags, draft.aliases) as WardrobeSlot;
    const added = addCustomWardrobe({
      name: draft.name || draft.tags.slice(0, 40),
      tags: draft.tags,
      aliases: draft.aliases.join(', '),
      category,
      slot,
      nsfw: 2,
      quality: 5,
      note: '从 tag 串导入',
    });
    if (!added.ok) return { wardrobe: 0, poses: 0, skipped: 1, error: added.error };
    return { wardrobe: 1, poses: 0, skipped: 0 };
  }
  const store = loadCustomLore();
  const wardrobe = [...store.wardrobe];
  const poses = [...store.poses];
  let skipped = 0;
  const pushWardrobe = (value: unknown) => {
    const item = normalizeWardrobe(value, wardrobe.length);
    if (!item || !item.aliases.length) {
      skipped += 1;
      return;
    }
    if (wardrobe.some(exist => nameKey(exist) === nameKey(item))) {
      skipped += 1;
      return;
    }
    if (wardrobe.length >= MAX_WARDROBE) {
      skipped += 1;
      return;
    }
    wardrobe.push({ ...item, id: nextId('u-', wardrobe) });
  };
  const pushPose = (value: unknown) => {
    const item = normalizePose(value, poses.length);
    if (!item || !item.aliases.length) {
      skipped += 1;
      return;
    }
    if (poses.some(exist => nameKey(exist) === nameKey(item))) {
      skipped += 1;
      return;
    }
    if (poses.length >= MAX_POSES) {
      skipped += 1;
      return;
    }
    poses.push({ ...item, id: nextId('up-', poses) });
  };

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const category = String((entry as Record<string, unknown>)?.category ?? '').trim();
      if (POSE_CATEGORIES.some(c => c.id === category)) pushPose(entry);
      else pushWardrobe(entry);
    }
  } else if (parsed && typeof parsed === 'object') {
    const box = parsed as Record<string, unknown>;
    const wardrobeRaw = Array.isArray(box.wardrobe) ? box.wardrobe : [];
    const posesRaw = Array.isArray(box.poses) ? box.poses : [];
    if (!wardrobeRaw.length && !posesRaw.length) {
      // 单条对象:按 category 猜归属
      const category = String(box.category ?? '').trim();
      if (POSE_CATEGORIES.some(c => c.id === category)) pushPose(box);
      else pushWardrobe(box);
    } else {
      for (const entry of wardrobeRaw) pushWardrobe(entry);
      for (const entry of posesRaw) pushPose(entry);
    }
  } else {
    return { wardrobe: 0, poses: 0, skipped: 0, error: '无法识别的结构' };
  }

  persist({ wardrobe, poses });
  return {
    wardrobe: wardrobe.length - store.wardrobe.length,
    poses: poses.length - store.poses.length,
    skipped,
  };
}

/** 清空全部自定义条目(只删自定义,内置表不受影响)。 */
export function clearCustomLore(): void {
  persist(emptyStore());
}

/** 供测试重置模块级缓存。 */
export function resetCustomLoreCache(): void {
  cache = null;
}
