import { emptyCharFields } from '@/state/charTags';
import { parseImageTags, parseImageTagContent } from '@/st/imageTagRegex';
/** Only stable traits actually present in named character blocks, never scene clothes. */
export function recoverProfileFields(tag = '') {
  const fields = emptyCharFields();
  fields.sex = '1girl';
  for (const token of tag
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)) {
    const t = token.replace(/_/g, ' ');
    if (/closed eyes|looking|wet|messy|windswept|smil|blush|cry|holding|pulling|breasts out/i.test(t))
      continue;
    const key = /hair|bangs|braid|ponytail|twintails|bob cut/i.test(t)
      ? 'hair'
      : /eyes|heterochromia|tsurime|tareme/i.test(t)
        ? 'eyes'
        : /skin/i.test(t)
          ? 'skin'
          : /breasts|slim|slender|petite|voluptuous|muscular/i.test(t)
            ? 'body'
            : /eyebrows|face|jaw|freckles|mole|ears/i.test(t)
              ? 'extra'
              : '';
    if (key) fields[key] = [fields[key], token].filter(Boolean).join(', ');
  }
  return fields;
}
export function recoverProfileFromChat(name: string, aliases: string[], chat: Array<{ mes: string }>) {
  for (const message of [...chat].reverse())
    for (const tag of parseImageTags(message.mes).reverse()) {
      const character = parseImageTagContent(tag).characters.find(
        (c) => c.name === name || aliases.includes(c.name),
      );
      if (character) return recoverProfileFields(character.tag);
    }
  return recoverProfileFields();
}
