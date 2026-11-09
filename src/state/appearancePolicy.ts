import { getContext } from '@/st/context';
import type { CharTagEntry, CharTagField } from './charTags';
export type AppearanceMode = 'story' | 'manual' | 'fandom';
export interface AppearancePolicy {
  mode: AppearanceMode;
  fields: Partial<Record<CharTagField, string>>;
}
const KEY = 'bbiAppearancePolicies';
export function appearancePolicy(name: string): AppearancePolicy | undefined {
  const box = getContext()?.chatMetadata?.[KEY] as Record<string, AppearancePolicy> | undefined;
  return box && Object.hasOwn(box, name) ? box[name] : undefined;
}
export function setAppearancePolicy(name: string, policy: AppearancePolicy) {
  const ctx = getContext();
  if (!ctx) throw new Error('请打开聊天');
  ctx.chatMetadata[KEY] = { ...((ctx.chatMetadata[KEY] as object) ?? {}), [name]: policy };
  ctx.saveMetadataDebounced();
}
export function appearancePolicyRevision() {
  return JSON.stringify(getContext()?.chatMetadata?.[KEY] ?? {});
}
export function blocksAppearanceChange(name: string, field: string) {
  const p = appearancePolicy(name);
  return (
    p?.mode === 'fandom' ||
    (p?.mode === 'manual' &&
      (Object.hasOwn(p.fields, field) || (['nl', 'raw'].includes(field) && Object.keys(p.fields).length > 0)))
  );
}
export function applyAppearancePolicies(entries: CharTagEntry[]): CharTagEntry[] {
  return entries.map((e) => {
    const p = appearancePolicy(e.name);
    if (!p || p.mode === 'story') return e;
    return { ...e, source: 'manual', fields: { ...e.fields, ...p.fields } };
  });
}
export function renderAppearanceOverrides(entries: CharTagEntry[]): CharTagEntry[] {
  return entries
    .filter((e) => {
      const p = appearancePolicy(e.name);
      return (p?.mode === 'manual' && Object.keys(p.fields).length > 0) || p?.mode === 'fandom';
    })
    .map((e) => {
      const p = appearancePolicy(e.name)!;
      if (p.mode === 'fandom') return { ...e, source: 'manual', fields: { ...e.fields, ...p.fields } };
      const fields = Object.fromEntries(
        Object.keys(e.fields).map((f) => [f, p.fields[f as CharTagField] ?? '']),
      ) as CharTagEntry['fields'];
      return { ...e, source: 'manual', fields, raw: '', nl: '' };
    });
}
export function appearancePolicyBlock() {
  return (
    '【用户绘图外貌覆盖：高于剧情外貌，不改小说原文】' +
    JSON.stringify(getContext()?.chatMetadata?.[KEY] ?? {}) +
    '。manual 中列出的字段必须原样复用，不能以剧情变化改写；未列出的字段按剧情。fandom 为用户完整替换形象，不接受任何 AI 档案变更，可列出用户指定覆盖字段；story 恢复剧情模式。服装不属于本区块。'
  );
}
