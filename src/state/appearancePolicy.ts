import { getContext } from '@/st/context';
import type { CharTagEntry, CharTagField } from './charTags';
export type AppearanceMode = 'story' | 'manual' | 'fandom';
export interface AppearancePolicy {
  backup?: Pick<CharTagEntry, 'fields' | 'raw' | 'nl' | 'desc'>;
  mode: AppearanceMode;
  fields: Partial<Record<CharTagField, string>>;
}
const KEY = 'bbiAppearancePolicies';
export function appearancePolicy(name: string): AppearancePolicy | undefined {
  const box = getContext()?.chatMetadata?.[KEY] as Record<string, AppearancePolicy> | undefined;
  return box && Object.hasOwn(box, name) ? box[name] : undefined;
}
export function setAppearancePolicy(name: string, policy: AppearancePolicy, original?: CharTagEntry) {
  const ctx = getContext();
  if (!ctx) throw new Error('请打开聊天');
  const previous = appearancePolicy(name);
  const backup =
    (previous?.mode === 'fandom' ? previous.backup : undefined) ||
    policy.backup ||
    (policy.mode === 'fandom' && original
      ? JSON.parse(
          JSON.stringify({
            fields: { ...original.fields, fandom: '' },
            raw: original.raw,
            nl: original.nl,
            desc: original.desc,
          }),
        )
      : undefined);
  policy = { ...policy, ...(backup ? { backup } : {}) };
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
/** Only the trigger and explicitly chosen corrections can define a fandom face. */
export function fandomOnly(entry: CharTagEntry, overrides: AppearancePolicy['fields'] = {}): CharTagEntry {
  const fields = Object.fromEntries(
    Object.keys(entry.fields).map((k) => [k, k === 'outfit' ? entry.fields.outfit : '']),
  ) as CharTagEntry['fields'];
  fields.fandom = entry.fields.fandom;
  Object.assign(fields, overrides);
  return { ...entry, source: 'manual', fields, raw: '', nl: '', desc: '' };
}
export function applyAppearancePolicies(entries: CharTagEntry[]): CharTagEntry[] {
  return entries.map((e) => {
    const p = appearancePolicy(e.name);
    if (!p) return e.source === 'manual' && e.fields.fandom ? fandomOnly(e) : e;
    if (p.mode === 'story') return e;
    if (p.mode === 'fandom') {
      if (!p.backup) setAppearancePolicy(e.name, p, e);
      return fandomOnly(e, p.fields);
    }
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
      if (p.mode === 'fandom') return fandomOnly(e, p.fields);
      const fields = Object.fromEntries(
        Object.keys(e.fields).map((f) => [f, p.fields[f as CharTagField] ?? '']),
      ) as CharTagEntry['fields'];
      return { ...e, source: 'manual', fields, raw: '', nl: '' };
    });
}
export function appearancePolicyBlock() {
  return (
    '【用户绘图外貌覆盖：高于剧情外貌，不改小说原文】' +
    JSON.stringify(
      Object.fromEntries(
        Object.entries((getContext()?.chatMetadata?.[KEY] ?? {}) as Record<string, AppearancePolicy>).map(
          ([name, p]) => [name, { mode: p.mode, fields: p.fields }],
        ),
      ),
    ) +
    '。manual 中列出的字段必须原样复用，不能以剧情变化改写；未列出的字段按剧情。fandom 为完整替换形象：只使用 fields.fandom 和用户显式修正词，忽略原剧情中的发型、瞳色、脸型、年龄外观和体型。禁止为该人物补录或更新固定外貌（包括 raw、nl），但继续报告服装账本、动作、表情和临时湿发/伤势，可列出用户指定覆盖字段；story 恢复剧情模式。服装不属于本区块。'
  );
}
