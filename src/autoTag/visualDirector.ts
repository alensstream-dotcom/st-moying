import { requestCompletion, requestViaMainApi, type ChatMsg } from '@/api/client';
import { getTagGenChannel } from '@/state/settings';
import { normalizeMaterial } from '@/state/visualLibrary';
import { applyVisualBinding, cloneVisual, createBinding, searchMaterials } from '@/state/visualDesign';
import type { SceneState } from '@/state/sceneState';
import type { VisualMaterial, WorldVisualProfile } from '@/state/visualTypes';

export interface VisualDecision { characterId: string; appearance?: Record<string, string>; appearanceMaterial?: string; outfitMaterial?: string; garments?: VisualMaterial['garments']; reason: string }
export interface VisualDirection { world: WorldVisualProfile; decisions: VisualDecision[] }

/** One automatic LLM design pass only when a subject lacks a durable design.
 * It cannot change identity facts or an existing outfit; results become timeline snapshots. */
export async function directVisuals(scene: SceneState, world: WorldVisualProfile, materials: VisualMaterial[], source: string,
  staticContext: string, signal: AbortSignal): Promise<VisualDirection> {
  if (!scene.characters.length) return { world, decisions: [] };
  const missing = scene.characters.filter(c => c.identity.gender !== 'male' &&
    ((!c.provenance.includes('visual_director') && c.provenance !== 'manual' && c.provenance !== 'manual_visual_design') || !c.baseAppearance.hair || !c.baseAppearance.eyes || !c.outfit));
  if (!missing.length && world.setting !== 'auto') return { world, decisions: [] };
  const recalled = searchMaterials(materials, { query: source + ' ' + missing.flatMap(c => Object.values(c.baseAppearance)).join(' ') }).slice(0, 55).map(m => m.material);
  const pool = [...new Map([...recalled, ...materials.filter(m => m.id.startsWith('builtin_'))].map(m => [m.id, m])).values()];
  const messages: ChatMsg[] = [{ role: 'system', content: `你是自动视觉导演，只返回 JSON，不生成图片、不改变身份/性别/衣物状态。
返回 {world:{setting,characterStylingDefaults},decisions:[{characterId,appearance:{hair,eyes,skin,body,extra},appearanceMaterial,outfitMaterial,garments:[{id,design}],reason}]}。
setting 只能为 auto/xianxia/historical/modern/modern_retro/scifi/western_fantasy。根据角色卡、世界书、正文自动判断；仙侠/古风默认古装发饰，但每个人眉眼、脸型、发型轮廓、特征须有区别。现代细分复古。明确的穿越者例外保留。
只补缺失定妆、首次未知服装或把旧的整串服装拆成部件。英文 tag 写字段，reason 用中文。严禁重写已知颜色/形象、性别或当前穿脱状态，不根据 1girl 判断性别。男性不设计女主定妆。
优先从提供的素材候选中选择 ID，原创角色可选相似同人作为外貌灵感，但必须符合明确发色/瞳色/时代，不可把同人身份姓名或服装带给原创人物；没有合适素材则补全简洁独立设计。禁止强行选不合时代的服装。
服装 garments 只写衣物部件和设计，不含身体/脸/性别/姿势/穿脱状态。已存在服装时，仅拆解原设计，不能补回已移除衣物。已经有部件的穿搭无需返回服装。未知时首次补全款式，后续由程序继承。
定妆要参考其他人物已固定外貌，避免所有女性同一组脸型和发型；extra 最多写 3 个可辨识外形特征，不写画风/画师/渲染/质量/审美词。整体画风、审美与质量完全由用户 NAI 配方决定，禁止另设画风。不要把场景动作混进定妆。没有依据不编造身份事实。` },
  { role: 'user', content: JSON.stringify({ world, current: scene.characters, missing: missing.map(c => c.characterId), staticContext: staticContext.slice(0, 22000), story: source.slice(0, 20000), materials: pool.map(m => ({ id: m.id, kind: m.kind, name: m.name, aliases: m.aliases, work: m.work, settings: m.settings, appearance: m.appearance, garments: m.garments, tags: m.tags })) }) }];
  const channel = getTagGenChannel();
  const raw = channel ? await requestCompletion(channel, messages, { signal, source: '自动定妆 / 世界识别 / 素材绑定' })
    : await requestViaMainApi(messages, { signal, source: '自动定妆 / 世界识别 / 素材绑定' });
  const clean = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/g, '').trim();
  const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
  const result: VisualDirection = { world: cloneVisual(world), decisions: [] };
  if (world.setting === 'auto' && ['xianxia','historical','modern','modern_retro','scifi','western_fantasy'].includes(parsed.world?.setting)) {
    result.world = { ...world, setting: parsed.world.setting, visualStyle: '',
      characterStylingDefaults: typeof parsed.world.characterStylingDefaults === 'string' ? parsed.world.characterStylingDefaults.slice(0, 300) : '', provenance: 'LLM 自动识别角色卡/世界书' };
  }
  for (const item of Array.isArray(parsed.decisions) ? parsed.decisions.slice(0, 30) : []) {
    const character = missing.find(c => c.characterId === item.characterId); if (!character) continue;
    const material = normalizeMaterial({ name: character.name, kind: 'character', appearance: item.appearance, garments: item.garments });
    if (!material) continue;
    result.decisions.push({ characterId: character.characterId, appearance: material.appearance, garments: material.garments,
      appearanceMaterial: pool.some(m => m.id === item.appearanceMaterial && m.kind === 'character') ? item.appearanceMaterial : undefined,
      outfitMaterial: pool.some(m => m.id === item.outfitMaterial && m.kind === 'outfit') ? item.outfitMaterial : undefined,
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 600) : 'LLM 自动补全视觉设计，非剧情事实' });
  }
  return result;
}

export function fillDirectedVisuals(state: SceneState, direction: VisualDirection, materials: VisualMaterial[], floor: number, line: number): void {
  for (const decision of direction.decisions) {
    const c = state.characters.find(c => c.characterId === decision.characterId); if (!c || c.identity.gender === 'male') continue;
    for (const [key, value] of Object.entries(decision.appearance ?? {})) if (!c.baseAppearance[key]
      || key === 'extra' && !c.provenance.includes('visual_director') && c.provenance !== 'manual' && c.provenance !== 'manual_visual_design') c.baseAppearance[key] = value;
    const template = materials.find(m => m.id === decision.appearanceMaterial);
    if (template && !c.visualBindings?.some(b => b.scope === 'appearance' || b.scope === 'all')) {
      const resolved = cloneVisual(template);
      // Similar fandom is inspiration, not an assertion that the story person IS that fandom.
      resolved.appearance = { ...resolved.appearance, ...c.baseAppearance }; delete resolved.appearance.fandom;
      if (c.baseAppearance.fandom) resolved.appearance.fandom = c.baseAppearance.fandom;
      applyVisualBinding(c, createBinding(resolved, 'appearance', floor, line, 0, decision.reason), 'preserve');
    }
    if (!c.outfit) {
      const outfit = materials.find(m => m.id === decision.outfitMaterial);
      const compatible = outfit && (direction.world.setting === 'auto' || outfit.settings.includes(direction.world.setting));
      const generated = normalizeMaterial({ name: `${c.name}首次穿搭`, kind: 'outfit', garments: decision.garments, source: '自动视觉设计' });
      const selected = compatible ? outfit : generated?.garments.length ? generated : undefined;
      if (selected) applyVisualBinding(c, createBinding(selected, 'outfit', floor, line, 0, decision.reason), 'change');
    } else if (!c.outfit.garments.length && decision.garments?.length) {
      // Legacy state is unknown: never turn a model's default closed clothing into a fact.
      c.outfit.garments = cloneVisual(decision.garments).map(g => ({ ...g, state: { location: 'unknown', fastening: 'unknown' } }));
    }
    if (!c.provenance.includes('visual_director')) c.provenance += '|visual_director';
  }
}
