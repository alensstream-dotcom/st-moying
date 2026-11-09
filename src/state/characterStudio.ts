import { getContext } from '@/st/context';
import type { CharTagEntry, CharTagField } from './charTags';
export interface LookVersion {
  id: string;
  at: number;
  fields: CharTagEntry['fields'];
  nl: string;
  image?: string;
  raw?: string;
}
export interface LookSettings {
  locks?: string[];
  reference: boolean;
  strength: number;
  fidelity: number;
  active?: LookVersion;
  history: LookVersion[];
}
export const fingerprint = (fields: CharTagEntry['fields']) => JSON.stringify(fields);
export function lookSettings(name: string): LookSettings {
  const box = getContext()?.chatMetadata?.bbiCharacterStudio as Record<string, LookSettings> | undefined;
  return (
    (box && Object.hasOwn(box, name) ? box[name] : undefined) ?? {
      reference: false,
      strength: 0.6,
      fidelity: 0.5,
      history: [],
    }
  );
}
export function saveLook(name: string, next: LookSettings) {
  const ctx = getContext();
  if (!ctx) throw new Error('请先打开聊天');
  ctx.chatMetadata.bbiCharacterStudio = {
    ...((ctx.chatMetadata.bbiCharacterStudio as object) ?? {}),
    [name]: next,
  };
  ctx.saveMetadataDebounced();
}
export function adoptLook(entry: CharTagEntry, image?: string) {
  const old = lookSettings(entry.name),
    v = {
      id: crypto.randomUUID(),
      at: Date.now(),
      fields: { ...entry.fields },
      nl: entry.nl,
      image,
      raw: entry.raw,
    };
  saveLook(entry.name, {
    ...old,
    reference: false,
    active: v,
    history: [...(old.active ? [old.active] : []), ...old.history].slice(0, 16),
  });
  return v;
}
let dictionary: Record<string, string> | null = null;
export async function loadTagChinese() {
  dictionary = (await import('@/data/tagChinese.json')).default;
}
export function explainTags(value: string): string {
  return value
    .split(',')
    .map((t) => {
      const bare = t
        .trim()
        .replace(/^[-+\d.]+::/, '')
        .replace(/::$/, '')
        .replace(/_/g, ' ')
        .toLowerCase();
      if (!bare) return '';
      let custom: Record<string, string> = {};
      try {
        custom = JSON.parse(localStorage.getItem('bbi.tagChinese.user') || '{}');
      } catch {}
      if (custom[bare] || dictionary?.[bare]) return custom[bare] ?? dictionary![bare];
      const hair = bare.match(
        /^(long|short|medium|very long) (black|white|silver|blonde|brown|blue|pink|red|purple|green) hair$/,
      );
      if (hair)
        return (
          (dictionary?.[hair[2] + ' hair'] ?? hair[2]) + ' / ' + (dictionary?.[hair[1] + ' hair'] ?? hair[1])
        );
      return `${t.trim()}（未收录）`;
    })
    .filter(Boolean)
    .join(' · ');
}
export function setTagChinese(tag: string, zh: string) {
  let box: Record<string, string> = {};
  try {
    box = JSON.parse(localStorage.getItem('bbi.tagChinese.user') || '{}');
  } catch {}
  box[tag.trim().replace(/_/g, ' ').toLowerCase()] = zh.trim();
  localStorage.setItem('bbi.tagChinese.user', JSON.stringify(box));
}
export const FACE_FIELDS: CharTagField[] = ['eyes', 'skin', 'extra'];

export function searchTagChinese(query: string): Array<[string, string]> {
  const q = query.trim().toLowerCase();
  if (!q || !dictionary) return [];
  return Object.entries(dictionary)
    .filter(([en, zh]) => en.includes(q) || zh.toLowerCase().includes(q))
    .slice(0, 24);
}
