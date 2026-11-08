import { getContext } from '@/st/context';
import { transcriptRevision, type SceneDelta } from '@/state/sceneState';
import type { NaiVibe } from '@/state/settings';
import { parseImageTagContent } from '@/st/imageTagRegex';

/** Freeze the same persisted frame and references for every generation route. */
export function generationSceneSnapshot(floor: number, swipe: number, seq: number, tag: string) {
  const ctx = getContext();
  const envelope = ctx?.chat[floor]?.extra?.bbiCharChanges as { swipe?: number; scene?: SceneDelta } | undefined;
  const scene = envelope?.scene;
  const frame = scene?.frames?.[seq];
  const matches = envelope?.swipe === swipe && frame?.tag === tag;
  const stateSourceValid = !scene || scene.revision === transcriptRevision(ctx?.chat ?? [], floor);
  // Repair only the known automatic prefix from old, exactly matching snapshots.
  // Keep persisted tags/history and all manually supplied styles intact.
  let prompt: string | undefined;
  const automaticStyle = matches && scene?.world?.provenance !== 'user' ? scene?.world?.visualStyle : '';
  if (automaticStyle) {
    const prefix = [...new Set(automaticStyle.split(',').map(t => t.trim()).filter(t => t &&
      !/\b(?:hair|eyes|skin|breasts|fandom|bangs|ponytail|braid|bob cut|ahoge|face|eyebrows|hanfu|kimono|robe|dress|shirt|skirt|coat|jacket|uniform|sleeves?|clothes|clothing|outfit|ribbon|belt|boots|shoes|sneakers|jeans|stockings|panties|bra|pants|trousers|necktie|collar|trim|corset|gloves|hat)\b/i.test(t)
      && !/^\d+(?:girl|boy)s?$|^(?:male|female|man|woman)$/i.test(t)))];
    const parts = parseImageTagContent(tag).tag.split(',').map(t => t.trim()).filter(Boolean);
    if (prefix.length && prefix.every((t, i) => parts[i]?.toLowerCase() === t.toLowerCase())) prompt = parts.slice(prefix.length).join(', ') || 'scenery';
  }
  const referenceVibes: NaiVibe[] = matches && frame ? JSON.parse(JSON.stringify(frame.characters.flatMap(c =>
    (c.visualBindings ?? []).filter(b => b.scope === 'appearance' || b.scope === 'all')
      .flatMap(b => b.resolved.vibe ? [b.resolved.vibe] : [])))) : [];
  const trace = matches && frame ? JSON.parse(JSON.stringify({
    chatId: ctx?.getCurrentChatId?.(), floor, swipe, seq, revision: scene?.revision,
    stateSourceValid, frame, events: scene?.events, rejected: scene?.rejected,
    removedAutomaticStyle: prompt === undefined ? undefined : automaticStyle,
  })) : { note: '本提示词没有匹配的状态快照，按已保存提示词出图' };
  return { referenceVibes, trace, stateSourceValid, prompt };
}
