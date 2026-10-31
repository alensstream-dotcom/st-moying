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
import { settings, type GenPreset, type NaiSettings } from '@/state/settings';

/**
 * 切换预设时先存旧再套新。
 *
 * 不这么做会丢参数：用户在上一个预设里调了步数、没手动点「更新」，
 * 切走的瞬间那一步改动就只剩在内存里，下一秒被新预设覆盖掉。
 */
export function switchGenPreset(id: string): boolean {
  if (id === settings.activeGenPreset) return true;
  if (!genPresetById(id)) return false;
  captureIntoGenPreset(settings.activeGenPreset);
  applyingPreset = true;
  const ok = applyGenPreset(id);
  applyingPreset = false;
  return ok;
}

/**
 * 参数改动自动回写当前预设（防抖 600ms）。
 *
 * 用户的要求是「整组默认参数就是当前预设的参数」，没有「保存」按钮——
 * 所以每次拨动滑块都要落回预设里。防抖是为了连续拖步数时不连打几十次。
 */
let applyingPreset = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync(): void {
  if (applyingPreset || !settings.genPresets.length) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    captureIntoGenPreset(settings.activeGenPreset);
  }, 600);
}

watch(() => settings.nai, scheduleSync, { deep: true });

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
  upsertGenPreset({ ...fresh, id: preset.id, forLore: preset.forLore, promptKeys: [...preset.promptKeys] });
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
  // 绑定到已删预设的提示词项一并解绑，否则下次打开那项会套到一套不存在的参数上。
  for (const [key, value] of Object.entries(settings.promptPresetLinks)) {
    if (value === id) delete settings.promptPresetLinks[key];
  }
  return true;
}

/**
 * 应用一套预设：把参数写回渠道设置。
 *
 * 只动「画法」相关字段：地址、密钥、接入点、concurrency、vibes 一律不碰——
 * 那些是账号与库，不属于风格配置，换风格换掉密钥是灾难。
 */
export function applyGenPreset(id: string): boolean {
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
  nai.activeArtistId = preset.activeArtistId;
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

/**
 * 按画师串反查它绑定的生图预设。
 *
 * 「提示词预设」在渠道页就是画师串库:换一组画师串往往要配不同的步数/Scale。
 * 反查出来就自动整套切过去,用户不用再记「这套配哪个参数」。
 */
export function presetForArtist(artistId: string): GenPreset | null {
  if (!artistId) return null;
  return settings.genPresets.find(preset => preset.activeArtistId === artistId) ?? null;
}
