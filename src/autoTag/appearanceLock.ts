import { appearancePolicy, applyAppearancePolicies } from '@/state/appearancePolicy';
import { CHAR_TAG_FIELDS, isManualFandom, type CharTagEntry } from '@/state/charTags';
import { resolveCanonicalCharName } from './charReuse';
import type { ImageInsertion } from './protocol';
import { currentIdentityFacts, isMaleIdentity, type IdentityFact } from '@/state/characterIdentity';

const split = (s: string) =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const unique = (parts: string[]) => [...new Map(parts.map((t) => [t.toLowerCase(), t])).values()].join(', ');
const TRAIT =
  /\b(?:hair|eyes?|skin|face|eyebrows|eyelashes|bangs|ponytail|braid|ahoge|sidelocks|sideburns|chignon|undercut|dreadlocks|cornrows|mohawk|ringlets|bob|pixie cut|updo|hair buns?|breasts|bust|hips|stature|frame|petite|slim|slender|voluptuous|muscular|tall|short woman|pointy ears|elf ears|tsurime|tareme|twintails|hairbun|hair bun|twin tails|fangs|lips|heterochromia|mole|scar|freckles|young adult|mature female|teenager|child)\b/i;
const EXPRESSION =
  /\b(?:closed eyes|half.closed eyes|looking|gaze|eye contact|tears|crying|smiling|smile|blush|expression|breasts out|grabbing|holding|pulling|touching|stroking)\b/i;
const FANDOM = /^[^:]*\s+\\?\([^()]+\\?\)\s*(?:::\s*)?$/;
export function isAppearanceDescription(token: string): boolean {
  token = token.replace(/_/g, ' ');
  if (
    /^(?:wet hair|messy hair|windswept hair|closed eyes|half.closed eyes|blush|smile|smiling|crying|tears|breasts out)$/i.test(
      token,
    )
  )
    return false;
  return (
    !/^(?:looking|holding|grabbing|pulling|touching|stroking)\b/i.test(token) &&
    (TRAIT.test(token) || FANDOM.test(token.replace(/^[-+\d.]+::/, '')))
  );
}
export function appearanceParts(entry: CharTagEntry): string[] {
  // A manual fandom swap must not mix the previous character's physical traits into the new face.
  const p = appearancePolicy(entry.name);
  const fields = isManualFandom(entry)
    ? ([...new Set(['fandom', ...Object.keys(p?.fields ?? {})])] as (keyof typeof entry.fields)[])
    : CHAR_TAG_FIELDS.filter((k) => k !== 'outfit');
  const pinned = p && p.mode !== 'story' ? p.fields : {};
  return fields.flatMap((k) =>
    split(entry.fields[k]).filter(
      (t) =>
        !Object.entries(pinned).some(
          ([field, value]) =>
            field !== k &&
            value &&
            (field === 'hair'
              ? /\b(?:hair|bangs|ponytail|braid)\b/i
              : field === 'eyes'
                ? /\beyes\b/i
                : field === 'skin'
                  ? /\bskin\b/i
                  : /$^/
            ).test(t) &&
            !split(value).some((v) => v.toLowerCase() === t.toLowerCase()),
        ),
    ),
  );
}

function ownsTrait(entry: CharTagEntry, token: string): boolean {
  if (!isAppearanceDescription(token)) return false;
  if (isManualFandom(entry) || entry.fields.fandom) return true;
  const f = entry.fields;
  return !!(
    (f.hair &&
      /\b(?:hair|bangs|ponytail|twintails|braid|ahoge|sidelocks|sideburns|chignon|undercut|dreadlocks|cornrows|mohawk|ringlets|bob|pixie cut|updo|hair bun)\b/i.test(
        token,
      )) ||
    (f.eyes && /\b(?:eyes?|heterochromia)\b/i.test(token)) ||
    (f.skin && /\bskin\b/i.test(token)) ||
    (f.body &&
      /\b(?:breasts|bust|hips|stature|frame|petite|slim|slender|voluptuous|muscular|tall)\b/i.test(token)) ||
    (f.age && /\b(?:young adult|mature female|teenager|child)\b/i.test(token)) ||
    (f.extra && /\b(?:face|eyebrows|eyelashes|ears|mole|scar|freckles)\b/i.test(token))
  );
}
function alignNaturalLanguage(entry: CharTagEntry, original: string, canonical: string[]): string {
  const locked = isManualFandom(entry);
  const plain = (s: string) => s.replace(/^[-+\d.]+::/, '').replace(/::/g, '');
  let result = original.trim();
  if (!result) return canonical.map(plain).join(', ') + '.';
  const first = (value: string, fallback: string) => plain(split(value)[0] ?? fallback);
  const colors =
    'black|white|silver|grey|gray|blond|blonde|golden|brown|auburn|red|pink|blue|green|purple|violet|orange';
  const hair = new RegExp(
    `\\b(?:(?:${colors}|long|short|straight|curly|wavy|flowing|silky|waist-length|shoulder-length)\\s+){1,5}hair\\b`,
    'gi',
  );
  const eyes = new RegExp(
    `\\b(?:(?:${colors}|amber|hazel|ruby|emerald|bright|dark|light|deep)\\s+){1,3}eyes\\b`,
    'gi',
  );
  if (locked || entry.fields.hair)
    result = result.replace(hair, locked ? 'hair' : first(entry.fields.hair, 'hair'));
  if (locked || entry.fields.eyes)
    result = result.replace(eyes, locked ? 'eyes' : first(entry.fields.eyes, 'eyes'));
  if (locked || entry.fields.skin)
    result = result.replace(
      /\b(?:(?:pale|fair|white|tan|tanned|dark|brown|smooth|porcelain)\s+){1,3}skin\b/gi,
      locked ? 'skin' : first(entry.fields.skin, 'skin'),
    );
  if (!locked && entry.fields.body) {
    const breast = split(entry.fields.body).find((t) => /\b(?:breasts|bust)\b/i.test(t));
    result = result.replace(
      /\b(?:large|huge|small|flat|medium|ample)\s+(?:breasts|bust)\b/gi,
      breast ? plain(breast) : 'breasts',
    );
    const figure = split(entry.fields.body).find((t) =>
      /\b(?:figure|slim|slender|voluptuous|petite|muscular)\b/i.test(t),
    );
    result = result.replace(
      /\b(?:slim|slender|voluptuous|petite|muscular)\s+(?:figure|body)\b/gi,
      figure ? plain(figure) : 'figure',
    );
  }
  if (locked) {
    result = result.replace(
      /\b(?:large|huge|small|flat|medium|ample|voluptuous|slender|petite|tall|short|mature|young|blonde|blond|brunette|redheaded)\s+(?=breasts|bust|figure|body|woman|girl|face)/gi,
      '',
    );
    result = result.replace(
      new RegExp(
        `\\b(?:(?:${colors}|long|short|high|low|twin|straight|curly|wavy)\\s+){0,3}(?:ponytail|twintails|twin tails|braids?|bangs)\\b`,
        'gi',
      ),
      'hairstyle',
    );
    result = result
      .replace(/\b(?:tsurime|tareme|almond.shaped|narrow|wide|round|upturned|downturned)\s+eyes\b/gi, 'eyes')
      .replace(
        /\b(?:round|oval|angular|small|sharp|delicate|beautiful|pretty)\s+(?:face|jaw|chin)\b/gi,
        'face',
      )
      .replace(/\b(?:thin|thick|arched|straight)\s+eyebrows\b/gi, 'eyebrows')
      .replace(
        /\b(?:slim|slender|voluptuous|petite|muscular|tall|short|curvy)\s+(?:figure|body|woman|girl)\b/gi,
        'person',
      );
  }
  if (!locked && entry.fields.hair) {
    result = result.replace(
      /\b(?:(?:short|long|straight|curly|wavy|high|low|single|twin|side|black|blonde?|brown|silver|white|red|blue|pink)\s+){0,5}(?:ponytails?|twintails|twin tails|braids?|bob(?: cut)?|pixie cut|updo|hair buns?)\b/gi,
      'hairstyle',
    );
    result += ` Fixed hairstyle: ${entry.fields.hair}.`;
  }
  // Tags carry every fixed field. Keep the scene/action prose rather than replacing it with a profile dump.
  return result;
}

/** Resolve only named blocks. Never expand @ references or impose traits on unnamed people. */
export function enforceAppearance(
  image: ImageInsertion,
  entries: CharTagEntry[],
  nl: boolean,
  independent: boolean,
  facts: IdentityFact[] = currentIdentityFacts(),
): string[] {
  entries = applyAppearancePolicies(entries);
  const managed: CharTagEntry[] = [],
    warnings: string[] = [];
  for (const prompt of image.characters) {
    if (
      isMaleIdentity(prompt.name, facts) &&
      !entries.some((e) => e.name === prompt.name && e.source === 'manual')
    )
      continue;
    const name = resolveCanonicalCharName(prompt.name, entries),
      entry = entries.find((e) => e.name === name);
    if (!entry) continue;
    const canonical = appearanceParts(entry);
    if (!canonical.length) continue;
    managed.push(entry);
    prompt.name = name;
    const known = new Set(canonical.map((t) => t.toLowerCase()));
    const dynamic = split(prompt.tag).filter(
      (t) =>
        !ownsTrait(entry, t) &&
        !known.has(t.toLowerCase()) &&
        !(entry.fields.sex && /^(?:\d+)?(?:girls?|boys?|woman|man|female|male)$/i.test(t)),
    );
    const changed = split(prompt.tag).some((t) => isAppearanceDescription(t) && !known.has(t.toLowerCase()));
    prompt.tag = unique([...canonical, ...dynamic]);
    if (nl) {
      prompt.nl = alignNaturalLanguage(entry, prompt.nl, canonical);
    } else prompt.nl = '';
    if (changed)
      warnings.push(
        `${name}: 本次人物外貌已校正为${isManualFandom(entry) ? '手动锁定的同人形象' : '人物库档案'}`,
      );
  }
  if (managed.length && independent) {
    const all = new Set(
      managed
        .flatMap(appearanceParts)
        .filter((t) => !/^\d+(?:girl|boy)s?$/i.test(t))
        .map((t) => t.toLowerCase()),
    );
    image.tag = split(image.tag)
      .filter((t) => !managed.some((e) => ownsTrait(e, t)) && !all.has(t.toLowerCase()))
      .join(', ');
    if (nl)
      image.nl = image.nl
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !TRAIT.test(s))
        .join(' ');
  } else if (managed.length && image.characters.length === 1) {
    image.tag = unique([
      ...split(image.tag).filter((t) => !isAppearanceDescription(t)),
      ...split(image.characters[0].tag),
    ]);
    if (nl) image.nl = image.characters[0].nl;
  }
  return warnings;
}
