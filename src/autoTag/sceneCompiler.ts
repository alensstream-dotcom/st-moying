import type { ImageInsertion } from '@/autoTag/protocol';
import { resolveSceneCharacter, type SceneCharacter, type SceneState } from '@/state/sceneState';
import type { WorldVisualProfile } from '@/state/visualTypes';

const tokens = (value: string) => value.split(',').map(t => t.trim()).filter(Boolean);
const dedupe = (values: string[]) => [...new Set(values)].join(', ');
const appearanceToken = /\b(?:hair|eyes|skin|breasts|fandom|bangs|ponytail|braid|bob cut|ahoge|face|eyebrows)\b/i;
const clothesToken = /\b(?:hanfu|kimono|robe|dress|shirt|skirt|coat|jacket|uniform|sleeve|sleeves|clothes|clothing|outfit|ribbon|belt|boots|shoes|sneakers|jeans|stockings|panties|bra|pants|trousers|necktie|collar|trim|corset|gloves|hat)\b/i;
const genderToken = /^\d+(?:girl|boy)s?$|^(?:male|female|man|woman|girl|boy|mature female|young woman)$/i;
const clothingDesign = (value: string) => tokens(value).filter(t => !appearanceToken.test(t) && !genderToken.test(t)
  && !/^(?:open clothes|closed clothes|off shoulder|sleeves rolled up|fully clothed)$/i.test(t))
  .map(t => t.replace(/^(?:open|closed|buttoned|unbuttoned)\s+(?=robe|shirt|coat|jacket)/i, '')).join(', ');

export function wornOutfit(character: SceneCharacter): { tags: string; nl: string } {
  const outfit = character.outfit;
  if (!outfit) return { tags: '', nl: '' };
  if (!outfit.garments.length) return { tags: clothingDesign(outfit.design), nl: `Outfit design (legacy, state unknown): ${clothingDesign(outfit.design)}.` };
  const tags: string[] = [], sentences: string[] = [];
  for (const garment of outfit.garments) {
    const location = garment.state.location ?? 'unknown';
    const design = clothingDesign(garment.design);
    const label = design;
    if (location === 'absent' || location === 'removed') {
      sentences.push(`${label} is removed and is not worn.`); continue;
    }
    if (location !== 'on_body' && location !== 'unknown') {
      sentences.push(`${label} is ${location.replaceAll('_', ' ')}, not worn.`); continue;
    }
    tags.push(...tokens(design));
    const state = garment.state;
    if (state.fastening === 'open') tags.push('open clothes');
    if (state.fastening === 'closed') tags.push('closed clothes');
    if (state.fastening === 'loose') tags.push('loose clothes');
    if (state.leftSleeve === 'off_arm' || state.rightSleeve === 'off_arm') tags.push('off shoulder');
    if (state.leftSleeve === 'rolled_up' || state.rightSleeve === 'rolled_up') tags.push('sleeves rolled up');
    const arrangements: Record<string, string> = { lifted: /skirt|dress/i.test(design) ? 'skirt lifted' : 'clothes lifted', pulled_aside: 'clothes pulled aside', lowered: 'clothes down', around_waist: 'clothes around waist', around_ankles: 'clothes around ankles' };
    if (state.arrangement && arrangements[state.arrangement]) tags.push(arrangements[state.arrangement]);
    const details = [state.fastening === 'open' ? 'unfastened' : '', state.fastening === 'loose' ? 'loosely fastened' : '',
      state.leftSleeve === 'off_arm' ? 'left sleeve off the arm' : '', state.rightSleeve === 'off_arm' ? 'right sleeve off the arm' : '',
      state.arrangement && arrangements[state.arrangement] ? arrangements[state.arrangement] : ''].filter(Boolean);
    sentences.push(`Wearing ${label}${details.length ? `, ${details.join(', ')}` : ''}.`);
  }
  // Generic closed/open tags are not garment-specific: keep open and describe the closed inner layer in NL.
  return { tags: dedupe(tags.includes('open clothes') ? tags.filter(t => t !== 'closed clothes') : tags), nl: sentences.join(' ') };
}

/** Compile known facts into named character blocks. Never choose a new design on redraw. */
export function compileSceneImage(image: ImageInsertion, state: SceneState, independent: boolean, naturalLanguage: boolean, world?: WorldVisualProfile): string[] {
  const warnings: string[] = [];
  const resolved: SceneCharacter[] = [];
  const names = new Set<string>();
  image.characters = image.characters.filter(c => {
    const name = c.characterId || `${c.work ?? ''}\0${c.name.normalize('NFKC').toLowerCase()}`;
    if (names.has(name)) { warnings.push(`${c.name}: 重复人物块已忽略`); return false; }
    names.add(name); return true;
  });
  for (const prompt of image.characters) {
    const character = resolveSceneCharacter(state, prompt.name, prompt.work, prompt.characterId);
    if (!character) { warnings.push(`${prompt.name}: ambiguous or missing identity; free prompt retained`); continue; }
    resolved.push(character);
    prompt.characterId = character.characterId;
    if (character.work) prompt.work = character.work;
    if (!naturalLanguage && character.outfit?.garments.some(g => g.state.location && !['on_body', 'unknown', 'removed', 'absent'].includes(g.state.location)
      || g.state.leftSleeve && g.state.rightSleeve && g.state.leftSleeve !== g.state.rightSleeve)) {
      warnings.push(`${character.name}: 自然语言未开启，离身衣物位置/左右袖差异仅保存在状态中，tag 无法完整表达`);
    }
    const appearance = character.identity.gender === 'male' && character.provenance.startsWith('legacy_visual_completion')
      ? {} : { ...character.baseAppearance, ...character.currentAppearance };
    const outfit = wornOutfit(character);
    const canonical = [...Object.values(appearance).flatMap(tokens).filter(t => !genderToken.test(t)), ...tokens(outfit.tags)];
    for (const binding of character.visualBindings ?? []) if (binding.scope === 'style' || binding.scope === 'all') canonical.push(...tokens(binding.resolved.style).filter(t => !appearanceToken.test(t) && !clothesToken.test(t) && !genderToken.test(t)));
    const known = new Set(canonical.map(t => t.toLowerCase()));
    const dynamic = tokens(prompt.tag).filter(t =>
      !known.has(t.toLowerCase()) && !(Object.keys(appearance).length && appearanceToken.test(t))
      && !(character.outfit && clothesToken.test(t))
      && !(character.identity.confirmed && genderToken.test(t)));
    if (world?.forbiddenByDefault.length && character.outfit?.provenance.startsWith('世界观视觉补全')) {
      const banned = new Set(world.forbiddenByDefault.map(t => t.trim().toLowerCase()));
      for (let index = dynamic.length - 1; index >= 0; index--) if (clothesToken.test(dynamic[index]) && banned.has(dynamic[index].toLowerCase())) {
        warnings.push(`${character.name}: 默认服装排除 ${dynamic[index]}`); dynamic.splice(index, 1);
      }
    }
    const sex = character.identity.gender === 'male' ? '1boy' : character.identity.gender === 'female' ? '1girl' : '';
    prompt.tag = dedupe([sex, ...canonical, ...dynamic].filter(Boolean));
    // Free-form NL can contradict managed tags. Use a deterministic description when managed.
    if (naturalLanguage && (canonical.length || character.identity.confirmed || character.outfit)) {
      prompt.nl = [`${character.name}.`, ...Object.values(appearance), outfit.nl].filter(Boolean).join(' ');
    } else if (!naturalLanguage) prompt.nl = '';
  }
  if (resolved.length && independent) {
    // Global prompt must not impose one character's face or worn design on all characters.
    const managed = new Set(resolved.flatMap(c => [
      ...Object.values({ ...c.baseAppearance, ...c.currentAppearance }).flatMap(tokens),
      ...tokens(c.outfit?.design ?? ''),
    ]).map(t => t.toLowerCase()));
    const hasAppearance = resolved.some(c => Object.keys(c.baseAppearance).length || Object.keys(c.currentAppearance).length);
    const hasOutfit = resolved.some(c => c.outfit);
    image.tag = tokens(image.tag).filter(t => !managed.has(t.toLowerCase())
      && !(hasAppearance && appearanceToken.test(t)) && !(hasOutfit && clothesToken.test(t))).join(', ') || 'scenery';
    if (resolved.length === image.characters.length && resolved.every(c => c.identity.confirmed && c.identity.gender !== 'unknown')) {
      const counts = (['female', 'male'] as const).flatMap(gender => {
        const count = resolved.filter(c => c.identity.gender === gender).length;
        return count ? [`${count}${gender === 'female' ? 'girl' : 'boy'}${count > 1 ? 's' : ''}`] : [];
      });
      image.tag = dedupe([...counts, ...tokens(image.tag).filter(t => !genderToken.test(t))]);
    }
    // The base NL is also free-form and may contain contradictory clothes/appearance.
    if (hasAppearance || hasOutfit) image.nl = '';
  } else if (resolved.length && !independent) {
    if (image.characters.length === 1) {
      const c = resolved[0];
      const base = tokens(image.tag).filter(t => !(Object.keys(c.baseAppearance).length && appearanceToken.test(t))
        && !(c.outfit && clothesToken.test(t)) && !(c.identity.confirmed && genderToken.test(t)));
      image.tag = dedupe([...base, ...tokens(image.characters[0].tag)]);
      image.nl = naturalLanguage ? image.characters[0].nl : '';
    } else warnings.push('当前后端不支持独立人物提示；多人外貌/衣物未合并，需支持 character prompts 的 NAI 模型');
  }
  if (!image.characters.length && state.characters.length) warnings.push('模型未提供出镜人物名，无法确定性编译本图人物状态');
  if (world?.visualStyle && world.provenance === 'user') image.tag = dedupe([...tokens(world.visualStyle), ...tokens(image.tag)]);
  return warnings;
}
