import { reactive } from 'vue';
import { getContext } from '@/st/context';
import { stateHash } from './sceneState';
import { BUILTIN_VISUAL_MATERIALS, cloneVisual, defaultWorld, inferWorld } from './visualDesign';
import type { VisualMaterial, WorldVisualProfile } from './visualTypes';

const KEY = 'bbi_visual_materials_v1';
const WORLD_KEY = 'bbi_world_visual_v1';
interface Library { v: 1; records: VisualMaterial[] }
export const visualLibrary = reactive<{ records: VisualMaterial[]; error: string }>({ records: [], error: '' });
export function safePreviewPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (/^\/user\/(?:images|files)\//.test(value) && !value.includes('..')) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
const string = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 6000) : '';
export function normalizeMaterial(raw: unknown): VisualMaterial | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (!string(item.name) || !['character', 'outfit', 'style'].includes(string(item.kind))) return null;
  const appearance = Object.fromEntries(Object.entries(item.appearance && typeof item.appearance === 'object' ? item.appearance : {})
    .filter(([k, v]) => ['fandom', 'age', 'hair', 'eyes', 'skin', 'body', 'extra'].includes(k) && typeof v === 'string').map(([k, v]) => [k, string(v)]));
  const garments = Array.isArray(item.garments) ? item.garments.slice(0, 30).flatMap(rawGarment => {
    if (!rawGarment || typeof rawGarment !== 'object') return [];
    const g = rawGarment as Record<string, unknown>;
    if (!string(g.id) || !string(g.design)) return [];
    // Materials describe designs. Runtime state is separately established at application time.
    return [{ id: string(g.id), design: string(g.design), state: { location: 'on_body', fastening: 'closed' } }];
  }) : [];
  const material: VisualMaterial = {
    id: string(item.id) || `material_${stateHash(JSON.stringify([item.name, item.work, item.variant, Date.now()]))}`,
    version: Number.isInteger(item.version) && Number(item.version) > 0 ? Number(item.version) : 1,
    kind: item.kind as VisualMaterial['kind'], name: string(item.name), aliases: Array.isArray(item.aliases) ? item.aliases.map(string).filter(Boolean) : [],
    work: string(item.work), variant: string(item.variant), settings: Array.isArray(item.settings) ? item.settings.filter((v): v is WorldVisualProfile['setting'] => ['auto', 'xianxia', 'historical', 'modern', 'scifi'].includes(String(v))) : [],
    categories: Array.isArray(item.categories) ? item.categories.map(string).filter(Boolean) : [], appearance, garments,
    style: string(item.style), tags: string(item.tags), previewPath: safePreviewPath(item.previewPath), source: string(item.source), verified: item.verified === true,
    createdAt: Number(item.createdAt) || Date.now(), updatedAt: Number(item.updatedAt) || Date.now(),
  };
  if ([material.name, ...material.aliases, ...Object.values(material.appearance), ...material.garments.map(g => g.design), material.style, material.tags]
    .some(s => /<\/?(?:bbi_image|tag|nl|negative|characters|size)\b/i.test(s))) return null;
  if (item.vibe && typeof item.vibe === 'object') {
    const vibe = item.vibe as Record<string, unknown>;
    // Only registered Vibe metadata is accepted. A local import cannot smuggle an arbitrary fetch URL.
    if (string(vibe.id) && (/^\/user\/files\//.test(string(vibe.dataPath)) || /^idb:[a-zA-Z0-9_-]+$/.test(string(vibe.dataPath))) && !string(vibe.dataPath).includes('..')) material.vibe = cloneVisual(item.vibe) as VisualMaterial['vibe'];
  }
  return material;
}
export function hydrateVisualLibrary(): void {
  const raw = getContext()?.extensionSettings?.[KEY] as Library | undefined;
  visualLibrary.error = '';
  if (!raw) { visualLibrary.records = []; return; }
  if (raw.v !== 1 || !Array.isArray(raw.records)) { visualLibrary.records = []; visualLibrary.error = '素材库格式未知：已保留原始数据，禁止覆盖'; return; }
  visualLibrary.records = raw.records.map(normalizeMaterial).filter((m): m is VisualMaterial => !!m);
  if (visualLibrary.records.length !== raw.records.length) visualLibrary.error = '部分素材损坏：原始数据已保留，请导出备份修复后再写入';
}
export function latestMaterials(): VisualMaterial[] {
  const result = new Map(BUILTIN_VISUAL_MATERIALS.map(m => [m.id, cloneVisual(m)]));
  for (const material of visualLibrary.records) if (!result.has(material.id) || result.get(material.id)!.version <= material.version) result.set(material.id, material);
  return [...result.values()];
}
export function saveMaterial(raw: unknown): VisualMaterial {
  if (visualLibrary.error) throw new Error(visualLibrary.error);
  const ctx = getContext();
  if (!ctx?.extensionSettings) throw new Error('酒馆设置尚未就绪');
  const material = normalizeMaterial(raw);
  if (!material) throw new Error('素材需要合法名称和类型');
  const previous = latestMaterials().find(m => m.id === material.id);
  material.version = previous ? previous.version + 1 : 1;
  material.createdAt = previous?.createdAt ?? Date.now(); material.updatedAt = Date.now();
  const records = [...visualLibrary.records, material];
  const prior = ctx.extensionSettings[KEY];
  try {
    ctx.extensionSettings[KEY] = { v: 1, records } satisfies Library;
    ctx.saveSettingsDebounced?.(); visualLibrary.records = records;
  } catch (error) { ctx.extensionSettings[KEY] = prior; throw error; }
  return cloneVisual(material);
}
export function importMaterials(json: string): number {
  const parsed = JSON.parse(json) as { v?: number; records?: unknown[] };
  if (parsed.v !== 1 || !Array.isArray(parsed.records)) throw new Error('导入格式必须为 {v:1,records:[...]}');
  const records = parsed.records.map(normalizeMaterial);
  if (records.some(m => !m)) throw new Error('有无效素材，未导入任何条目');
  const ctx = getContext(); if (!ctx?.extensionSettings || visualLibrary.error) throw new Error(visualLibrary.error || '酒馆未就绪');
  const original = cloneVisual(visualLibrary.records), originalRaw = ctx.extensionSettings[KEY];
  try {
    let count = 0;
    for (const record of records as VisualMaterial[]) {
      // Reimporting an unchanged exported version is idempotent.
      if (visualLibrary.records.some(m => m.id === record.id && m.version === record.version && JSON.stringify(m) === JSON.stringify(record))) continue;
      saveMaterial(record); count++;
    }
    return count;
  } catch (error) { visualLibrary.records = original; ctx.extensionSettings[KEY] = originalRaw; throw error; }
}
export function exportMaterials(): string { return JSON.stringify({ v: 1, records: visualLibrary.records }, null, 2); }
export function worldProfile(): WorldVisualProfile {
  const ctx = getContext(), raw = ctx?.chatMetadata?.[WORLD_KEY] as Partial<WorldVisualProfile> | undefined;
  const world = { ...defaultWorld(), ...raw };
  if (!['auto', 'xianxia', 'historical', 'modern', 'scifi'].includes(world.setting)) world.setting = 'auto';
  if (!Array.isArray(world.forbiddenByDefault)) world.forbiddenByDefault = [];
  if (world.setting === 'auto') {
    const card = ctx?.characters?.[Number(ctx.characterId)];
    world.setting = inferWorld(JSON.stringify(card ?? {}));
    world.provenance = `角色卡自动识别：${world.setting}（仅视觉补全）`;
  }
  if ((world.setting === 'xianxia' || world.setting === 'historical') && !world.characterStylingDefaults.trim()) world.characterStylingDefaults = 'traditional hair ornament';
  return world;
}
export function saveWorldProfile(world: WorldVisualProfile): void {
  const ctx = getContext(); if (!ctx?.chatMetadata) throw new Error('请先打开聊天');
  if (ctx.chatMetadata[WORLD_KEY] && !ctx.chatMetadata[`${WORLD_KEY}_backup`]) ctx.chatMetadata[`${WORLD_KEY}_backup`] = cloneVisual(ctx.chatMetadata[WORLD_KEY]);
  ctx.chatMetadata[WORLD_KEY] = cloneVisual(world); ctx.saveMetadataDebounced?.();
}
export function visualConfigurationRevision(): string { return JSON.stringify([worldProfile(), latestMaterials()]); }
