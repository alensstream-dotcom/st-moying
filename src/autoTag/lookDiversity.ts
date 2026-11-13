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

/**
 * 每个候选值对应的中文写法。
 *
 * 正文是中文、词表是英文，不给这张对照表，「正文优先」就是句空话：正文写着
 * 「银发」，程序却只认 `silver hair` 这个英文字面，照样把它换成棕发。
 */
const PROSE: Array<[string, RegExp]> = [
  ['black hair', /黑(?:色)?(?:的)?(?:长|短|直)?发|乌发|墨发|乌黑|漆黑(?:的)?长?发|一头黑/],
  ['dark brown hair', /深棕(?:色)?发|深褐(?:色)?发|栗色发|栗发|褐(?:色)?发|棕(?:色)?(?:的)?(?:长)?发/],
  ['blonde hair', /金(?:色)?(?:的)?(?:长)?发|一头金/],
  ['ash blonde hair', /浅金|亚麻色|灰金/],
  ['silver hair', /银(?:色|白)?(?:的)?(?:长)?发|一头银/],
  ['white hair', /白(?:色)?(?:的)?(?:长)?发|雪发|一头白/],
  ['red hair', /红(?:色)?(?:的)?(?:长)?发|赤发|火红(?:的)?发/],
  ['auburn hair', /酒红(?:色)?发|赭红|赤褐色发/],
  ['pink hair', /粉(?:色)?(?:的)?(?:长)?发|桃粉(?:色)?发/],
  ['blue hair', /蓝(?:色)?(?:的)?(?:长)?发/],
  ['navy blue hair', /藏青|深蓝(?:色)?发/],
  ['purple hair', /紫(?:色)?(?:的)?(?:长)?发/],
  ['mint green hair', /薄荷绿|浅绿(?:色)?发|绿发/],
  ['orange hair', /橙(?:色)?(?:的)?发|橘(?:色)?发/],
  ['long straight hair', /长直发|披肩长发|一头长发|直发/],
  ['short bob cut', /波波头|齐耳短发|短发/],
  ['twin tails', /双马尾|两侧扎|两束马尾/],
  ['single side ponytail', /侧马尾|侧扎马尾/],
  ['high ponytail', /高马尾/],
  ['braided hair', /麻花辫|编发|辫子/],
  ['wavy long hair', /波浪(?:状)?长发|长卷发|卷曲长发/],
  ['curly hair', /卷发|小卷/],
  ['hime cut', /公主切|姬发式/],
  ['medium length hair', /齐肩|中长发|及肩/],
  ['messy short hair', /乱发|蓬乱|炸毛/],
  ['drill hair', /螺旋卷|钻头卷/],
  ['brown eyes', /棕瞳|褐色(?:的)?眼|棕色(?:的)?眼/],
  ['amber eyes', /琥珀色|琥珀瞳|金褐色眼/],
  ['blue eyes', /蓝瞳|蓝眸|蓝色(?:的)?眼/],
  ['green eyes', /绿瞳|绿眸|碧色(?:的)?眼|碧眼/],
  ['grey eyes', /灰瞳|灰眸|灰色(?:的)?眼/],
  ['violet eyes', /紫瞳|紫眸|紫色(?:的)?眼/],
  ['red eyes', /红瞳|红眸|赤色(?:的)?眼/],
  ['golden eyes', /金瞳|金眸|金色(?:的)?眼/],
  ['teal eyes', /青色(?:的)?眼|蓝绿色眼|青瞳/],
  ['hazel eyes', /榛色|浅褐(?:色)?眼/],
  ['round eyes', /圆眼|圆圆(?:的)?眼|杏眼/],
  ['almond eyes', /杏眼|杏形眼/],
  ['tsurime', /吊眼|上挑(?:的)?眼|凤眼|丹凤眼/],
  ['tareme', /下垂眼|眼角下垂/],
  ['narrow eyes', /狭长(?:的)?眼|细长眼|眯眼/],
  ['wide eyes', /大眼|圆睁|睁大(?:的)?眼/],
  ['upturned eyes', /上挑(?:的)?眼尾|眼尾上挑/],
  ['droopy eyes', /下垂眼|困倦(?:的)?眼/],
  ['petite', /娇小|个子小|身材小巧/],
  ['slender', /纤细|苗条|清瘦|瘦削/],
  ['tall', /高挑|个子高|身高(?:很)?高|修长/],
  ['lithe', /轻盈|柔韧|灵活(?:的)?身体/],
  ['athletic', /结实|健壮|运动型|有肌肉/],
  ['curvy', /曲线(?:分明|玲珑)|凹凸有致|丰满/],
  ['hourglass figure', /沙漏(?:型)?身材|腰细臀丰/],
  ['small build', /骨架小|体型小/],
  ['willowy', /窈窕|身姿婀娜/],
  ['toned', /紧实|体态紧致/],
  ['short stature', /矮小|个子矮/],
  ['voluptuous', /丰满|傲人|身材丰腴/],
  ['hairpin', /发夹|发卡/],
  ['hair ribbon', /发带|缎带扎发/],
  ['hairband', /发箍/],
  ['hair clip', /发卡|夹子/],
  ['flower hair ornament', /花饰|头花|戴花/],
  ['star hair ornament', /星形发饰|星星发饰/],
  ['beret', /贝雷帽/],
  ['glasses', /眼镜/],
  ['single earring', /耳钉|单只耳环/],
  ['beaded necklace', /项链|颈坠/],
];

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

/**
 * 体型词按年龄分池。
 *
 * 现实问题：正文没写长相时，词表一视同仁地挑「没人用过」的那个值，于是角色卡里
 * 被叫「阿姨」的人分到 petite——娇小是儿童的骨架词，画出来直接换了一辈人。
 * 所以先定年龄段，再从该段允许的词里挑；定不出年龄段时按中性处理，不碰
 * 「娇小/骨架小/矮小」这类会改年龄观感的词。
 */
const SMALL_BUILD = new Set(['petite', 'small build', 'short stature']);
const FULL_BUILD = new Set(['voluptuous', 'hourglass figure', 'curvy']);

/** 称呼本身就是年龄证据：「阿姨/夫人/太太」这些词出现在名字里时不用再找正文。 */
const MATURE_TITLE =
  /(?:阿姨|大姨|小姨|姨妈|姨母|姨娘|婶婶|伯母|叔母|舅妈|妈妈|母亲|婆婆|岳母|夫人|太太|老板娘|师娘|嫂子|大娘|大婶|大妈|熟女|人妻|少妇)/;
/** 反过来：这些称呼已经说明她是少女/年轻女性。 */
const YOUNG_TITLE = /(?:妹妹|学姐|学妹|萝莉|小丫头|丫头|少女)/;

export type AgeBand = 'child' | 'teenager' | 'young adult' | 'mature female' | '';

/** 从档案的 age 字段读出年龄段（只认规范词，读不出返回空）。 */
export function bandFromAge(age: string): AgeBand {
  const text = (age ?? '').toLowerCase();
  if (!text) return '';
  if (/mature female|熟女|人妻|少妇|三十多岁|四十|五十|old|elderly/.test(text)) return 'mature female';
  if (/\bchild\b|小女孩|儿童|幼女|萝莉|小学生/.test(text)) return 'child';
  if (/teenager|高中生|中学生|少女|女高中生|\bjk\b|\bteen\b/.test(text)) return 'teenager';
  if (/young adult|大学生|年轻女性|二十多岁/.test(text)) return 'young adult';
  return '';
}

/** 名字里的称呼能定年龄段时就用它；定不出返回空。 */
export function bandFromName(name: string): AgeBand {
  const text = (name ?? '').trim();
  if (!text) return '';
  if (MATURE_TITLE.test(text)) return 'mature female';
  if (YOUNG_TITLE.test(text)) return 'teenager';
  return '';
}

/**
 * 该年龄段允许使用的体型词。
 *
 * 只有「已知是成熟女性」与「已知是儿童」这两档需要收紧（成熟女性不该娇小、
 * 儿童不该丰腴）；定不出年龄段时按中性处理，两类极端词都不用——宁可写
 * slender，也不要让一个没交代年龄的阿姨变成娇小少女。
 */
export function bodyPool(band: AgeBand): string[] {
  if (band === 'child') return BODY.filter((value) => !FULL_BUILD.has(value));
  if (band === 'mature female') return BODY.filter((value) => !SMALL_BUILD.has(value));
  if (band === 'teenager' || band === 'young adult') return [...BODY];
  return BODY.filter((value) => !SMALL_BUILD.has(value) && !FULL_BUILD.has(value));
}

const EXTRA = [
  'hairpin',
  'hair ribbon',
  'hairband',
  'hair clip',
  'flower hair ornament',
  'star hair ornament',
  'beret',
  'glasses',
  'single earring',
  'beaded necklace',
];

interface Aspect {
  field: LookField;
  /** 该字段是不是整块都被这个轴占满（body/extra 是；发色只占 hair 的一个词）。 */
  whole: boolean;
  pool: string[];
  match: RegExp;
}

const ASPECTS: Aspect[] = [
  { field: 'hair', whole: false, pool: HAIR_COLOR, match: new RegExp(`\\b(?:${HAIR_COLOR.join('|')})\\b`, 'i') },
  { field: 'hair', whole: false, pool: HAIR_STYLE, match: new RegExp(`\\b(?:${HAIR_STYLE.join('|')})\\b`, 'i') },
  { field: 'eyes', whole: false, pool: EYE_COLOR, match: new RegExp(`\\b(?:${EYE_COLOR.join('|')})\\b`, 'i') },
  { field: 'eyes', whole: false, pool: EYE_SHAPE, match: new RegExp(`\\b(?:${EYE_SHAPE.map((v) => v.replace(/ /g, '\\s')).join('|')})\\b`, 'i') },
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

/**
 * 正文里写过这个特征就说明它是对的，不许岔开。
 *
 * 不按字面比：正文是中文，`silver hair` 得靠对照表认成「银发」。
 */
function storyHas(story: string, value: string): boolean {
  if (!story) return false;
  const found = PROSE.find(([tag]) => tag === norm(value));
  if (found) return found[1].test(story);
  // 对照表没收录（用户手写的怪值）：退回字面包含，多认一点总比乱改好。
  const bare = norm(value).replace(/\b(?:hair|eyes?|figure|build)\b/g, '').trim();
  if (!bare) return false;
  const source = story.toLowerCase();
  return source.includes(bare) || bare.split(/\s+/).some((part) => part.length > 2 && source.includes(part));
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
 *
 * `name` 用来定年龄段：角色卡里被叫「阿姨」的角色，不该分到 petite 这种儿童骨架词。
 * 年龄段来源是档案的 age 字段优先，其次是名字里的称呼（阿姨/夫人/嫂子…）。
 */
export function diversifyLook(
  fields: CharFields,
  others: ReadonlyArray<Pick<CharTagEntry, 'fields'>>,
  story = '',
  name = '',
): DiverseLook {
  const used = usedTraits(others);
  const notes: string[] = [];
  const next: CharFields = { ...emptyCharFields(), ...fields } as CharFields;
  const band = bandFromAge(next.age ?? '') || bandFromName(name);

  for (const aspect of ASPECTS) {
    const pool = aspect.field === 'body' ? bodyPool(band) : aspect.pool;
    const allowed = new Set(pool.map(norm));
    const current = tokens(next[aspect.field] ?? '');
    const mine = aspect.whole ? current : current.filter((token) => aspect.match.test(token));
    const keeps = mine.filter((token) => !used.has(token) || storyHas(story, token));
    const collided = mine.filter((token) => !keeps.includes(token));
    /**
     * 体型还有一个额外淘汰条件：与年龄对不上。
     *
     * 「没人用过」不等于「可以用」——阿姨的 petite 如果库里只有她一个人用，旧逻辑
     * 会原样留着，于是同一个档案里 age=mature female、body=petite，出图每次都在
     * 「成熟女性」与「娇小」之间摇摆。年龄对不上且正文没写，就当撞车处理。
     */
    const outOfBand =
      aspect.field === 'body'
        ? mine.filter((token) => !allowed.has(norm(token)) && !storyHas(story, token))
        : [];
    // 都还站得住，或者撞了但那几个是正文写明的，就整轴不动
    if (keeps.length && !collided.length && !outOfBand.length) continue;
    if (outOfBand.length === 0 && collided.length && collided.every((token) => storyHas(story, token)))
      continue;

    const taken = tokens(next[aspect.field] ?? '');
    const free = pool.filter((value) => !used.has(norm(value)) && !taken.includes(norm(value)));
    if (!free.length) continue;
    // 正文里点了名的候选优先：「正文说她银发、档案里却写着撞车的蓝发」时，
    // 结果应该是银发，而不是随便挑一个没人用过的黑发。
    const chosen = free.find((value) => storyHas(story, value)) ?? free[0];
    // 整体轴(body/extra)一个字段只放一个值：撞车的那个要被换掉，不能留着叠加成
    // 「petite, slender」——两个词同时下发，模型画出来的体型是四个都不像。
    const drop = new Set([...collided, ...outOfBand]);
    const rest = aspect.whole
      ? current.filter((token) => keeps.includes(token) && !drop.has(token))
      : current.filter((token) => !aspect.match.test(token) || (keeps.includes(token) && !drop.has(token)));
    next[aspect.field] = [...new Set([...rest, norm(chosen)])].join(', ');
    const reason = outOfBand.length
      ? `体型与年龄档（${band || '未定'}）不符的「${outOfBand.join('/')}」`
      : mine.length
        ? `与已有角色撞车的「${mine.join('/')}」`
        : '空着的特征';
    notes.push(`${reason} → ${chosen}`);
  }

  return { fields: next, notes };
}

/**
 * 同批新建的多个角色之间也要互相岔开。
 *
 * 只在单条 new 上调用 diversifyLook 是不够的：它们参照的库是同一份快照，本楼新建的
 * 谁都还没进去，于是「同一楼新出现三个少女」会拿到同一头黑发同一双蓝眼。
 * 逐个岔开并把已定稿的字段累加进参照即可。
 */
export function diversifyNewOps<T extends { name: string; fields: CharFields }>(
  items: T[],
  entries: ReadonlyArray<Pick<CharTagEntry, 'fields'>>,
  story: string,
  notes: string[] = [],
): T[] {
  const accepted: Array<Pick<CharTagEntry, 'fields'>> = [];
  for (const item of items) {
    const diverse = diversifyLook(item.fields, [...entries, ...accepted], story, item.name);
    item.fields = diverse.fields;
    if (diverse.notes.length) notes.push(`${item.name}: 形象错开 ${diverse.notes.join('；')}`);
    accepted.push({ fields: diverse.fields });
  }
  return items;
}
