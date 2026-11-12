import { getContext, type STMessage } from '@/st/context';
import { stripImageTags } from '@/st/imageTagRegex';
import type { ClothingState, ClothingRecord, ClothingPiece } from '@/autoTag/outfitTimeline';
import { resolveCanonicalCharName } from '@/autoTag/charReuse';
import type { CharTagEntry } from './charTags';
export type SuitMode = 'style' | 'always';
export interface SuitBinding {
  id: string;
  name: string;
  title: string;
  mode: SuitMode;
  slot?: string;
  pieces: ClothingPiece[];
}
export interface WardrobeChoice {
  id: string;
  name: string;
  swipe: number;
  hash: string;
  suit: SuitBinding | null;
}
const KEY = 'bbiWardrobeChoices';
function storyHash(s: string) {
  let n = 2166136261;
  for (const c of stripImageTags(s).replace(/\s+/g, '')) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return (n >>> 0).toString(36);
}
export function wardrobeChoices(message: STMessage | undefined): WardrobeChoice[] {
  const raw = message?.extra?.[KEY];
  return (Array.isArray(raw) ? raw : []).filter(
    (c) =>
      c &&
      typeof c.name === 'string' &&
      c.swipe === (message?.swipe_id ?? 0) &&
      c.hash === storyHash(message?.mes ?? '') &&
      (!c.suit || Array.isArray(c.suit.pieces)),
  );
}
export function wardrobeChoiceRevision(message: STMessage | undefined) {
  return JSON.stringify(wardrobeChoices(message));
}
export async function chooseWardrobe(floor: number, name: string, suit: SuitBinding | null) {
  const ctx = getContext(),
    message = ctx?.chat[floor];
  if (!ctx || !message) throw new Error('请先选择已存在的剧情楼层');
  const extra = message.extra;
  const choices = wardrobeChoices(message).filter((c) => c.name !== name);
  choices.push({
    id: crypto.randomUUID(),
    name,
    swipe: message.swipe_id ?? 0,
    hash: storyHash(message.mes),
    suit,
  });
  message.extra = { ...(extra ?? {}), [KEY]: choices };
  try {
    await ctx.saveChat();
  } catch (error) {
    message.extra = extra;
    throw error;
  }
}
const SLOT_PATTERNS: Record<string, RegExp> = {
  top: /\b(?:shirt|blouse|jacket|coat|blazer|hoodie|sweater|top|tunic)\b/i,
  bottom: /\b(?:skirt|pants|trousers|shorts|jeans|hakama)\b/i,
  underwear: /\b(?:bra|panties|underpants|lingerie|dudou|undergarment)\b/i,
  hosiery: /sock|hose|thighhigh|tights/i,
  shoes: /shoes|boots|heels|sandals|sneakers|loafers|footwear|mary janes/i,
  accessory: /belt|sash|ribbon|bow|gloves|hat|cap|scarf|accessor|necktie|neckerchief|obi/i,
};
export function mergeSuitWithCurrent(suit: SuitBinding, old?: ClothingRecord): SuitBinding {
  if (!suit.slot || suit.slot === 'full') return suit;
  if (!old) throw new Error('当前没有可继承的整套穿搭，请先在角色页组合完整套装再绑定');
  if (
    ['top', 'bottom'].includes(suit.slot) &&
    old.pieces.some(
      (p) => p.id === 'legacy' || /\b(?:dress|robe|hanfu|kimono|yukata|uniform|suit)\b/i.test(p.design),
    )
  )
    throw new Error('旧衣物包含整套/旧版记录，不能可靠拆成上下装；请到角色页组合完整套装后绑定');
  const pattern = SLOT_PATTERNS[suit.slot];
  if (!pattern) throw new Error('状态素材不能作为固定款式，请选择衣服或整套套装');
  const keep = old.pieces.filter((p) => !pattern.test(p.design));
  return { ...suit, slot: 'full', pieces: [...JSON.parse(JSON.stringify(keep)), ...suit.pieces] };
}
export function applyWardrobeChoices(
  state: ClothingState,
  message: STMessage | undefined,
  alreadyApplied?: string,
  entries: CharTagEntry[] = [],
): void {
  if (alreadyApplied === wardrobeChoiceRevision(message)) return;
  let appliedIds = new Set<string>();
  try {
    appliedIds = new Set((JSON.parse(alreadyApplied ?? '[]') as WardrobeChoice[]).map((c) => c.id));
  } catch {}
  for (const choice of wardrobeChoices(message)) {
    if (appliedIds.has(choice.id)) continue;
    // 账本按档案主名记。在衣柜面板给「晚晴」绑套装的，库里那个人是「林晚晴」，
    // 不归一就会写出一条同名副账，绑定对它本人的图完全不生效。
    const name = entries.length ? resolveCanonicalCharName(choice.name, entries) : choice.name;
    if (!choice.suit) {
      const old = state.get(name) ?? state.get(choice.name);
      if (old) {
        delete old.suitMode;
        delete old.boundSuitId;
        old.manual = false;
      }
      continue;
    }
    const suit = choice.suit;
    state.set(name, {
      name,
      outfitId: suit.id,
      boundSuitId: suit.id,
      suitMode: suit.mode,
      manual: true,
      source: '用户指定套装：' + suit.title,
      pieces: JSON.parse(JSON.stringify(suit.pieces)),
    });
  }
}
export function bindingFromTags(
  name: string,
  title: string,
  tags: string,
  mode: SuitMode,
  slot = 'full',
): SuitBinding {
  if (!tags.trim()) throw new Error('套装标签不能为空');
  // Local slot classification preserves coherent garment tokens without asking an LLM.
  const groups = new Map<string, string[]>();
  const qualifiers: string[] = [];
  let garment = slot;
  for (const token of tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)) {
    if (
      /\b(?:standing|walking|full body|upper body|cowboy shot|close.up|portrait|looking|from above|from below|from behind|from side|depth of field|backlighting|rim lighting|nude|naked|topless|bottomless|solo|skirt lifted|clothes down|open clothes|wet clothes|torn clothes)\b/i.test(
        token,
      )
    )
      continue;
    if (
      /^(?:school uniform|serafuku|chinese clothes|japanese clothes)$|sleeves|collar|^(?:sleeveless|frills|lace|lace trim|fur trim|gold trim|embroidery|floral print|buttons|double-breasted|hood)$/i.test(
        token,
      )
    ) {
      qualifiers.push(token);
      continue;
    }
    if (
      /\b(?:hair|eyes|skin|breasts|1girl|1boy|masterpiece|quality|artist:|lighting|background)\b/i.test(token)
    )
      continue;
    const k = /sock|hose|thighhigh|tights/i.test(token)
      ? 'hosiery'
      : /shoes|boots|heels|sandals|sneakers|loafers|footwear|mary janes/i.test(token)
        ? 'shoes'
        : /panties|underpants/i.test(token)
          ? 'underpants'
          : /\bbra\b|dudou|chest wrap/i.test(token)
            ? 'under-top'
            : /\b(?:skirt|pants|trousers|shorts|jeans|hakama)\b/i.test(token)
              ? 'bottom'
              : /\b(?:shirt|blouse|jacket|coat|blazer|hoodie|sweater|tunic|top)\b/i.test(token)
                ? 'top'
                : /\b(?:dress|robe|hanfu|kimono|yukata|uniform|suit|chinese clothes|japanese clothes|swimsuit|bikini|leotard|bodysuit|pajamas|nightgown|serafuku|armor|apron)\b/i.test(
                      token,
                    )
                  ? 'full'
                  : /belt|sash|ribbon|bow|gloves|hat|cap|scarf|accessor|necktie|neckerchief|obi/i.test(token)
                    ? 'accessory'
                    : /sleeves|collar/i.test(token) && groups.has('top')
                      ? 'top'
                      : garment;
    if (['top', 'bottom', 'full', 'hosiery', 'shoes', 'under-top', 'underpants'].includes(k)) garment = k;
    groups.set(k, [...(groups.get(k) ?? []), token]);
  }
  // Sleeves/collars and ensemble labels describe a real garment, not separate items that can
  // remain "worn" after the shirt/dress has been removed.
  const primary = groups.has('full')
    ? 'full'
    : groups.has('top')
      ? 'top'
      : groups.has('bottom')
        ? 'bottom'
        : (groups.keys().next().value ?? slot);
  if (qualifiers.length) groups.set(primary, [...(groups.get(primary) ?? []), ...qualifiers]);
  const id = 'suit-' + crypto.randomUUID();
  const pieces = [...groups].map(([part, tokens]) => ({
    id: id + '-' + part,
    design: tokens.join(', '),
    evidence: '用户手动指定款式',
    state: { location: 'worn', fastening: 'closed', arrangement: 'normal' },
  }));
  if (!pieces.length) throw new Error('没有可用的服装标签');
  return { id, name, title, mode, slot, pieces };
}
export function suitNote(record: ClothingRecord) {
  return record.suitMode === 'always'
    ? '用户固定整套，忽略剧情换装/穿脱'
    : record.suitMode === 'style'
      ? '款式固定，允许剧情穿脱；明确整套换装时退出绑定'
      : '';
}
