import { requestCompletion, requestViaMainApi } from '@/api/client';
import { backendStatus, decideSeed, generateImage } from '@/generate';
import { uploadUserImage } from '@/st/images';
import { getContext } from '@/st/context';
import { applyMessageText } from '@/st/messageEdit';
import { parseImageTagContent, parseImageTags, replaceImageTagAt, serializeImageTag } from '@/st/imageTagRegex';
import { getTagGenChannel, settings } from '@/state/settings';
import { makeCharTagFloorDelta, readCharTagFloorDelta, recomputeCharTags } from '@/state/charTags';
import { refreshSceneStore, sceneAt } from '@/state/sceneStore';
import { resolveSceneCharacter, transcriptRevision, type SceneDelta } from '@/state/sceneState';
import { normalizeMaterial, worldProfile } from '@/state/visualLibrary';
import type { VisualMaterial, VisualSetting } from '@/state/visualTypes';
import { cloneVisual } from '@/state/visualDesign';
import { compileSceneImage } from './sceneCompiler';
import { autoTagProfile } from './prompt';
import { loadVibeData, saveVibeFiles, vibeMetaFromData } from '@/backends/vibeStore';
import { randomUuid } from '@/randomUuid';
import type { NaiVibe } from '@/state/settings';

export async function freezeVisualReference(reference: NaiVibe): Promise<NaiVibe> {
  if (reference.id.startsWith('material_ref_')) return cloneVisual(reference);
  const data = await loadVibeData(reference);
  const id = `material_ref_${randomUuid()}`;
  const paths = await saveVibeFiles(cloneVisual(data), null, id);
  return vibeMetaFromData(id, reference.name, paths.dataPath, paths.thumbnailPath, data, reference.strength, true, reference.group);
}

export async function createVisualDesign(query: string, kind: VisualMaterial['kind'], setting: VisualSetting): Promise<VisualMaterial> {
  const messages = [{ role: 'system' as const, content: '仅返回一个 JSON 视觉素材对象：name,kind(character/outfit/style),aliases[],work,variant,settings[],categories[],appearance{hair,eyes,skin,body,extra},garments[{id,design}],style,tags。appearance 不得含性别事实；服装 design 不得含人物脸、发色或身份。无须编造来源、图片地址或声称标签已验证。' },
    { role: 'user' as const, content: `创作新款，类型 ${kind}，世界 ${setting}，要求：${query}` }];
  const channel = getTagGenChannel();
  const raw = channel ? await requestCompletion(channel, messages, { source: '创作视觉素材' }) : await requestViaMainApi(messages, { source: '创作视觉素材' });
  const cleaned = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?|```/gi, '').trim();
  const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
  const material = normalizeMaterial({ ...parsed, id: undefined, kind, settings: [setting], source: 'LLM 视觉设计，非已验证素材数据库', verified: false, previewPath: '' });
  if (!material) throw new Error('模型未返回合法素材结构');
  return material;
}

/** Generate a real preview, preserving the selected design. Collect/apply are separate user actions. */
export async function drawVisualPreview(material: VisualMaterial, imageSeed?: number): Promise<{ material: VisualMaterial; imageSeed: number }> {
  const snapshot = cloneVisual(material);
  const status = backendStatus(); if (!status.configured) throw new Error(status.reason);
  const appearance = Object.values(snapshot.appearance).filter(Boolean).join(', ');
  const clothes = snapshot.garments.map(g => g.design).join(', ');
  const prompt = snapshot.kind === 'outfit' ? `clothing display, mannequin, simple background, ${clothes || snapshot.tags}`
    : snapshot.kind === 'style' ? `landscape, ${snapshot.style || snapshot.tags}` : `portrait, ${appearance || snapshot.tags}, ${snapshot.style}`;
  const seed = decideSeed(settings.defaultBackend, imageSeed);
  const { result } = await generateImage({ prompt, seed, characters: snapshot.kind === 'character' ? [{ name: snapshot.name, tag: appearance || snapshot.tags, nl: '' }] : [] });
  try {
    let base64: string;
    if (result.url.startsWith('data:')) base64 = result.url.split(',')[1];
    else {
      const response = await fetch(result.url); if (!response.ok) throw new Error('读取生成的预览失败');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      base64 = btoa(binary);
    }
    snapshot.previewPath = await uploadUserImage('柏宝绘_视觉素材', `${snapshot.id}-${seed}-${Date.now()}`, base64, result.format);
    return { material: snapshot, imageSeed: seed };
  } finally { result.revoke(); }
}

/** Recompile the existing shots using their own time slices. No LLM, identity inference or material roll. */
export async function recompileFloorVisuals(floor: number): Promise<void> {
  const ctx = getContext(), message = ctx?.chat[floor];
  if (!ctx || !message) throw new Error('请选择已有楼层');
  const chatId = ctx.getCurrentChatId() ?? '', original = message.mes;
  const previous = readCharTagFloorDelta(message), revision = transcriptRevision(ctx.chat, floor);
  if (previous?.scene && previous.scene.revision !== revision) throw new Error('剧情已编辑，请先从该楼重新分析 tag 再应用');
  const tags = parseImageTags(original); if (!tags.length) throw new Error('该楼没有图片提示词，请先生成 tag');
  const profile = autoTagProfile(), world = worldProfile();
  const scene: SceneDelta = { ...(previous?.scene ?? { v: 1, revision, events: [], rejected: [] }), frames: [], world: cloneVisual(world) };
  const rewritten = tags.map((raw, index) => {
    const sourceLine = previous?.scene?.frames?.[index]?.sourceLine ?? 0;
    const content = { ...parseImageTagContent(raw), sourceLine, position: '' };
    const state = sceneAt(floor, sourceLine);
    const warnings = compileSceneImage(content, state, profile.naiCharPrompts, profile.nl, world);
    const tag = serializeImageTag(content);
    scene.frames!.push({ sourceLine, tag, characters: state.characters.filter(c => content.characters.some(p => resolveSceneCharacter(state, p.name, p.work, p.characterId)?.characterId === c.characterId)), warnings });
    return tag;
  });
  const result = await applyMessageText(floor, current => {
    if (current !== original) return null;
    let next: string | null = current;
    for (let i = 0; i < rewritten.length && next !== null; i++) next = replaceImageTagAt(next, i, rewritten[i]);
    return next;
  }, chatId, message.swipes ? message.swipe_id ?? 0 : null, message,
  { key: 'bbiCharChanges', value: makeCharTagFloorDelta(previous?.ops ?? [], message.swipe_id ?? 0, scene, previous?.legacyBackup ?? (!previous?.scene ? message.extra?.bbiCharChanges : undefined)) });
  if (result !== 'saved') throw new Error('消息/聊天已改变，本次没有覆盖提示词');
  recomputeCharTags(); refreshSceneStore();
}
