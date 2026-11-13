import { emptyCharFields, normalizeCharAge } from '@/state/charTags';
import { parseImageTags, parseImageTagContent } from '@/st/imageTagRegex';
/** 戴在身上的饰物：归 extra，不要混进头发/眼睛，否则发色发型轴会被它们挤占。 */
const ORNAMENT =
  /^\s*(?:(?:[a-z]+|golden?|silver|bronze|copper|black|white|red|blue|green|purple|pink|grey|gray|brown)\s+){0,2}(?:hair ribbon|hair band|hairband|hairpin|hair clip|hair ornament|hair stick|ribbon|glasses|round glasses|mask|earrings?|earring|piercing|necklace|pendant|choker|collar|bracelet|bangle|anklet|ring|beret|headband|veil|crown|tiara|circlet|headphones)\s*$/i;
/**
 * 年龄段也要收。
 *
 * 过去这里只收 hair/eyes/skin/body/extra，age 恒为空。而 `appearanceLock` 的骨架词
 * （short stature / small frame / flat chest）只在 age 有值时才补——于是每个自动建档的
 * 女角色天生没有体型锚，模型每张图自己挑身高体量，同一人在两张图里能差出一整个头，
 * 多女主同框时一个庞大一个只有掌心大。age 是那条链路的**唯一开关**，必须落库。
 */
const AGE_TOKEN =
  /^(?:child|loli|kid|小女孩|儿童|幼女|萝莉|小学生|teenager|teen|少女|女高中生|高中生|中学生|jk|young adult|young woman|adult|大学生|年轻女性|成熟女性|mature female|mature|milf|熟女|人妻|少妇|三十多岁|四十岁|old woman|elderly|老婆婆|老妇)$/i;
/** Only stable traits actually present in named character blocks, never scene clothes. */
export function recoverProfileFields(tag = '') {  const fields = emptyCharFields();
  fields.sex = '1girl';
  for (const token of tag
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)) {
    const t = token.replace(/_/g, ' ');
    if (/closed eyes|looking|wet|messy|windswept|smil|blush|cry|holding|pulling|breasts out/i.test(t))
      continue;
    const key = ORNAMENT.test(t)
      ? 'extra'
      : AGE_TOKEN.test(t) || /^\d{1,3}\s*(?:岁|years?\s*old|yo)$/i.test(t)
        ? 'age'
        : /hair|bangs|braid|ponytail|twintails|bob cut|ahoge|sidelocks|sideburns|chignon|updo|undercut|dreadlocks|cornrows|mohawk|ringlets|pixie cut|hime cut/i.test(
              t,
            )
          ? 'hair'
          : /eyes|heterochromia|tsurime|tareme/i.test(t)
            ? 'eyes'
            : /skin/i.test(t)
              ? 'skin'
              : /breasts|slim|slender|petite|voluptuous|muscular|stature|frame/i.test(t)
                ? 'body'
                : /eyebrows|face|jaw|freckles|mole|ears/i.test(t)
                  ? 'extra'
                  : '';
    // age 归一成规范档（`少女` → `teenager`），否则 charAgeBuild 认不出，骨架词照样不下发。
    if (key) fields[key] = [fields[key], key === 'age' ? normalizeCharAge(token) : token].filter(Boolean).join(', ');
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
