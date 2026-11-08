import { getContext } from '@/st/context';
import { transcriptRevision, type SceneDelta } from '@/state/sceneState';
import type { NaiVibe } from '@/state/settings';

/** Freeze the same persisted frame and references for every generation route. */
export function generationSceneSnapshot(floor: number, swipe: number, seq: number, tag: string) {
  const ctx = getContext();
  const envelope = ctx?.chat[floor]?.extra?.bbiCharChanges as { swipe?: number; scene?: SceneDelta } | undefined;
  const scene = envelope?.scene;
  const frame = scene?.frames?.[seq];
  const matches = envelope?.swipe === swipe && frame?.tag === tag;
  const stateSourceValid = !scene || scene.revision === transcriptRevision(ctx?.chat ?? [], floor);
  const referenceVibes: NaiVibe[] = matches && frame ? JSON.parse(JSON.stringify(frame.characters.flatMap(c =>
    (c.visualBindings ?? []).filter(b => b.scope === 'appearance' || b.scope === 'all')
      .flatMap(b => b.resolved.vibe ? [b.resolved.vibe] : [])))) : [];
  const trace = matches && frame ? JSON.parse(JSON.stringify({
    chatId: ctx?.getCurrentChatId?.(), floor, swipe, seq, revision: scene?.revision,
    stateSourceValid, frame, events: scene?.events, rejected: scene?.rejected,
  })) : { note: '本提示词没有匹配的状态快照，按已保存提示词出图' };
  return { referenceVibes, trace, stateSourceValid };
}
