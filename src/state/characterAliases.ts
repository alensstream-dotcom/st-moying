import { getContext } from '@/st/context';
import { currentIdentityFacts, type IdentityFact } from './characterIdentity';
const KEY = 'moying_character_aliases_v1';
export function characterAliases(name: string, facts: IdentityFact[] = currentIdentityFacts()): string[] {
  const saved = getContext()?.chatMetadata?.[KEY] as Record<string, string[]> | undefined;
  return [
    ...new Set([
      ...(Array.isArray(saved?.[name]) ? saved![name] : []),
      ...facts
        .filter((f) => f.name === name && !f.conflict && f.gender !== 'unknown')
        .flatMap((f) => f.aliases || []),
    ]),
  ];
}
export function saveCharacterAliases(name: string, value: string, names: string[]) {
  const ctx = getContext();
  if (!ctx?.chatMetadata || !name.trim()) throw new Error('请先选择已保存的角色');
  const aliases = [
    ...new Set(
      value
        .split(/[,，、;；\n]+/)
        .map((x) => x.trim())
        .filter((x) => x && x !== name),
    ),
  ];
  if (
    aliases.length > 40 ||
    aliases.some(
      (a) => a.length > 40 || /[<>]/.test(a) || /^(她|他|它|你|我|本人|对方|这个人|那个人)$/.test(a),
    )
  )
    throw new Error('别名最多40条，每条最多40字；不能使用她、我等代词');
  for (const alias of aliases) {
    if (names.some((n) => n !== name && (n === alias || characterAliases(n).includes(alias))))
      throw new Error(`“${alias}”已指向其他角色，请用更明确的称谓`);
  }
  ctx.chatMetadata[KEY] = { ...((ctx.chatMetadata[KEY] as object) || {}), [name]: aliases };
  ctx.saveMetadataDebounced();
}
