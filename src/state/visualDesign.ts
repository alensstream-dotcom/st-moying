import type { SceneCharacter, SceneState } from './sceneState';
import { stateHash } from './sceneState';
import type { VisualBinding, VisualMaterial, VisualScope, VisualSetting, WorldVisualProfile } from './visualTypes';

export const cloneVisual = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const defaultWorld = (): WorldVisualProfile => ({ v: 1, setting: 'auto', wardrobeDefaults: '', visualStyle: '', characterStylingDefaults: '', forbiddenByDefault: [], provenance: 'user' });
export function inferWorld(source: string): VisualSetting {
  if (/仙侠|仙俠|修仙|修真|宗门|宗門|灵根|靈根|xianxia|cultivation/i.test(source)) return 'xianxia';
  if (/古风|古風|古代|武侠|武俠|江湖|汉服|漢服|historical|wuxia|hanfu|traditional|oriental/i.test(source)) return 'historical';
  if (/赛博|賽博|星际|星際|科幻|cyberpunk|science fiction|scifi/i.test(source)) return 'scifi';
  if (/西幻|魔法|剑与魔法|western fantasy|dnd|rpg|magic/i.test(source)) return 'western_fantasy';
  if (/80年代|70年代|90年代|复古|retro|nostalgic|vintage/i.test(source)) return 'modern_retro';
  if (/现代|現代|都市|校园|校園|校服|modern|school uniform|serafuku|jeans|hoodie/i.test(source)) return 'modern';
  return 'auto';
}
export function normalizeVisualName(value: string): string {
  const traditional = '劍俠風雲雪兒葉華靈學裝服羅麗亞夢龍國師門宮緋紅綠銀白髮';
  const simplified  = '剑侠风云雪儿叶华灵学装服罗丽亚梦龙国师门宫绯红绿银白发';
  return [...value.normalize('NFKC').toLowerCase()].map(c => {
    const index = traditional.indexOf(c); return index < 0 ? c : simplified[index];
  }).join('').replace(/[\s_\-·・]/g, '');
}
const builtin = (id: string, name: string, setting: VisualSetting[], category: string[], design: string): VisualMaterial => ({
  id, name, settings: setting, categories: category, version: 1, kind: 'outfit', aliases: [name], work: '', variant: '默认', appearance: {},
  garments: [{ id: 'outer', design, state: { location: 'on_body', fastening: 'closed', leftSleeve: 'on_arm', rightSleeve: 'on_arm' } }],
  style: '', tags: design, previewPath: '', source: '内置程序设计（非网络图库，无预览）', verified: false, createdAt: 0, updatedAt: 0,
});
export const BUILTIN_VISUAL_MATERIALS = [
  builtin('builtin_xianxia_robe', '仙侠剑修交领长袍', ['xianxia', 'historical'], ['仙侠', '剑修', '汉服', '长袍'], 'hanfu, cross collar, wide sleeves, long robe, sash'),
  builtin('builtin_xianxia_layered', '仙侠分层窄袖衣裙', ['xianxia', 'historical'], ['仙侠', '剑修', '汉服', '裙'], 'hanfu, layered skirt, fitted sleeves, embroidered trim'),
  builtin('builtin_modern_uniform', 'JK 校服', ['modern'], ['JK', '制服', '校服'], 'school uniform, pleated skirt, sailor collar'),
  builtin('builtin_modern_retro_suit', '80年代复古西装', ['modern_retro'], ['复古', '80年代', '西装'], '1980s style, power suit, shoulder pads, retro aesthetic, oversized blazer'),
  builtin('builtin_western_fantasy_armor', '西幻皮革轻甲', ['western_fantasy'], ['西幻', '冒险', '轻甲'], 'leather armor, fantasy adventurer, tunic, cloak, adventurer attire'),
  builtin('builtin_scifi_suit', '科幻旅行服', ['scifi'], ['科幻', '旅行服'], 'science fiction outfit, utility jacket, trousers'),
];

export interface MaterialSearch { kind?: VisualMaterial['kind']; setting?: VisualSetting; work?: string; query?: string }
export function materialExclusions(materials: VisualMaterial[], search: MaterialSearch): Array<{ name: string; reason: string }> {
  return materials.flatMap(m => {
    const reasons = [search.kind && m.kind !== search.kind ? '素材类型不匹配' : '',
      search.setting && search.setting !== 'auto' && !m.settings.includes(search.setting) ? `世界不匹配（需要 ${search.setting}）` : '',
      search.work !== undefined && m.work !== search.work ? '作品不匹配' : ''].filter(Boolean);
    return reasons.length ? [{ name: `${m.name}@v${m.version}`, reason: reasons.join('；') }] : [];
  });
}
export function searchMaterials(materials: VisualMaterial[], search: MaterialSearch): Array<{ material: VisualMaterial; score: number; reason: string }> {
  const query = normalizeVisualName(search.query ?? '');
  const words = (search.query ?? '').split(/[\s,，]+/).map(normalizeVisualName).filter(Boolean);
  return materials.filter(m => (!search.kind || m.kind === search.kind)
    && (!search.setting || search.setting === 'auto' || m.settings.includes(search.setting))
    && (search.work === undefined || m.work === search.work)).map(material => {
    const names = [material.name, ...material.aliases].map(normalizeVisualName);
    const hay = normalizeVisualName([material.name, ...material.aliases, ...material.categories, material.work, material.variant, material.tags].join(' '));
    const exact = query && names.includes(query);
    const categoryHits = material.categories.map(normalizeVisualName).filter(c => c && query.includes(c)).length;
    const score = exact ? 100 : !query ? 1 : hay.includes(query) ? 50 : (words.filter(w => hay.includes(w)).length + categoryHits) * 10;
    return { material, score, reason: `${exact ? '名称/别名精确命中' : query ? '类别/标签匹配' : '世界/类型过滤通过'}；${material.previewPath ? '已有真实预览' : '无预览图片'}；${material.verified ? '用户确认标签' : '标签未验证'}` };
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.material.id.localeCompare(b.material.id));
}
export function rollMaterial(materials: VisualMaterial[], search: MaterialSearch, materialSeed: number): VisualMaterial | undefined {
  const candidates = searchMaterials(materials, search);
  if (!candidates.length) return undefined;
  // Exact aliases require explicit work selection if ambiguous. Never silently pick another fandom.
  if (search.kind === 'character' && new Set(candidates.filter(c => c.score === 100).map(c => c.material.work)).size > 1 && search.work === undefined) return undefined;
  const top = candidates.filter(c => c.score === candidates[0].score);
  return cloneVisual(top[Math.abs(Math.floor(materialSeed)) % top.length].material);
}
export function createBinding(material: VisualMaterial, scope: VisualScope, floor: number, line: number, materialSeed = 0, reason = '用户主动应用'): VisualBinding {
  return { materialId: material.id, version: material.version, scope, materialSeed, effectivePosition: { floor, line }, resolved: cloneVisual(material), reason };
}
export function applyVisualBinding(character: SceneCharacter, binding: VisualBinding, mode: 'preserve' | 'change'): void {
  const material = binding.resolved;
  if ((binding.scope === 'appearance' || binding.scope === 'all') && Object.keys(material.appearance).length) {
    character.baseAppearance = { ...material.appearance };
    character.currentAppearance = {};
  }
  if ((binding.scope === 'outfit' || binding.scope === 'all') && material.garments.length) {
    const previous = character.outfit;
    const garments = cloneVisual(material.garments).map(g => ({ ...g, state: mode === 'preserve' && previous
      ? { ...(previous.garments.find(old => old.id === g.id)?.state ?? { location: 'unknown' }) } : { ...g.state } }));
    character.outfit = { outfitInstanceId: `outfit_${stateHash(JSON.stringify([character.characterId, binding, mode]))}`, design: garments.map(g => g.design).join(', '),
      garments, provenance: binding.reason };
  }
  const scopes: Array<'appearance' | 'outfit' | 'style'> = ['appearance', 'outfit', 'style'];
  const expanded = (b: VisualBinding) => b.scope === 'all' ? scopes.map(scope => ({ ...cloneVisual(b), scope })) : [cloneVisual(b)];
  const selectedScopes = binding.scope === 'all' ? scopes : [binding.scope];
  character.visualBindings = [...(character.visualBindings ?? []).flatMap(expanded).filter(b => !selectedScopes.includes(b.scope as 'appearance' | 'outfit' | 'style')), ...expanded(binding)];
}
export function fillWorldDefaults(state: SceneState, world: WorldVisualProfile, materials: VisualMaterial[], floor: number, line = 0): void {
  for (const character of state.characters) {
    // Only an unambiguous name/alias match may establish automatic fandom identity.
    // Visual resemblance alone must never replace an existing character's face.
    if (!character.visualBindings?.some(b => b.scope === 'appearance' || b.scope === 'all') && !character.baseAppearance.fandom) {
      const matches = materials.filter(m => m.kind === 'character' && (!character.work || m.work === character.work)
        && [m.name, ...m.aliases].some(name => [character.name, ...character.aliases].some(alias => normalizeVisualName(name) === normalizeVisualName(alias))));
      if (matches.length === 1) {
        const binding = createBinding(matches[0], 'appearance', floor, line, 0, '人物姓名/别名唯一命中原素材库，保留已确认外貌字段');
        binding.resolved.appearance = { ...binding.resolved.appearance, ...character.baseAppearance };
        applyVisualBinding(character, binding, 'preserve');
      } else if (matches.length > 1) state.warnings.push(`${character.name}: 同人素材存在多个作品/造型，请在素材库选择后绑定`);
    }
    if (world.characterStylingDefaults && !character.baseAppearance.extra) character.baseAppearance.extra = world.characterStylingDefaults;
    if (character.outfit || world.setting === 'auto') continue;
    const seed = parseInt(stateHash(character.characterId).slice(0, 7), 16);
    const chosen = materials.find(m => m.id === world.wardrobeDefaults && m.kind === 'outfit' && m.settings.includes(world.setting))
      ?? rollMaterial(materials, { kind: 'outfit', setting: world.setting }, seed);
    if (!chosen) { state.warnings.push(`${character.name}: 没有符合 ${world.setting} 的服装素材，保持未知`); continue; }
    applyVisualBinding(character, createBinding(chosen, 'outfit', floor, line, seed, `世界观视觉补全：${world.setting}，非剧情事实`), 'change');
  }
}
