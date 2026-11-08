import type { CharTagEntry } from '@/state/charTags';
import type { STMessage } from '@/st/context';
import { stripImageTags } from '@/st/imageTagRegex';
import type { VisualBinding, WorldVisualProfile } from './visualTypes';
import { applyVisualBinding, cloneVisual } from './visualDesign';

export type Gender = 'unknown' | 'female' | 'male';
export interface Garment {
  id: string;
  design: string;
  state: Partial<Record<'location' | 'fastening' | 'leftSleeve' | 'rightSleeve', string>>;
}
export interface SceneCharacter {
  characterId: string;
  name: string;
  work: string;
  aliases: string[];
  identity: { gender: Gender; confirmed: boolean; evidence: string; conflict?: string };
  isHeroine: boolean;
  baseAppearance: Record<string, string>;
  currentAppearance: Record<string, string>;
  visualBindings?: VisualBinding[];
  outfit?: { outfitInstanceId: string; design: string; garments: Garment[]; provenance: string };
  provenance: string;
}
export interface SceneEvent {
  name: string;
  work?: string;
  characterId?: string;
  aliases?: string[];
  kind: 'identity' | 'appearance' | 'outfit' | 'binding' | 'design' | 'defaults';
  /** Program-generated visual completion at the actual introduction line; never LLM evidence. */
  designSeed?: SceneCharacter;
  sourceLine: number;
  evidence: string;
  evidenceSource?: 'story' | 'card' | 'worldbook';
  gender?: Gender;
  isHeroine?: boolean;
  appearance?: Record<string, string>;
  operation?: 'change' | 'patch';
  garments?: Garment[];
  binding?: VisualBinding;
  mode?: 'preserve' | 'change';
  baseAppearance?: Record<string, string>;
}
export interface SceneDelta {
  v: 1;
  revision: string;
  events: SceneEvent[];
  rejected: string[];
  world?: WorldVisualProfile;
  designSeeds?: SceneCharacter[];
  frames?: Array<{ sourceLine: number; tag: string; characters: SceneCharacter[]; warnings: string[] }>;
}
export interface SceneState {
  characters: SceneCharacter[];
  warnings: string[];
}

/** Non-cryptographic version/ID, never used as a security boundary. */
export function stateHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
  }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16);
}
export function storyText(text: string): string {
  // 必须剥离行内插入的 tag 换行，还原为物理行。
  return stripImageTags(text.replace(/[\r\n]+<bbi_image>[\s\S]*?<\/bbi_image>[\r\n]*/gi, '')).replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim()).join('\n').trim();
}
export function transcriptRevision(chat: STMessage[], floor: number, targetText?: string): string {
  return transcriptRevisions(chat, floor, targetText).at(-1) ?? stateHash('');
}
/** One rolling pass, rather than rehashing the whole transcript for every floor. */
export function transcriptRevisions(chat: STMessage[], floor: number, targetText?: string): string[] {
  const revisions: string[] = [];
  let prefix = '';
  for (let i = 0; i <= floor && i < chat.length; i++) {
    const m = chat[i];
    if (!m) {
      const revision = stateHash(prefix + JSON.stringify(['unloaded-message', i]));
      revisions.push(revision); prefix = stateHash(revision); continue;
    }
    const revision = stateHash(prefix + JSON.stringify([m.send_date ?? '', m.name ?? '', m.swipe_id ?? 0,
      storyText(i === floor && targetText !== undefined ? targetText : m.mes ?? '')]));
    revisions.push(revision);
    const delta = m.extra?.bbiCharChanges as { ops?: unknown; scene?: SceneDelta } | undefined;
    prefix = stateHash(revision + JSON.stringify(delta ? [delta.ops, delta.scene?.events] : null));
  }
  return revisions;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
const appearanceKeys = ['fandom', 'age', 'sex', 'hair', 'eyes', 'skin', 'body', 'extra'];

export function legacyCharacter(entry: CharTagEntry, scope: string): SceneCharacter {
  // Only an explicit manual sex field is authoritative. Generated 1girl tags prove nothing.
  const gender: Gender = entry.source !== 'manual' ? 'unknown'
    : /^(?:male|man|1boy|男|男性)$/i.test(entry.fields.sex.trim()) ? 'male'
      : /^(?:female|woman|1girl|女|女性)$/i.test(entry.fields.sex.trim()) ? 'female' : 'unknown';
  const characterId = entry.characterId ?? `char_${stateHash(`${scope}\0${entry.name}`)}`;
  return {
    characterId, name: entry.name, work: '', aliases: [...new Set([entry.name, ...(entry.aliases ?? [])])],
    identity: { gender, confirmed: gender !== 'unknown', evidence: gender === 'unknown' ? '' : 'manual sex field' },
    isHeroine: gender === 'female',
    baseAppearance: Object.fromEntries(appearanceKeys.filter(k => k !== 'sex').map(k => [k, entry.fields[k as keyof typeof entry.fields]]).filter(([, v]) => v)),
    currentAppearance: {}, provenance: entry.source === 'manual' ? 'manual' : 'legacy_visual_completion',
    ...(entry.fields.outfit ? { outfit: {
      outfitInstanceId: `outfit_${stateHash(`${characterId}\0legacy\0${entry.fields.outfit}`)}`,
      design: entry.fields.outfit, garments: [], provenance: 'legacy_unparsed_design',
    } } : {}),
  };
}

export function resolveSceneCharacter(state: SceneState, name: string, work?: string, id?: string): SceneCharacter | undefined {
  const candidates = state.characters.filter(c => id ? c.characterId === id && c.aliases.some(alias => key(alias) === key(name))
    : c.aliases.some(alias => key(alias) === key(name)) && (work === undefined || c.work === work));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function seedVisualDesign(state: SceneState, entry: CharTagEntry, scope: string): void {
  const known = resolveSceneCharacter(state, entry.name);
  const candidate = legacyCharacter(entry, scope);
  if (!known) {
    if (!state.characters.some(c => c.aliases.includes(entry.name))) state.characters.push(candidate);
    return;
  }
  for (const [field, value] of Object.entries(candidate.baseAppearance)) {
    if (!known.baseAppearance[field]) known.baseAppearance[field] = value;
  }
  if (!known.outfit) known.outfit = candidate.outfit;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 4000) : '';
const stateValues: Record<string, string[]> = {
  location: ['unknown', 'on_body', 'held', 'on_chair', 'on_table', 'removed', 'absent'],
  fastening: ['unknown', 'open', 'closed', 'loose'],
  leftSleeve: ['unknown', 'on_arm', 'off_arm', 'rolled_up', 'damaged'],
  rightSleeve: ['unknown', 'on_arm', 'off_arm', 'rolled_up', 'damaged'],
};
export function parseSceneEvents(raw: unknown, positions: Map<string, number>): SceneEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: SceneEvent[] = [];
  for (const value of raw.slice(0, 100)) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const name = text(item.name), evidence = text(item.evidence);
    const sourceLine = positions.get(text(item.position).toUpperCase());
    if (!name || !evidence || sourceLine === undefined || !['identity', 'appearance', 'outfit'].includes(text(item.kind))) continue;
    const event: SceneEvent = { name, evidence, sourceLine, kind: item.kind as SceneEvent['kind'] };
    if (['story', 'card', 'worldbook'].includes(text(item.evidenceSource))) event.evidenceSource = item.evidenceSource as SceneEvent['evidenceSource'];
    if (text(item.work)) event.work = text(item.work);
    if (text(item.characterId)) event.characterId = text(item.characterId);
    if (Array.isArray(item.aliases)) event.aliases = item.aliases.map(text).filter(Boolean).slice(0, 20);
    if (['male', 'female', 'unknown'].includes(text(item.gender))) event.gender = item.gender as Gender;
    if (typeof item.isHeroine === 'boolean') event.isHeroine = item.isHeroine;
    if (item.appearance && typeof item.appearance === 'object') {
      event.appearance = Object.fromEntries(Object.entries(item.appearance).filter(([k, v]) =>
        ['age', 'hair', 'eyes', 'skin', 'body', 'extra'].includes(k) && typeof v === 'string').map(([k, v]) => [k, text(v)]));
    }
    if (item.operation === 'change' || item.operation === 'patch') event.operation = item.operation;
    if (Array.isArray(item.garments)) event.garments = item.garments.slice(0, 30).flatMap(g => {
      if (!g || typeof g !== 'object' || !text(g.id)) return [];
      const state = Object.fromEntries(Object.entries(g.state ?? {}).filter(([k, v]) => stateValues[k]?.includes(String(v))));
      return [{ id: text(g.id), design: text(g.design), state }];
    });
    events.push(event);
  }
  return events.sort((a, b) => a.sourceLine - b.sourceLine || (a.kind === 'identity' ? -1 : b.kind === 'identity' ? 1 : 0));
}

export function validateSceneEvents(events: SceneEvent[], source: string, sources: { card?: string; worldbook?: string; characters?: Array<{ name: string; aliases: string[] }> } = {}): { events: SceneEvent[]; rejected: string[] } {
  const accepted: SceneEvent[] = [], rejected: string[] = [];
  for (const event of events) {
    const preceding = source.replace(/\r\n?/g, '\n').split('\n').slice(0, event.sourceLine + 1).join('\n');
    const evidenceText = !event.evidenceSource || event.evidenceSource === 'story' ? preceding : sources[event.evidenceSource] ?? '';
    if (!evidenceText.includes(event.evidence) || (event.evidenceSource && event.evidenceSource !== 'story' && event.kind !== 'identity')) {
      rejected.push(`${event.name}: evidence missing at position`); continue;
    }
    if (event.kind === 'identity' && !event.evidence.includes(event.name)) {
      rejected.push(`${event.name}: identity quote does not name the person`); continue;
    }
    if (event.kind === 'outfit' || event.kind === 'appearance') {
      const names = [event.name, ...(sources.characters?.find(c => c.name === event.name)?.aliases ?? [])];
      if (!names.some(name => name && event.evidence.includes(name))) {
        rejected.push(`${event.name}: change quote does not identify the affected person; state retained`); continue;
      }
    }
    if (event.kind === 'outfit' && !(event.operation === 'patch'
      ? /解|脱|放|拿|穿|系|扣|敞|卷|撕|破|损|整理|open|unfasten|remove|put|take|wear|roll|damage|close|fasten/i
      : /换|穿|披|衣|袍|裙|衫|外套|wear|dress|robe|shirt|coat|outfit/i).test(event.evidence)) {
      rejected.push(`${event.name}: no explicit clothing action/design in evidence`); continue;
    }
    accepted.push(clone(event));
  }
  return { events: accepted, rejected };
}

export function applySceneEvents(input: SceneState, events: SceneEvent[], scope: string, revision: string, floor: number, line = Infinity): SceneState {
  const state = clone(input);
  for (const [index, event] of [...events].sort((a, b) => a.sourceLine - b.sourceLine).entries()) {
    if (event.sourceLine > line) continue;
    let character = resolveSceneCharacter(state, event.name, event.work, event.characterId);
    if (!character && event.kind === 'identity' && !event.characterId) {
      // A supplied work disambiguates homonyms; unqualified ambiguous names never merge.
      if (state.characters.some(c => c.aliases.some(a => key(a) === key(event.name)) && (!event.work || c.work === event.work))) {
        state.warnings.push(`${event.name}: ambiguous identity`); continue;
      }
      character = { characterId: `char_${stateHash(`${scope}\0${event.work ?? ''}\0${event.name}\0${floor}`)}`,
        name: event.name, work: event.work ?? '', aliases: [event.name], identity: { gender: 'unknown', confirmed: false, evidence: '' },
        isHeroine: false, baseAppearance: {}, currentAppearance: {}, provenance: 'story_evidence' };
      state.characters.push(character);
    }
    if (!character) { state.warnings.push(`${event.name}: unresolved identity`); continue; }
    if (event.kind === 'defaults' && event.designSeed) {
      restoreVisualSeeds(state, [event.designSeed]);
    } else if (event.kind === 'binding' && event.binding) {
      applyVisualBinding(character, event.binding, event.mode ?? 'preserve');
    } else if (event.kind === 'design') {
      character.baseAppearance = { ...event.baseAppearance };
      character.currentAppearance = {};
      character.provenance = 'manual_visual_design';
    } else if (event.kind === 'identity') {
      if (!Object.keys(character.baseAppearance).length && event.appearance) {
        character.baseAppearance = { ...event.appearance };
        character.provenance = 'identity_evidence + initial_visual_completion';
      }
      const male = /男性|男人|男子|男孩|男儿|男修|公子|少爷|\b(?:male|man|boy)\b/i.test(event.evidence);
      const female = /女性|女人|女子|女孩|女修|少女|女主|\b(?:female|woman|girl|heroine)\b/i.test(event.evidence);
      const contextual = /梦境|假设|假如|伪装|男扮|女扮|变身|变成|回忆|不是|并非|非男|非女|dream|disguis|transform|not a|isn't/i.test(event.evidence);
      const gender: Gender = contextual || male === female ? 'unknown' : male ? 'male' : 'female';
      if (gender !== 'unknown' && event.gender === gender) {
        if (character.identity.confirmed && character.identity.gender !== gender) {
          character.identity.conflict = event.evidence;
          state.warnings.push(`${event.name}: identity conflict, retained confirmed identity`);
        } else character.identity = { gender, confirmed: true, evidence: event.evidence };
      }
      // Heroine membership is independent; never infer it from drawing tags or feminine appearance.
      if (event.isHeroine !== undefined && !character.identity.conflict) {
        character.isHeroine = event.isHeroine && character.identity.confirmed && character.identity.gender === 'female';
      }
      for (const alias of event.aliases ?? []) {
        if (!key(event.evidence).includes(key(alias)) || !key(event.evidence).includes(key(event.name))) continue;
        const owner = state.characters.find(c => c !== character && c.aliases.some(a => key(a) === key(alias)) && c.work === character!.work);
        if (!owner && !character.aliases.some(a => key(a) === key(alias))) character.aliases.push(alias);
      }
    } else if (event.kind === 'appearance') {
      // Evidence-backed changes are temporary by default; the stable design remains unchanged.
      Object.assign(character.currentAppearance, event.appearance);
    } else if (event.operation === 'change') {
      // Models sometimes label a removal as a full change while returning only
      // state fields. Apply it as a patch only when every named garment exists.
      if (event.garments?.length && event.garments.every(g => !g.design && Object.keys(g.state).length > 0
        && character.outfit?.garments.some(existing => existing.id === g.id))
        && /脱|解|放|拿|敞|卷|撕|破|remove|unfasten|take off|put down|roll/i.test(event.evidence)) {
        for (const patch of event.garments) Object.assign(character.outfit!.garments.find(g => g.id === patch.id)!.state, patch.state);
        continue;
      }
      if (!event.garments?.length || event.garments.some(g => !g.design) || new Set(event.garments.map(g => g.id)).size !== event.garments.length) {
        state.warnings.push(`${event.name}: invalid outfit change`); continue;
      }
      if (character.outfit && !/换上|换了|换成|换衣|更衣|穿上|穿好|穿回|重新穿|披上|套上|换装|change[ds]? (?:into|clothes|outfit)|put(?:s)? on|dress(?:es|ed)? in|redress/i.test(event.evidence)) {
        state.warnings.push(`${event.name}: 没有明确换装/重新穿戴事件，已保留原款式和穿脱状态；局部变化应使用 patch`);
        continue;
      }
      character.outfit = {
        outfitInstanceId: `outfit_${stateHash(`${character.characterId}\0${revision}\0${floor}\0${index}`)}`,
        design: event.garments.map(g => g.design).join(', '), garments: clone(event.garments), provenance: event.evidence,
      };
      character.visualBindings = (character.visualBindings ?? []).flatMap(binding => binding.scope === 'all'
        ? [{ ...binding, scope: 'appearance' as const }, { ...binding, scope: 'style' as const }]
        : binding.scope === 'outfit' ? [] : [binding]);
    } else if (event.operation === 'patch') {
      for (const patch of event.garments ?? []) {
        const garment = character.outfit?.garments.find(g => g.id === patch.id);
        if (!garment) { state.warnings.push(`${event.name}: unknown garment ${patch.id}, state retained`); continue; }
        // Deliberately ignore patch.design. A partial state event cannot replace the template.
        Object.assign(garment.state, patch.state);
      }
    }
  }
  return state;
}

/** Read-only migration, replay only active and version-valid deltas. No global writes. */
export function replayScene(seed: CharTagEntry[], chat: STMessage[], floor: number, scope: string, line = Infinity, manual: Record<number, SceneEvent[]> = {}): SceneState {
  if (chat.slice(0, Math.max(0, floor + 1)).some(message => !message)) throw new Error('目标楼层之前存在尚未载入的历史消息，请先加载相关历史后再解析/编译；已保存人物和穿搭未改动');
  let state: SceneState = { characters: seed.map(entry => legacyCharacter(entry, scope)), warnings: [] };
  const revisions = transcriptRevisions(chat, floor);
  for (let i = 0; i <= floor && i < chat.length; i++) {
    const envelope = chat[i].extra?.bbiCharChanges as { swipe?: number; scene?: SceneDelta; ops?: unknown[] } | undefined;
    if (!envelope || envelope.swipe !== (chat[i].swipe_id ?? 0)) {
      state = applySceneEvents(state, manual[i] ?? [], scope, revisions[i], i, i === floor ? line : Infinity); continue;
    }
    if (envelope.scene && (envelope.scene.v !== 1 || !Array.isArray(envelope.scene.events))) {
      state.warnings.push(`floor ${i}: unsupported/corrupt state skipped`); continue;
    }
    if (envelope.scene && envelope.scene.revision !== revisions[i]) {
      state.warnings.push(`floor ${i}: stale state ignored; re-analyse from this floor`); continue;
    }
    // Keep old auto-created visual designs, but do not turn their sex tags into identity facts.
    for (const raw of Array.isArray(envelope.ops) ? envelope.ops : []) {
      if (!raw || typeof raw !== 'object') continue;
      const op = raw as Partial<CharTagEntry> & { kind?: string; field?: string; value?: string };
      if (!envelope.scene && op.kind === 'set' && op.name && typeof op.value === 'string') {
        const character = resolveSceneCharacter(state, op.name);
        // Preserve historical legacy visual changes without promoting any sex tag to fact.
        if (character && op.field === 'outfit') character.outfit = {
          outfitInstanceId: `outfit_${stateHash(`${character.characterId}\0legacy\0${i}\0${op.value}`)}`,
          design: op.value, garments: [], provenance: 'legacy_unparsed_design',
        };
        else if (character && ['age', 'hair', 'eyes', 'skin', 'body', 'extra'].includes(op.field ?? '')) character.currentAppearance[op.field!] = op.value;
        continue;
      }
      if (op.kind !== 'new' || !op.name || !op.fields) continue;
      seedVisualDesign(state, { name: op.name, fields: op.fields, raw: op.raw ?? '', nl: op.nl ?? '', source: 'ai', desc: '', history: [] }, scope);
    }
    restoreVisualSeeds(state, envelope.scene?.designSeeds ?? []);
    const combinedEvents = [...(envelope.scene?.events ?? []), ...(manual[i] ?? [])];
    state = applySceneEvents(state, combinedEvents, scope, envelope.scene?.revision ?? revisions[i], i, i === floor ? line : Infinity);
  }
  return state;
}

/** Restore only missing visual fields, never rewind story state or manual changes. */
export function restoreVisualSeeds(state: SceneState, designs: SceneCharacter[]): void {
  for (const design of designs) {
    const character = state.characters.find(c => c.characterId === design.characterId) ?? resolveSceneCharacter(state, design.name, design.work || undefined);
    if (!character) { state.characters.push(cloneVisual(design)); continue; }
    for (const [field, value] of Object.entries(design.baseAppearance)) if (!character.baseAppearance[field]) character.baseAppearance[field] = value;
    for (const binding of design.visualBindings ?? []) {
      if (binding.scope !== 'appearance' && binding.scope !== 'style') continue;
      if (!character.visualBindings?.some(b => b.scope === binding.scope || b.scope === 'all')) (character.visualBindings ??= []).push(cloneVisual(binding));
    }
    if (!character.outfit && design.outfit) {
      character.outfit = cloneVisual(design.outfit); character.visualBindings = cloneVisual(design.visualBindings ?? []);
    }
  }
}

export const SCENE_PROTOCOL = `
连续性协议（优先于自由描述）：未提及必须继承，不得因脸部特写、素材预览或重画而重置衣服。
JSON 必须包含 sceneEvents 数组；首次出场的人物身份、首次明确穿搭和实际变化必须提取，不能只输出传统 changes。没有明确变化就返回 []。
每项 name、可选 work/characterId、kind、position(P编号)、evidence（必须逐字引用目标正文，且不晚于生效位置）。证据必须明确包含受影响的人物姓名或已登记别名；代词段应连同前文姓名一并引用，无法消歧则保留未知，不把别人的变化套给该角色。
身份事实也可引用角色卡/已激活世界书：evidenceSource="card" 或 "worldbook"；evidence 必须逐字引用本次提供的对应设定且包含人物名。仅身份可用静态设定引用，衣物和临时形象变化必须引用目标剧情，不能用静态初始设定重置状态。
身份：kind="identity", gender="male|female|unknown", isHeroine（是否女主，独立判断）, aliases（仅明确同一人别名）。长发、俊美、女装、1girl 和图片不是女性证据；梦境/回忆/变身/伪装不改变现实身份。所有出场人物都可索引，未知不能默认女性。
同名不同作品必须分别提供 work；首次 identity 可附 appearance={hair,eyes,skin,body,extra} 作为独立人物视觉设计补全，不能把这些绘图外貌当成身份依据。images.characters 使用对应 characterId 或 work 消歧。
临时形象：kind="appearance", appearance={hair,eyes,skin,body,extra}（只列确实改变的字段，值为英文 tags）；基础外貌首次建档后固定。
换装：kind="outfit", operation="change", garments=[{id:"outer",design:"blue hanfu, white trim",state:{location:"on_body",fastening:"closed",leftSleeve:"on_arm",rightSleeve:"on_arm"}}]。仅真正换装或首次明确衣服才创建，列出这一套所有部件。仅款式设计，无人物身份/脸/发色。
局部状态：kind="outfit",operation="patch",garments=[{id:"已有部件ID",state:{fastening:"open"}}]。只列发生变化的状态，不能重建整套。
location: unknown/on_body/held/on_chair/on_table/removed/absent；fastening: unknown/open/closed/loose；左右袖: unknown/on_arm/off_arm/rolled_up/damaged。明确脱下与未提及不同，空值不要用来重置。
每张 images 都应提供 characters:[{name,tag,nl}] 标识出镜者（单人也要）。程序会把已绑定外貌和实际穿衣状态编译进对应人物；动作表情放人物 tag，场景画风构图放基础 tag。不要把外貌放全局强加所有人。
传统 changes 只用于首次视觉设计补全，不要用 set 重写已有身份/外貌/衣服；变化改用有证据的 sceneEvents。
`;
