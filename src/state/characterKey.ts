import { getContext } from '@/st/context';
const KEY = 'bbiCharacterNames';
type NameRecord = { id: string; name: string; aliases: string[] };
function records(): NameRecord[] {
  const raw = getContext()?.chatMetadata?.[KEY];
  return Array.isArray(raw) ? raw.filter(r => r && typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.aliases)) : [];
}
export function registeredName(name: string): string {
  const hits = records().filter(r => r.name === name || r.aliases.includes(name));
  return hits.length === 1 ? hits[0].name : name;
}
/** Collision-free legacy key; persisted on edits, no metadata writes during reads. */
export function characterKey(name: string): string {
  const known = records().find(r => r.name === name || r.aliases.includes(name));
  return known?.id ?? 'char_' + [...name.trim()].map(c => c.codePointAt(0)!.toString(16)).join('_');
}
export function registerCharacterName(name: string, previous: string, id: string): void {
  const ctx = getContext();
  if (!ctx) return;
  const all = records(), record = all.find(r => r.id === id);
  const aliases = [...new Set([...(record?.aliases ?? []), previous].filter(n => n && n !== name))];
  ctx.chatMetadata[KEY] = [...all.filter(r => r.id !== id), { id, name, aliases }];
  if (name !== previous) {
    for (const key of ['bbiAppearancePolicies', 'bbiCharacterStudio', 'moying_character_aliases_v1']) {
      const box = { ...((ctx.chatMetadata[key] as Record<string, unknown>) ?? {}) };
      if (Object.hasOwn(box, previous)) { box[name] = box[previous]; delete box[previous]; }
      if (key === 'moying_character_aliases_v1') box[name] = [...new Set([...(Array.isArray(box[name]) ? box[name] as string[] : []), ...aliases])];
      ctx.chatMetadata[key] = box;
    }
  }
  ctx.saveMetadataDebounced();
}
