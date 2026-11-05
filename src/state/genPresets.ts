/**
 * 生图配置预设的运行时操作层。
 *
 * 数据结构在 state/settings.ts（随设置一起持久化与迁移），这里只放「动作」：
 * 快照当前参数、应用某套预设、按提示词项查绑定、给素材库配图临时套参数。
 *
 * 之所以拆文件：settings.ts 已经背着全部 normalize 与迁移，再塞 CRUD 会连 import 图
 * 都看不清；而 normalize 又不能反过来 import 本模块（会成环），故类型留在 settings。
 */

import { watch } from 'vue';
import { BUILTIN_NAI_ARTISTS } from '@/backends/nai';
import { settings, type GenPreset, type NaiArtistPreset, type NaiSettings } from '@/state/settings';

/**
 * 切换预设时先存旧再套新。
 *
 * 不这么做会丢参数：用户在上一个预设里调了步数、没手动点「更新」，
 * 切走的瞬间那一步改动就只剩在内存里，下一秒被新预设覆盖掉。
 */
export function switchGenPreset(id: string, options?: { keepArtist?: boolean }): boolean {
  if (id === settings.activeGenPreset) return true;
  if (!genPresetById(id)) return false;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  captureIntoGenPreset(settings.activeGenPreset);
  applyingPreset = true;
  const ok = applyGenPreset(id, options);
  applyingPreset = false;
  return ok;
}

/**
 * 参数改动自动回写当前预设（防抖 600ms）。
 *
 * ⚠ 只监听「模型与采样参数」本身，绝不把 `activeArtistId` 或 `artistPresets` 的变化算作参数改动：
 * 否则用户在「提示词」区切了一条还没绑定预设的画师串，600ms 后就会把当前预设原本绑好的
 * `activeArtistId` 静默篡改成新画师串。
 */
let applyingPreset = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function naiParamSignature() {
  const n = settings.nai;
  return [
    n.model,
    n.undesiredContent,
    n.sampler,
    n.steps,
    n.scale,
    n.cfgRescale,
    n.noiseSchedule,
    n.varietyBoost,
    n.naturalLanguage,
  ] as const;
}

function scheduleSync(): void {
  if (applyingPreset || !settings.genPresets.length) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    captureIntoGenPreset(settings.activeGenPreset);
  }, 600);
}

watch(naiParamSignature, scheduleSync);

/** 生成一个不与现有预设相撞的 id。 */
function newPresetId(): string {
  const base = `gp-${Date.now().toString(36)}`;
  let id = base;
  let seq = 1;
  while (settings.genPresets.some(preset => preset.id === id)) {
    id = `${base}-${seq}`;
    seq += 1;
  }
  return id;
}

export function genPresetList(): GenPreset[] {
  return settings.genPresets;
}

export function genPresetById(id: string): GenPreset | null {
  return settings.genPresets.find(preset => preset.id === id) ?? null;
}

/** 当前生效的那套；悬空时回落第一套（normalize 已保证列表非空且 id 有效）。 */
export function activeGenPreset(): GenPreset {
  return genPresetById(settings.activeGenPreset) ?? settings.genPresets[0];
}

/**
 * 素材库配图专用的那套。
 *
 * 返回 null 表示用户没标（或删光了）：此时素材库退回「当前预设」，
 * 而不是悄悄造一套——凭空多出一套参数会让用户觉得设置不听话。
 */
export function loreGenPreset(): GenPreset | null {
  return settings.genPresets.find(preset => preset.forLore) ?? null;
}

/** 把当前渠道参数抓成一套预设（「另存为」用）。 */
export function snapshotGenPreset(name: string): GenPreset {
  const nai = settings.nai;
  return {
    id: newPresetId(),
    name: name.trim() || '未命名预设',
    forLore: false,
    promptKeys: [],
    backend: settings.defaultBackend,
    model: nai.model,
    undesiredContent: nai.undesiredContent,
    sampler: nai.sampler,
    steps: nai.steps,
    scale: nai.scale,
    cfgRescale: nai.cfgRescale,
    noiseSchedule: nai.noiseSchedule,
    varietyBoost: nai.varietyBoost,
    naturalLanguage: nai.naturalLanguage,
    activeArtistId: nai.activeArtistId,
  };
}

/** 新增或整体更新一套预设（按 id 匹配）。 */
export function upsertGenPreset(preset: GenPreset): void {
  const index = settings.genPresets.findIndex(item => item.id === preset.id);
  if (index >= 0) settings.genPresets.splice(index, 1, { ...preset });
  else settings.genPresets.push({ ...preset });
}

/** 把当前渠道参数覆盖进指定预设（「更新当前预设」用，id 与绑定关系不变）。 */
export function captureIntoGenPreset(id: string): boolean {
  const preset = genPresetById(id);
  if (!preset) return false;
  const fresh = snapshotGenPreset(preset.name);
  upsertGenPreset({
    ...fresh,
    id: preset.id,
    forLore: preset.forLore,
    promptKeys: [...preset.promptKeys],
    activeArtistId: preset.activeArtistId,
  });
  return true;
}

export function renameGenPreset(id: string, name: string): boolean {
  const preset = genPresetById(id);
  const next = name.trim();
  if (!preset || !next) return false;
  preset.name = next;
  return true;
}

/** 标成素材库专用（顺带把别的预设的标记清掉，保持不变式）。 */
export function markLoreGenPreset(id: string): void {
  for (const preset of settings.genPresets) preset.forLore = preset.id === id;
}

export function removeGenPreset(id: string): boolean {
  if (settings.genPresets.length <= 1) return false;
  const index = settings.genPresets.findIndex(preset => preset.id === id);
  if (index < 0) return false;
  settings.genPresets.splice(index, 1);
  if (settings.activeGenPreset === id) settings.activeGenPreset = settings.genPresets[0].id;
  // 绑定到已删预设的提示词项与画师串一并解绑，否则下次打开那项会套到一套不存在的参数上。
  for (const [key, value] of Object.entries(settings.promptPresetLinks)) {
    if (value === id) delete settings.promptPresetLinks[key];
  }
  for (const artist of settings.nai.artistPresets) {
    if (artist.genPresetId === id) artist.genPresetId = undefined;
  }
  return true;
}

/**
 * 应用一套预设：把参数写回渠道设置。
 *
 * 只动「画法」相关字段：地址、密钥、接入点、concurrency、vibes 一律不碰——
 * 那些是账号与库，不属于风格配置，换风格换掉密钥是灾难。
 * `keepArtist: true` 时（由「切换画师串自动联动参数预设」触发）不反向改动 `activeArtistId`，
 * 即使手动切参数预设，若该预设没绑特定画师串（`activeArtistId === ''`）也保留当前画师串不被清空。
 */
export function applyGenPreset(id: string, options?: { keepArtist?: boolean }): boolean {
  const preset = genPresetById(id);
  if (!preset) return false;
  settings.defaultBackend = preset.backend;
  const nai = settings.nai;
  nai.model = preset.model;
  nai.undesiredContent = preset.undesiredContent;
  nai.sampler = preset.sampler;
  nai.steps = preset.steps;
  nai.scale = preset.scale;
  nai.cfgRescale = preset.cfgRescale;
  nai.noiseSchedule = preset.noiseSchedule;
  nai.varietyBoost = preset.varietyBoost;
  nai.naturalLanguage = preset.naturalLanguage;
  if (!options?.keepArtist && preset.activeArtistId) {
    nai.activeArtistId = preset.activeArtistId;
  }
  settings.activeGenPreset = preset.id;
  return true;
}

/**
 * 把某套预设的参数临时套到一条 NAI 连接上（素材库配图用）。
 *
 * 传进来的必须是 effectiveNai() 那种浅拷贝：改它不污染用户设置，
 * 也不会因为「配一张预览图」把用户的主出图参数改掉。
 */
export function applyPresetToNaiConn(conn: NaiSettings, preset: GenPreset): void {
  conn.model = preset.model;
  conn.undesiredContent = preset.undesiredContent;
  conn.sampler = preset.sampler;
  conn.steps = preset.steps;
  conn.scale = preset.scale;
  conn.cfgRescale = preset.cfgRescale;
  conn.noiseSchedule = preset.noiseSchedule;
  conn.varietyBoost = preset.varietyBoost;
  conn.naturalLanguage = preset.naturalLanguage;
  conn.activeArtistId = preset.activeArtistId;
}

/** 提示词项 ↔ 预设的绑定（打开提示词项时自动应用，省掉重复配）。 */
export function linkPresetToPrompt(promptKey: string, presetId: string): void {
  if (!promptKey) return;
  if (!presetId) delete settings.promptPresetLinks[promptKey];
  else settings.promptPresetLinks[promptKey] = presetId;
}

export function presetForPrompt(promptKey: string): GenPreset | null {
  const id = settings.promptPresetLinks[promptKey];
  return id ? genPresetById(id) : null;
}

/** 某套预设正被哪些提示词项绑定（UI 显示「被 X 项使用」）。 */
export function promptsLinkedTo(presetId: string): string[] {
  return Object.entries(settings.promptPresetLinks)
    .filter(([, value]) => value === presetId)
    .map(([key]) => key);
}

function findArtistById(artistId: string): NaiArtistPreset | null {
  if (!artistId) return null;
  return (
    settings.nai.artistPresets.find(a => a.id === artistId) ??
    BUILTIN_NAI_ARTISTS.find(a => a.id === artistId) ??
    null
  );
}

/**
 * 按画师串名称推断推荐的模型代际（仅在未显式绑定预设时作智能回退）：
 * - 名字带 `4.5 / v4.5 / 4_5` → 优先匹配非素材库的 NAI 4.5 参数预设；
 * - 名字带 `v5 / nai5 / nai 5` → 优先匹配非素材库的 NAI 5 参数预设。
 */
export function inferPresetForArtistName(name: string): GenPreset | null {
  const text = (name ?? '').toLowerCase();
  if (!text) return null;
  if (/(?:^|[^0-9])4[._]5(?![0-9])/.test(text)) {
    return (
      settings.genPresets.find(p => !p.forLore && p.model.includes('4-5')) ??
      settings.genPresets.find(p => p.model.includes('4-5')) ??
      null
    );
  }
  if (/(?:v5|nai\s*5)(?![0-9])/.test(text)) {
    return (
      settings.genPresets.find(p => !p.forLore && p.model.includes('diffusion-5')) ??
      settings.genPresets.find(p => p.model.includes('diffusion-5')) ??
      null
    );
  }
  return null;
}

/**
 * 查找画师串对应的生图配置预设：
 * 1. 优先读画师串自身的 `artist.genPresetId`（正向多对一绑定：多条 4.5 画师串可共用同一套 4.5 参数）；
 * 2. 兼容旧版在 `GenPreset.activeArtistId` 上做的反向绑定；
 * 3. 若均未显式绑定，按画师串名称中的 `4.5 / V5` 字样智能匹配对应模型预设。
 */
export function presetForArtist(artistId: string): GenPreset | null {
  if (!artistId) return null;
  const artist = findArtistById(artistId);
  if (artist?.genPresetId) {
    const direct = genPresetById(artist.genPresetId);
    if (direct) return direct;
  }
  const reverse = settings.genPresets.find(preset => !preset.forLore && preset.activeArtistId === artistId);
  if (reverse) return reverse;
  if (artist) {
    return inferPresetForArtistName(artist.name);
  }
  return null;
}

/** 为画师串绑定（或解绑）配套的生图配置预设，并在该画师串正处于激活态时立即生效。 */
export function bindArtistGenPreset(artistId: string, presetId: string): boolean {
  const artist = settings.nai.artistPresets.find(a => a.id === artistId);
  if (!artist) return false;
  const cleanId = presetId.trim();
  artist.genPresetId = cleanId || undefined;
  if (cleanId && settings.nai.activeArtistId === artistId) {
    switchGenPreset(cleanId, { keepArtist: true });
  }
  return true;
}

/** 切换当前画师串，并自动联动切换到它绑定（或智能匹配）的生图参数预设。返回被联动激活的预设（无联动则为 null）。 */
export function selectArtistWithPreset(artistId: string): GenPreset | null {
  settings.nai.activeArtistId = artistId;
  const linked = presetForArtist(artistId);
  if (linked && linked.id !== settings.activeGenPreset) {
    switchGenPreset(linked.id, { keepArtist: true });
    return linked;
  }
  return linked;
}
