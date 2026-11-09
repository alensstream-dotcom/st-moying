import { TAG_CHINESE_CORE, TAG_WORDS } from '@/data/tagChineseCore';
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
  dictionary = { ...(await import('@/data/tagChinese.json')).default, ...TAG_CHINESE_CORE };
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
      const words = bare.replace(/[-]/g, ' ').split(/\s+/);
      let translated = 0;
      const result: string[] = [];
      for (let i = 0; i < words.length;) {
        let found = false;
        for (let n = Math.min(6, words.length - i); n >= 1; n--) {
          const part = words.slice(i, i + n).join(' '),
            meaning = custom[part] ?? dictionary?.[part] ?? (n === 1 ? TAG_WORDS[part] : undefined);
          if (meaning) {
            result.push(meaning);
            translated += n;
            i += n;
            found = true;
            break;
          }
        }
        if (!found) {
          result.push(words[i]);
          i++;
        }
      }
      return translated ? result.join(' / ') + '（组合解释）' : `${t.trim()}（名称或自定义描述）`;
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

/** Recover the explicit appearance tags of a saved image. This is not vision or face training. */
export function imageAppearance(entry: CharTagEntry, tag: string): CharTagEntry {
  const fields = { ...entry.fields };
  const parts = tag
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const groups: Partial<Record<CharTagField, RegExp>> = {
    hair: /\b(?:hair|bangs|ponytail|twintails|braid|ahoge|hime cut|bob cut|sidelocks)\b/i,
    eyes: /\b(?:eyes|heterochromia|tsurime|tareme|sanpaku)\b/i,
    skin: /\b(?:skin|tan)\b/i,
    body: /\b(?:breasts|hips|waist|stature|frame|figure|petite|slender|muscular|tall|slim|long legs)\b/i,
    extra: /\b(?:face|chin|jawline|nose|lips|eyebrows|eyelashes|ears|mole|freckles|scar)\b/i,
  };
  const identity = parts.find(
    (t) =>
      /^[^:()]+\s+\\?\([^()]+\\?\)(?:::\s*)?$/.test(t.replace(/^[-+\d.]+::/, '')) && !/artist|style/i.test(t),
  );
  fields.fandom = identity ?? '';
  const dynamic =
    /\b(?:holding|grabbing|touching|pulling|licking|kissing|looking|closed eyes|half.closed|tears|crying|sweat|wet|blush|smile|open mouth|breasts out)\b/i;
  for (const [field, pattern] of Object.entries(groups)) {
    const values = parts.filter((t) => pattern.test(t) && !dynamic.test(t));
    if (values.length) fields[field as CharTagField] = values.join(', ');
  }
  return {
    ...entry,
    fields,
    nl: CHAR_FIELDS.map((f) => fields[f])
      .filter(Boolean)
      .join(', '),
    source: 'manual',
    desc: '从该图保存的原始人物提示词提取外貌；不是从像素识别，也不是模型训练',
  };
}
const CHAR_FIELDS: CharTagField[] = ['fandom', 'sex', 'age', 'hair', 'eyes', 'skin', 'body', 'extra'];
