import { characterKey, registeredName } from '@/state/characterKey';
import { applyAppearancePolicies } from '@/state/appearancePolicy';
import type { CharTagEntry } from '@/state/charTags';
import { resolveCanonicalCharName } from './charReuse';
import { appearanceParts, enforceAppearance, isAppearanceDescription } from './appearanceLock';
import { clothingCaption, enforceClothing, isClothingDescription, type ClothingState } from './outfitTimeline';
import { composeCamera } from './scene';
import type { ImageInsertion } from './protocol';

const tags = (...values: string[]) => [...new Set(values.flatMap(v => v.split(',').map(t => t.trim()).filter(Boolean)))].join(', ');

/** Single assembly point shared by planning, redraw and the novel reader.
 * New plans supply action-only fields; old/manual full prompts keep compatibility.
 * Never modifies the user's backend prompt or sampling settings.
 */
export function compileScene(image: ImageInsertion, entries: CharTagEntry[], wardrobe: ClothingState, nl: boolean, independent: boolean): string[] {
  const profiles = applyAppearancePolicies(entries.map(e => ({ ...e, name: registeredName(e.name) })));
  wardrobe = new Map([...wardrobe.values()].map(e => [registeredName(e.name), { ...e, name: registeredName(e.name) }]));
  for (const c of image.characters) { c.name = registeredName(c.name); c.characterId = characterKey(c.name); }
  const structured = image.characters.filter(c => typeof c.actionTag === 'string');
  const legacy = image.characters.filter(c => typeof c.actionTag !== 'string');
  const notes: string[] = [];
  if (legacy.length) {
    const old = { ...image, characters: legacy };
    notes.push(...enforceAppearance(old, profiles, nl, independent));
    enforceClothing(old, wardrobe, nl, independent);
    image.tag = old.tag;
    image.nl = old.nl;
  }
  for (const c of structured) {
    const name = resolveCanonicalCharName(c.name, profiles);
    const profile = profiles.find(e => e.name === name);
    const record = wardrobe.get(name);
    if (!profile && !record) continue;
    c.name = name;
    const appearance = profile ? appearanceParts(profile).join(', ') : '';
    const clothes = record ? clothingCaption(record) : { tag: '', nl: '' };
    // No rewriting/deleting sentences: action prose is its own field.
    const action = (c.actionTag || '').split(',').map(t => t.trim()).filter(t => !(profile && isAppearanceDescription(t)) && !(record && isClothingDescription(t))).join(', ');
    c.tag = tags(appearance, clothes.tag, action);
    c.nl = nl ? [c.actionNl || '', clothes.nl].filter(Boolean).join(' ') : '';
    if (!c.tag) c.tag = 'person';
  }
  image.tag = composeCamera(image.tag, image.scene);
  if (!independent && structured.length) {
    image.tag = tags(image.tag, ...image.characters.map(c => c.tag));
    if (nl) image.nl = [image.nl, ...image.characters.map(c => c.nl)].filter(Boolean).join(' ');
  }
  return notes;
}
