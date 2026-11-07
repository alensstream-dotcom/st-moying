import type { STMessage } from '@/st/context';
import { promptHash } from '@/floor/storage';

/** Only suppress implicit card retries for the exact swipe/tag slots owned by the novel pipeline. */
export function claimNovelSlots(message: STMessage, swipeId: number, tags: string[]): void {
  message.extra = { ...message.extra, bbiNovelOwner: { v: 1, swipeId, hashes: tags.map(promptHash) } };
}

export function isNovelSlot(message: STMessage | undefined, swipeId: number, seq: number, hash: string): boolean {
  const owner = message?.extra?.bbiNovelOwner as { v?: number; swipeId?: number; hashes?: string[] } | undefined;
  return owner?.v === 1 && owner.swipeId === swipeId && owner.hashes?.[seq] === hash;
}
