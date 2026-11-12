/**
 * 着装锁定的注入层。
 *
 * SillyTavern 的 setExtensionPrompt 是全局函数，但不同版本（含 TauriTavern
 * 这类封装）挂在 window 上还是挂在 context 上并不一致，这里两边都试一次。
 * 注入位置用 IN_CHAT + depth=0：贴着最新一条消息，写正文时最容易照抄，
 * 也不会污染角色卡或世界书。
 */

import { getContext } from './context';
import { charTagLib } from '../state/charTags';
import { wardrobeLockText } from '../autoTag/wardrobeLockText';

const LOCK_KEY = 'moying_wardrobe_lock';
/** extension_prompt_types.IN_CHAT */
const POSITION_IN_CHAT = 1;
/** extension_prompt_roles.SYSTEM */
const ROLE_SYSTEM = 0;

type SetPromptFn = (
  key: string,
  value: string,
  position: number,
  depth: number,
  role: number,
  scan?: boolean,
) => void;

function setter(): SetPromptFn | null {
  if (typeof window !== 'undefined') {
    const fn = (window as unknown as { setExtensionPrompt?: SetPromptFn }).setExtensionPrompt;
    if (typeof fn === 'function') return fn.bind(window);
  }
  const ctx = getContext() as unknown as { setExtensionPrompt?: SetPromptFn };
  if (typeof ctx?.setExtensionPrompt === 'function') return ctx.setExtensionPrompt.bind(ctx);
  return null;
}

/** 写入（或清空）着装锁定注入。text 为空即清空。 */
export function pushWardrobeLock(text: string): void {
  const set = setter();
  if (!set) return;
  try {
    set(LOCK_KEY, text || '', POSITION_IN_CHAT, 0, ROLE_SYSTEM);
  } catch (error) {
    console.warn('[墨影] 着装锁定注入失败', error);
  }
}

/** 按当前聊天与账本重算并注入。写正文前与切聊天时调用。 */
export function refreshWardrobeLock(): void {
  try {
    const chat = getContext()?.chat ?? [];
    pushWardrobeLock(wardrobeLockText(chat, charTagLib.entries));
  } catch (error) {
    console.warn('[墨影] 着装锁定刷新失败', error);
  }
}
