import { getContext } from '@/st/context';

export interface CapabilityOverride { characters: 'auto' | 'off'; vibes: 'auto' | 'off'; maxPromptChars: number }
const KEY = 'bbi_nai_capabilities_v1';
export function capabilityOverride(endpointId: string): CapabilityOverride {
  const all = getContext()?.extensionSettings?.[KEY] as Record<string, Partial<CapabilityOverride>> | undefined;
  const raw = all?.[endpointId];
  return { characters: raw?.characters === 'off' ? 'off' : 'auto', vibes: raw?.vibes === 'off' ? 'off' : 'auto',
    maxPromptChars: typeof raw?.maxPromptChars === 'number' && Number.isFinite(raw.maxPromptChars) ? Math.max(0, Math.floor(raw.maxPromptChars)) : 0 };
}
export function saveCapabilityOverride(endpointId: string, value: CapabilityOverride): void {
  const ctx = getContext(); if (!ctx?.extensionSettings) throw new Error('酒馆未就绪');
  ctx.extensionSettings[KEY] = { ...(ctx.extensionSettings[KEY] as object ?? {}), [endpointId]: { ...value } };
  ctx.saveSettingsDebounced?.();
}
export function resolveNaiCapabilities(model: string, override: CapabilityOverride) {
  return { characters: /nai-diffusion-(?:4-5|5)-(?:full|curated)/.test(model) && override.characters !== 'off',
    vibes: /nai-diffusion-(?:3|4|4-5|5)/.test(model) && override.vibes !== 'off',
    referenceMode: 'shared-vibe-only' as const, maxPromptChars: override.maxPromptChars,
    source: '模型协议 + 接入点用户覆盖；代理能力未自动验证' };
}
/** Character features are first in compiler output; discard scene surplus before any character tail. */
export function fitCaptionBudget(base: string, characters: string[], limit: number): { base: string; characters: string[]; removed: string[] } {
  const result = { base, characters: [...characters], removed: [] as string[] };
  if (!limit || base.length + characters.reduce((n, s) => n + s.length, 0) <= limit) return result;
  if (limit < characters.length * 80 + 20) throw new Error('提示预算不足以保留每个人物的身份特征，请增加字符预算');
  const trim = (caption: string, max: number): string => {
    if (caption.length <= max) return caption;
    const parts = caption.split(',').map(t => t.trim());
    while (parts.length > 1 && parts.join(', ').length > max) result.removed.push(parts.pop()!);
    const text = parts.join(', ');
    if (text.length > max) { result.removed.push(text.slice(max)); return text.slice(0, max); }
    return text;
  };
  const charTotal = characters.reduce((n, s) => n + s.length, 0);
  if (charTotal + 20 > limit) throw new Error('提示预算不足以保留完整人物特征与衣物状态，请增加预算；未发送截断的人物提示');
  result.base = trim(base, Math.max(20, limit - charTotal));
  const remaining = limit - result.base.length;
  if (charTotal > remaining) throw new Error('人物提示预算不足，未发送请求');
  return result;
}
