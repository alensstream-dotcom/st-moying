import { reactive } from 'vue';
import { charTagsBeforeFloor } from '@/state/charTags';
import { getContext } from '@/st/context';
import { replayScene, transcriptRevision, transcriptRevisions, type Gender, type SceneCharacter, type SceneEvent, type SceneState } from '@/state/sceneState';
import { cloneVisual, createBinding } from './visualDesign';
import { hydrateVisualLibrary } from './visualLibrary';
import type { VisualMaterial, VisualScope } from './visualTypes';

const KEY = 'bbi_identity_confirmations_v1';
interface Confirmation { characterId: string; gender: Gender; isHeroine: boolean; aliases?: string[]; work?: string }
interface Confirmations { v: 1; entries: Confirmation[]; undo: Confirmation[][] }
export const sceneStore = reactive<{ current: SceneState }>({ current: { characters: [], warnings: [] } });

function store(): Confirmations {
  const raw = getContext()?.chatMetadata?.[KEY] as Confirmations | undefined;
  return raw?.v === 1 && Array.isArray(raw.entries) && Array.isArray(raw.undo)
    ? JSON.parse(JSON.stringify(raw)) : { v: 1, entries: [], undo: [] };
}
interface ManualEntry { floor: number; swipe: number; revision: string; event: SceneEvent }
interface ManualTimeline { v: 1; entries: ManualEntry[]; undo: ManualEntry[][] }
const MANUAL_KEY = 'bbi_visual_timeline_v1';
function timeline(): ManualTimeline {
  const raw = getContext()?.chatMetadata?.[MANUAL_KEY] as ManualTimeline | undefined;
  return raw?.v === 1 && Array.isArray(raw.entries) && Array.isArray(raw.undo) ? cloneVisual(raw) : { v: 1, entries: [], undo: [] };
}
export function manualEvents(): Record<number, SceneEvent[]> {
  const ctx = getContext(), events: Record<number, SceneEvent[]> = {};
  if (!ctx) return events;
  const revisions = transcriptRevisions(ctx.chat, ctx.chat.length - 1);
  for (const entry of timeline().entries) {
    if (ctx.chat[entry.floor]?.swipe_id !== undefined && ctx.chat[entry.floor].swipe_id !== entry.swipe) continue;
    if (!ctx.chat[entry.floor] || revisions[entry.floor] !== entry.revision) continue;
    (events[entry.floor] ??= []).push(entry.event);
  }
  return events;
}
export function confirmationRevision(): string { return JSON.stringify([store().entries, timeline().entries]); }
export function applyConfirmations(state: SceneState): SceneState {
  for (const entry of store().entries) {
    const character = state.characters.find(c => c.characterId === entry.characterId);
    if (!character) continue;
    if (character.identity.confirmed && character.identity.gender !== entry.gender) {
      state.warnings.push(`${character.name}: 人工身份优先，已拦截冲突身份`);
    }
    character.identity = { gender: entry.gender, confirmed: true, evidence: 'user confirmation' };
    character.isHeroine = entry.isHeroine && entry.gender === 'female';
    if (entry.aliases) character.aliases = [...new Set([character.name, ...entry.aliases])];
    if (entry.work !== undefined) character.work = entry.work;
  }
  return state;
}
export function sceneAt(floor: number, line = Infinity): SceneState {
  const ctx = getContext();
  if (!ctx) return { characters: [], warnings: [] };
  return applyConfirmations(replayScene(charTagsBeforeFloor(0), ctx.chat, floor, ctx.getCurrentChatId?.() ?? '', line, manualEvents()));
}
export function refreshSceneStore(): void {
  try { sceneStore.current = sceneAt((getContext()?.chat.length ?? 0) - 1); }
  catch (error) { sceneStore.current = { characters: [], warnings: [error instanceof Error ? error.message : '历史状态暂不可用'] }; }
}
export function confirmIdentity(character: SceneCharacter, gender: Gender, isHeroine: boolean, aliases?: string[], work?: string): void {
  const ctx = getContext();
  if (!ctx?.chatMetadata) return;
  const next = store();
  next.undo.push(next.entries.map(e => ({ ...e })));
  next.undo = next.undo.slice(-20);
  next.entries = next.entries.filter(e => e.characterId !== character.characterId);
  next.entries.push({ characterId: character.characterId, gender, isHeroine: isHeroine && gender === 'female', aliases: aliases ?? character.aliases, work: work ?? character.work });
  ctx.chatMetadata[KEY] = next;
  ctx.saveMetadataDebounced?.();
  refreshSceneStore();
}

export function recordManualVisualEvent(floor: number, event: SceneEvent): void {
  const ctx = getContext(), message = ctx?.chat[floor];
  if (!ctx?.chatMetadata || !message) throw new Error('目标聊天楼层不存在');
  const next = timeline();
  next.undo.push(cloneVisual(next.entries)); next.undo = next.undo.slice(-20);
  next.entries.push({ floor, swipe: message.swipe_id ?? 0, revision: transcriptRevision(ctx.chat, floor), event: cloneVisual(event) });
  const previous = ctx.chatMetadata[MANUAL_KEY];
  try { ctx.chatMetadata[MANUAL_KEY] = next; ctx.saveMetadataDebounced?.(); }
  catch (error) { ctx.chatMetadata[MANUAL_KEY] = previous; throw error; }
  refreshSceneStore();
}
export function bindMaterialToCharacter(character: SceneCharacter, material: VisualMaterial, scope: VisualScope, mode: 'preserve' | 'change', floor: number, line: number, materialSeed = 0): void {
  if (scope === 'appearance' && !Object.keys(material.appearance).length) throw new Error('此素材没有独立外貌字段，不能套用外貌');
  if (scope === 'outfit' && !material.garments.length) throw new Error('此素材没有服装部件，不能套用服装');
  if (scope === 'style' && !material.style.trim()) throw new Error('此素材没有画风字段，不能套用画风');
  recordManualVisualEvent(floor, { kind: 'binding', name: character.name, characterId: character.characterId, sourceLine: line,
    evidence: '用户主动应用素材', binding: createBinding(material, scope, floor, line, materialSeed), mode });
}
export function undoManualVisualEvent(): void {
  const ctx = getContext(); if (!ctx?.chatMetadata) return;
  const next = timeline(), prior = next.undo.pop(); if (!prior) return;
  next.entries = prior; ctx.chatMetadata[MANUAL_KEY] = next; ctx.saveMetadataDebounced?.(); refreshSceneStore();
}
export function undoIdentityConfirmation(): void {
  const ctx = getContext();
  if (!ctx?.chatMetadata) return;
  const next = store(), prior = next.undo.pop();
  if (!prior) return;
  next.entries = prior;
  ctx.chatMetadata[KEY] = next;
  ctx.saveMetadataDebounced?.();
  refreshSceneStore();
}

let bound = false;
export function bindSceneSync(): void {
  const ctx = getContext();
  if (!ctx || bound) return;
  bound = true;
  hydrateVisualLibrary();
  for (const name of ['CHAT_CHANGED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED']) {
    if (ctx.eventTypes[name]) ctx.eventSource.on(ctx.eventTypes[name], () => setTimeout(() => { if (name === 'CHAT_CHANGED') hydrateVisualLibrary(); refreshSceneStore(); }, 0));
  }
  refreshSceneStore();
}
