import type { CharTagEntry } from '@/state/charTags';
import { acceptClothingChanges, clothingAt, parseClothingChanges, type ClothingState } from './outfitTimeline';
import { prepareTargetText } from './clean';

/** Restore only explicitly described preceding context; no fabricated transition in target floor. */
export function restoreWardrobeInitial(raw: unknown, preceding: string, before: ClothingState, entries: CharTagEntry[]): string[] {
  if (!Array.isArray(raw) || !preceding.trim()) return [];
  const segments = prepareTargetText(preceding, []).segments;
  if (!segments.length) return [];
  const events = parseClothingChanges(raw.map(item => ({ ...item, operation: 'init', position: segments[segments.length - 1].id, timeline: 'main' })), segments, preceding)
    .filter(e => e.evidence && !e.invalidReason && !e.parseNote && !before.get(e.name)?.manual && !before.get(e.name)?.suitMode);
  const checked = acceptClothingChanges(events, preceding, new Map(), entries);
  const recovered = clothingAt(new Map(), checked.changes, 'context-recovery');
  const notes: string[] = [];
  for (const [name, record] of recovered) {
    if (before.get(name)?.manual || before.get(name)?.suitMode) continue;
    record.source = '前文有限恢复（未经逐楼分析）：' + record.source;
    before.set(name, record);
    notes.push(name + '：依据最近前文恢复初始衣着，未追溯整本小说。');
  }
  return notes;
}
