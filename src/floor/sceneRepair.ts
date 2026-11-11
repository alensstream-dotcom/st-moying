import { prepareTargetText } from '@/autoTag/clean';
import { repairClothingEvents } from '@/autoTag/clothingRepair';
import { compileScene } from '@/autoTag/compileScene';
import { clothingAt, clothingRevision, findClothingFrame, readClothingFloor } from '@/autoTag/outfitTimeline';
import { BBI_OUTFIT_EXTRA_KEY } from '@/autoTag/outfitState';
import { autoTagProfile } from '@/autoTag/prompt';
import { charTagsBeforeFloor } from '@/state/charTags';
import { settings } from '@/state/settings';
import { getContext } from '@/st/context';
import { applyMessageText } from '@/st/messageEdit';
import { parseImageTagContent, parseImageTags, replaceImageTagAt, serializeImageTag, stripImageTags } from '@/st/imageTagRegex';

/** Explicit one-frame repair: never rewrites other frames or a later story state. */
export async function repairSceneClothing(floor: number, seq: number, signal: AbortSignal): Promise<void> {
  const ctx = getContext(), message = ctx?.chat[floor], chatId = ctx?.getCurrentChatId?.();
  if (!ctx || !message || !chatId) throw new Error('请先打开对应聊天');
  const raw = parseImageTags(message.mes)[seq];
  const saved = readClothingFloor(message, clothingRevision(ctx.chat, floor));
  const frame = raw && findClothingFrame(saved, raw);
  if (!saved || !frame) throw new Error('本图没有有效状态快照，请先重新分析本楼以建立账本');
  const expected = JSON.stringify(message.extra?.[BBI_OUTFIT_EXTRA_KEY]);
  const source = stripImageTags(message.mes), prepared = prepareTargetText(source, settings.excludes.customStripTags);
  const before = new Map(saved.start.map(e => [e.name, e]));
  const profiles = frame.appearance?.length ? frame.appearance : charTagsBeforeFloor(floor + 1);
  const events = saved.changes.filter(c => c.sourceLine < frame.sourceLine || (c.sourceLine === frame.sourceLine && c.charOffset <= frame.charOffset));
  const segments = prepared.segments.filter(s => s.sourceLine < frame.sourceLine || (s.sourceLine === frame.sourceLine && (s.charOffset ?? 0) <= frame.charOffset));
  const repaired = await repairClothingEvents(source, segments, before, profiles, events, signal, true);
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const timeline = frame.scene?.timeline || 'main';
  const state = clothingAt(before, repaired.changes, chatId + floor, frame.sourceLine, frame.charOffset, timeline);
  for (const e of frame.entries) if (!state.has(e.name)) state.set(e.name, e);
  const content = parseImageTagContent(raw);
  // Rebuild state from action-only fields; legacy tags are cleaned by the compatibility path.
  const image = { ...content, position: '', sourceLine: frame.sourceLine, charOffset: frame.charOffset };
  const profile = autoTagProfile();
  compileScene(image, profiles, state, profile.nl, profile.naiCharPrompts);
  if (image.scene) image.scene.warnings = [...repaired.rejected, '本图已单独核对衣着；未改写其他图片或后续剧情账本。'];
  frame.entries = [...state.values()].filter(e => image.characters.some(c => c.name === e.name));
  frame.scene = image.scene;
  frame.tag = serializeImageTag(image);
  const result = await applyMessageText(floor, text => {
    if (parseImageTags(text)[seq] !== raw || JSON.stringify(message.extra?.[BBI_OUTFIT_EXTRA_KEY]) !== expected) return null;
    return replaceImageTagAt(text, seq, frame.tag);
  }, chatId, Array.isArray(message.swipes) ? message.swipe_id ?? 0 : null, message, [{ key: BBI_OUTFIT_EXTRA_KEY, value: saved }]);
  if (result !== 'saved') throw new Error('剧情或账本已经变化，修正结果未覆盖新内容');
  toastr.info(repaired.rejected.length ? '仍有待核对项目，请查看本图分镜；尚未重新生图' : '本图衣着已核对并保存；点击“再画一张”使用新状态', '墨影');
}
