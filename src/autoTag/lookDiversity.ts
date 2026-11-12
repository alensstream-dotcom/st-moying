import { emptyCharFields, type CharTagEntry, type CharTagField } from '@/state/charTags';

type CharFields = Record<CharTagField, string>;

/**
 * 让同一部书里的女角色长得不一样。
 *
 * 现实问题：剧情只写「一个少女」，模型就照它自己的平均值画——同一部书里几个
 * 没被描述长相的女主，全是黑长直 + 棕瞳 + 中等身材，出图看着像同一个人换衣服。
 *
 * 做法是不跟剧情抢：只在**档案该字段还空着**、或**和已有女角色撞了**、且
 * **正文没有写过那个词**的时候，才从词表里换一个没人用过的值。一旦写进档案就
 * 由 appearanceLock 硬锁，后面不会再飘。
 *
 * 词表按用户点名的六条轴拆开：发色、发型、瞳色、眼形、身高体型、发饰。
 */

type LookField = 'hair' | 'eyes' | 'body' | 'extra';

const HAIR_COLOR = [
  'black hair',
  'dark brown hair',
  'blonde hair',
  'ash blonde hair',
  'silver hair',
  'white hair',
  'red hair',
  'auburn hair',
  'pink hair',
  'blue hair',
  'navy blue hair',
  'purple hair',
  'mint green hair',
  'orange hair',
];

const HAIR_STYLE = [
  'long straight hair',
  'short bob cut',
  'twin tails',
  'single side ponytail',
  'high ponytail',
  'braided hair',
  'wavy long hair',
  'curly hair',
  'hime cut',
  'medium length hair',
  'messy short hair',
  'drill hair',
];

const EYE_COLOR = [
  'brown eyes',
  'amber eyes',
  'blue eyes',
  'green eyes',
  'grey eyes',
  'violet eyes',
  'red eyes',
  'golden eyes',
  'teal eyes',
  'hazel eyes',
];

const EYE_SHAPE = [
  'round eyes',
  'almond eyes',
  'tsurime',
  'tareme',
  'narrow eyes',
  'wide eyes',
  'upturned eyes',
  'droopy eyes',
];

const BODY = [
  'petite',
  'slender',
  'tall',
  'lithe',
  'athletic',
  'curvy',
  'hourglass figure',
  'small build',
  'willowy',
  'toned',
  'short stature',
  'voluptuous',
];

const EXTRA = [
  'hairpin',
  'hair ribbon',
  'hairband',
  'hair clip',
  'flower hair ornament',
  'star hair ornament',
  'bersaglieri beret',
  'beret',
  'glasses',
  'single earring',
  'beaded necklace',
  'headphones',
];

interface Aspect {
  field: LookField;
  /** 该字段是不是整块都被这个轴占满（body/extra 是；发色只占 hair 的一个词）。 */
  whole: boolean;
  pool: string[];
  match: RegExp;
}

const ASPECTS: Aspect[] = [
  {
    field: 'hair',
    whole: false,
    pool: HAIR_COLOR,
    match: /\b(?:black|brown|blonde|ash blonde|silver|white|red|auburn|pink|blue|navy blue|purple|mint green|orange|grey|platinum) hair\b/i,
  },
  {
    field: 'hair',
    whole: false,
    pool: HAIR_STYLE,
    match:
      /\b(?:long straight hair|short bob cut|bob cut|twin tails|twintails|side ponytail|ponytail|braided hair|braid|wavy long hair|wavy hair|curly hair|hime cut|medium length hair|messy short hair|drill hair|pixie cut)\b/i,
  },
  { field: 'eyes', whole: false, pool: EYE_COLOR, match: /\b\w+ eyes?\b/i },
  {
    field: 'eyes',
    whole: false,
    pool: EYE_SHAPE,
    match: /\b(?:round eyes|almond eyes|tsurime|tareme|narrow eyes|wide eyes|upturned eyes|droopy eyes|sharp eyes)\b/i,
  },
  { field: 'body', whole: true, pool: BODY, match: /[\s\S]*/ },
  { field: 'extra', whole: true, pool: EXTRA, match: /[\s\S]*/ },
];

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

function tokens(value: string): string[] {
  return value
    .split(',')
    .map(norm)
    .filter(Boolean);
}

/** 库里（含本楼刚建的）已经在用的特征，按字段收。 */
function usedTraits(entries: ReadonlyArray<Pick<CharTagEntry, 'fields'>>): Set<string> {
  const used = new Set<string>();
  for (const entry of entries)
    for (const field of ['hair', 'eyes', 'body', 'extra'] as LookField[])
      for (const token of tokens(entry.fields?.[field] ?? '')) used.add(token);
  return used;
}

/** 正文里写过这个特征就说明它是对的，不许岔开。 */
function storyHas(story: string, value: string): boolean {
  if (!story) return false;
  const bare = norm(value)
    .replace(/\b(?:hair|eyes?|figure|build)\b/g, '')
    .trim();
  if (!bare) return false;
  const source = story.toLowerCase();
  if (source.includes(bare)) return true;
  // 单个词也认（「银发」对 silver，「琥珀色的眼睛」对 amber）
  return bare.split(/\s+/).some((part) => part.length > 2 && source.includes(part));
}

export interface DiverseLook {
  fields: CharFields;
  notes: string[];
}

/**
 * 把撞车的、空着的特征岔开。
 *
 * 只动 hair/eyes/body/extra 四个字段，不碰 sex/age/outfit，也不碰用户在档案里
 * 手写、且与别人不撞的值。
 */
export function diversifyLook(
  fields: CharFields,
  others: ReadonlyArray<Pick<CharTagEntry, 'fields'>>,
  story = '',
): DiverseLook {
  const used = usedTraits(others);
  const usedByAspect = new Map<Aspect, Set<string>>();
  const notes: string[] = [];
  const next: CharFields = { ...emptyCharFields(), ...fields } as CharFields;

  for (const aspect of ASPECTS) {
    if (!usedByAspect.has(aspect)) usedByAspect.set(aspect, used);
    const current = tokens(next[aspect.field] ?? '');
    const mine = aspect.whole
      ? current
      : current.filter((token) => aspect.match.test(token));
    const keeps = mine.filter((token) => !used.has(token) || storyHas(story, token));
    const collided = mine.filter((token) => !keeps.includes(token));
    if (keeps.length && !collided.length) continue;
    if (collided.length && collided.every((token) => storyHas(story, token))) continue;

    const free = aspect.pool.filter(
      (value) => !used.has(norm(value)) && !tokens(next[aspect.field] ?? '').includes(norm(value)),
    );
    if (!free.length) continue;
    const chosen = free[0];
    const rest = aspect.whole
      ? current
      : current.filter((token) => !aspect.match.test(token) || keeps.includes(token));
    next[aspect.field] = [...new Set([...rest, norm(chosen)])].join(', ');
    notes.push(
      `${fields[aspect.field]?.trim() ? `与已有角色撞车的「${mine.join('/')}」` : '空着的特征'} → ${chosen}`,
    );
  }

  return { fields: next, notes };
}
