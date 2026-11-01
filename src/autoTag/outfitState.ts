/**
 * 服装状态的**跨楼层账本**。
 *
 * 用户原话:「衣物固定感觉被你修改后还变差了,明明衣服没有变化,结果一层楼生出的图片
 * 衣服种类乱飘。隔了楼层就更加严重,可能当前楼层没有描述女主穿什么衣服,导致它就随便挑了。」
 * 「衣服穿脱、半穿半脱不固定,有时候女主是露肩膀或漏屁股…图片里就变成无衣服或全穿。」
 *
 * 根因是**视野**而不是规则:上下文只带最近几楼,当前楼又常常一句衣着都没写,
 * 于是模型每层都在从零决定穿什么、脱到什么程度。规则写多少条都没用——
 * 它没有可继承的事实。
 *
 * 这里把「谁现在穿着什么、脱到哪一步」落进该楼的 message.extra,
 * 下一楼开跑前读回来注入成【服装现状】区块。于是:
 * - 没写衣着的新楼有事实可抄,不再随机挑;
 * - 半脱是可持久化的中间态,不会因为没写就弹回全穿或滑到全裸。
 *
 * 指纹的取法是**词表匹配**而非自由文本:从服装库里取所有 tag 词做词表,
 * 命中即视为衣着部件;不在词表里的词(发色、体型、表情)不会混进来。
 */

import { allWardrobeItems } from '@/data/loreIndex';
import type { STMessage } from '@/st/context';

/** 穿着程度。三档足够,再多模型就用不准。 */
export type WearLevel = 'worn' | 'partial' | 'off';

export interface OutfitStateEntry {
  name: string;
  /** 冻结的衣着部件(英文 tag,取自服装库词表,已去重)。 */
  garment: string;
  /** 当前穿脱程度。 */
  wear: WearLevel;
  /** 半脱/脱下时保留在画面里的状态词(slipped down、around waist 等)。 */
  state: string;
}

export interface OutfitFloorState {
  v: 1;
  swipe: number;
  entries: OutfitStateEntry[];
}

export const BBI_OUTFIT_EXTRA_KEY = 'bbiOutfitState';
const ENTRY_CAP = 24;

/**
 * 半脱状态词。danbooru 上「衣服还在身上但移位」的写法。
 * 顺序有意义:`on the floor` 这类脱落词要排在移位词之后判,否则被误判成 partial。
 */
const PARTIAL_STATE_RE =
  /(?:slipped[-_ ]?down|pulled[-_ ]?(?:aside|down|up)|unzipped|unbuttoned|open[-_ ]?(?:shirt|jacket|robe)|around[-_ ]?(?:waist|hips|one[-_ ]?arm|arm)|hanging[-_ ]?off[-_ ]?(?:shoulder|one[-_ ]?shoulder)|off[-_ ]?shoulder|one[-_ ]?shoulder[-_ ]?bare|hanging[-_ ]?on[-_ ]?one[-_ ]?arm|clothes[-_ ]?around[-_ ]?waist|undressed[-_ ]?partially|half[-_ ]?(?:naked|undressed|dressed)|torn|ripped|breasts[-_ ]?out|midriff[-_ ]?bare)/i;

/** 完全脱下。命中即 off(优先于 partial)。 */
const OFF_STATE_RE =
  /(?:completely[-_ ]?nude|fully[-_ ]?nude|full[-_ ]?nude|nude|naked|topless|bottomless|no[-_ ]?clothes|on[-_ ]?the[-_ ]?floor|discarded|undressed[-_ ]?completely)/i;

/** 只穿内衣的中间态。裸着上身但内裤还在,也算半脱而不是全裸。 */
const UNDERWEAR_ONLY_RE =
  /(?:in[-_ ]?(?:only[-_ ]?)?(?:underwear|lingerie|bra[-_ ]?and[-_ ]?panties|panties)|lingerie|underwear|panties|(?:^|[,\s])(?:bra|bikini)(?=$|[,\s]))/i;

/**
 * 纯颜色词。服装库的 tag 里有单独成词的 black、white,
 * 它们单独出现时说明不了穿了什么,不算衣着部件。
 */
const COLOR_ONLY = new Set([
  'black',
  'white',
  'red',
  'blue',
  'green',
  'yellow',
  'pink',
  'purple',
  'brown',
  'grey',
  'gray',
  'orange',
  'gold',
  'silver',
  'beige',
  'navy',
  'cream',
  'tan',
  'aqua',
]);

let garmentVocab: Set<string> | null = null;

/**
 * 服装词表:服装库所有 tag 词 + 少量库外常见部件。
 *
 * 词表只用来**识别**衣着词,不用于注入——注入的是模型自己写过的那串原文,
 * 所以词表漏一个词最多是少记一件,不会写出它没穿过的东西。
 */
function vocab(): Set<string> {
  if (garmentVocab) return garmentVocab;
  const set = new Set<string>();
  for (const item of allWardrobeItems()) {
    for (const part of String(item.tags ?? '').split(',')) {
      const word = part.trim().toLowerCase();
      if (!word) continue;
      // 权重语法 2::xxx:: 与括号注释剥掉,只留词干
      const bare = word.replace(/^[-+\d.]+::/, '').replace(/::/g, '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      if (bare) set.add(bare);
    }
  }
  for (const extra of [
    'dress',
    'shirt',
    'skirt',
    'pants',
    'shorts',
    'jeans',
    'jacket',
    'coat',
    'bra',
    'panties',
    'underwear',
    'thighhighs',
    'pantyhose',
    'stockings',
    'garter belt',
    'apron',
    'uniform',
    'kimono',
    'yukata',
    'robe',
    'towel',
    'scarf',
    'gloves',
    'boots',
    'shoes',
    'sandals',
    'hoodie',
    'sweater',
    'cardigan',
    'blouse',
    'camisole',
    'leotard',
    'bodysuit',
    'bikini',
    'swimsuit',
    'socks',
    'belt',
    'necktie',
    'ribbon',
  ]) {
    set.add(extra);
  }
  garmentVocab = set;
  return set;
}

/** 从一个角色的 tag 串里取出衣着部件(去重、保序、限量)。 */
export function extractGarment(tag: string): string {
  const found: string[] = [];
  const words = vocab();
  const normalized = (tag ?? '')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ');
  for (const word of words) {
    if (!word || found.length >= 12) continue;
    if (COLOR_ONLY.has(word)) continue;
    // 词表里也有下划线写法的条目,统一按空格比;整词边界避免 bra 命中 bracelet
    const needle = word.replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
    if (!needle) continue;
    const re = new RegExp(`(?:^|[,\\s])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[,\\s])`);
    if (re.test(normalized) && !found.includes(word)) found.push(word);
  }
  return found.join(', ');
}

/** 从 tag 串读出穿脱程度。 */
export function readWear(tag: string): { wear: WearLevel; state: string } {
  const hay = tag ?? '';
  const off = hay.match(OFF_STATE_RE);
  const partialWords = [...hay.matchAll(new RegExp(PARTIAL_STATE_RE.source, 'gi'))].map(m => m[0]);
  const partial = partialWords.join(', ');
  // 同时出现「脱到地上」与移位词时按移位算:衣服还在画面里,那是半脱
  if (partial) return { wear: 'partial', state: partial };
  if (off) {
    // 只有内裤/胸罩还在 = 半脱(不是全裸)
    if (UNDERWEAR_ONLY_RE.test(hay) && /\b(?:nude|naked|topless|bottomless)\b/i.test(hay)) {
      return { wear: 'partial', state: 'underwear only' };
    }
    return { wear: 'off', state: off[0] };
  }
  if (UNDERWEAR_ONLY_RE.test(hay)) return { wear: 'partial', state: 'underwear only' };
  return { wear: 'worn', state: '' };
}

function normalizeEntry(raw: unknown): OutfitStateEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Partial<OutfitStateEntry>;
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!name) return null;
  const wear: WearLevel = item.wear === 'off' || item.wear === 'partial' ? item.wear : 'worn';
  return {
    name,
    garment: typeof item.garment === 'string' ? item.garment.trim().slice(0, 400) : '',
    wear,
    state: typeof item.state === 'string' ? item.state.trim().slice(0, 200) : '',
  };
}

export function readOutfitState(message: STMessage | undefined): OutfitFloorState | null {
  const raw = message?.extra?.[BBI_OUTFIT_EXTRA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<OutfitFloorState>;
  if (value.v !== 1 || !Array.isArray(value.entries)) return null;
  const swipe = typeof value.swipe === 'number' && Number.isInteger(value.swipe) ? value.swipe : 0;
  const entries = value.entries
    .map(normalizeEntry)
    .filter((entry): entry is OutfitStateEntry => !!entry)
    .slice(0, ENTRY_CAP);
  return { v: 1, swipe, entries };
}

function activeSwipe(message: STMessage): number {
  return typeof message.swipe_id === 'number' ? message.swipe_id : 0;
}

/**
 * 从本楼往前找最近一份服装状态,并与更早的账本合并。
 *
 * 合并方向是「后写覆盖先写」:半脱、脱下都能继承;但**只有**后写的楼里出现过该角色
 * 才有记录,没出现的人保留旧状态——她不会因为这一楼没被提及就自动穿回去。
 */
export function latestOutfitStates(chat: STMessage[], beforeFloor: number): Map<string, OutfitStateEntry> {
  const merged = new Map<string, OutfitStateEntry>();
  const end = Math.min(Math.max(0, beforeFloor), chat.length);
  for (let floor = 0; floor < end; floor += 1) {
    const message = chat[floor];
    const state = readOutfitState(message);
    if (!state || state.swipe !== activeSwipe(message)) continue;
    for (const entry of state.entries) merged.set(entry.name, entry);
  }
  return merged;
}

/** 从本次生成的画面里抽取新状态。已有的角色没出现在画面里时沿用旧值。 */
export function nextOutfitState(
  previous: Map<string, OutfitStateEntry>,
  images: Array<{ characters?: Array<{ name: string; tag: string }>; tag?: string }>,
): Map<string, OutfitStateEntry> {
  const next = new Map(previous);
  for (const image of images) {
    const cast = image.characters ?? [];
    if (cast.length) {
      for (const character of cast) {
        const garment = extractGarment(character.tag);
        const { wear, state } = readWear(character.tag);
        const prior = next.get(character.name);
        next.set(character.name, {
          name: character.name,
          // 镜头里没写衣着但状态没变时,沿用旧指纹;写了就看写的
          garment: garment || prior?.garment || '',
          wear: wear === 'worn' && !garment ? (prior?.wear ?? 'worn') : wear,
          state,
        });
      }
      continue;
    }
    // 单串后端没有角色块,一整串 tag 说的是所有人。此时只能按「名字在这一串里出现过」
    // 认出在场的人,衣着词是共用的——粗一点,但总比一个字都不记、下一楼全忘强。
    const tag = image.tag ?? '';
    for (const [name, prior] of previous) {
      if (!name || !tag.includes(name)) continue;
      const garment = extractGarment(tag);
      const { wear, state } = readWear(tag);
      next.set(name, {
        name,
        garment: garment || prior.garment,
        wear: wear === 'worn' && !garment ? prior.wear : wear,
        state,
      });
    }
  }
  return next;
}

export function buildOutfitStatePayload(
  states: Map<string, OutfitStateEntry>,
  swipe: number,
): OutfitFloorState | undefined {
  const entries = [...states.values()].filter(entry => entry.garment || entry.wear !== 'worn');
  if (!entries.length) return undefined;
  return { v: 1, swipe, entries: entries.slice(0, ENTRY_CAP) };
}

const WEAR_LABEL: Record<WearLevel, string> = {
  worn: '穿着',
  partial: '半脱',
  off: '已脱',
};

/**
 * 渲染注入 prompt 的【服装现状】区块。
 *
 * 措辞要说明「这是事实、不是候选」:模型对候选会重新挑,对事实才照抄。
 */
export function buildOutfitStateBlock(states: Map<string, OutfitStateEntry>): string {
  const rows = [...states.values()].filter(entry => entry.garment || entry.wear !== 'worn');
  if (!rows.length) return '';
  const lines = rows.map(entry => {
    const head = `- ${entry.name}:${WEAR_LABEL[entry.wear]}`;
    const body = entry.garment ? `，${entry.garment}` : '';
    const tail = entry.state ? `（${entry.state}）` : '';
    return `${head}${body}${tail}`;
  });
  return [
    '【服装现状】[已经发生的事实,不是候选;正文没有写明变化就照抄]',
    '- 这份账本来自前面的楼层,是本段剧情开场时每个人身上的实际状态。',
    '- 写着「穿着」的,把她的衣服原样写进画面;正文没提衣着不是没穿。',
    '- 写着「半脱」的,衣服仍在身上,只移位或解开:该露的部位露、该留的布料必须留着,不许升级成全裸。',
    '- 写着「已脱」的,不要再给她穿回去;要穿回必须有正文里的穿衣动作。',
    '- 只有正文明确写了脱、穿、换、撕才会变;没写就延续下面这一行。',
    ...lines,
  ].join('\n');
}

export interface OutfitGap {
  name: string;
  kind: 'half-to-nude' | 'undressed-again';
  expected: string;
  actual: string;
}

/**
 * 画面是否违反了服装账本。
 *
 * 只查两种**确定错**的情况,不做审美判断:
 * 1. 账本半脱,画面却写成全裸/全穿(用户最烦的那个);
 * 2. 账本已脱,画面又出现完整衣着。
 */
export function diagnoseOutfit(
  image: { characters?: Array<{ name: string; tag: string }> },
  states: Map<string, OutfitStateEntry>,
): OutfitGap[] {
  const gaps: OutfitGap[] = [];
  for (const character of image.characters ?? []) {
    const prior = states.get(character.name);
    if (!prior) continue;
    const { wear } = readWear(character.tag);
    const garment = extractGarment(character.tag);
    if (prior.wear === 'partial' && wear === 'off' && !/underwear|lingerie|panties|bra/i.test(character.tag)) {
      gaps.push({ name: character.name, kind: 'half-to-nude', expected: '半脱', actual: '全裸' });
      continue;
    }
    if (prior.wear === 'off' && wear === 'worn' && garment && character.tag.length > 0) {
      // 已脱却写回完整衣着:只在没有任何解读线索时才判错
      const hasOffWord = OFF_STATE_RE.test(character.tag);
      if (!hasOffWord) {
        gaps.push({ name: character.name, kind: 'undressed-again', expected: '已脱', actual: '又穿回' });
      }
    }
  }
  return gaps;
}

/** 违反账本时的重试话术。 */
export function outfitRetryNote(gaps: OutfitGap[]): string {
  const lines = gaps.map(
    gap =>
      `- ${gap.name}:账本里她是「${gap.expected}」,这张写成了「${gap.actual}」` +
      (gap.kind === 'half-to-nude'
        ? '——半脱要把留下的布料写出来(slipped down / pulled aside / unzipped / clothes around waist),不能直接 nude'
        : '——已经脱掉就别再穿回去,除非正文写了穿衣动作;若只是把衣服披回身上,写 hanging off shoulder 这类状态词'),
  );
  return `<outfit_state_retry>
上一版和【服装现状】对不上:衣服明明没有变化,穿脱程度却跳了。
${lines.join('\n')}
改法:只改该角色的服装部分,人物、姿势、景别与其它图一律不动。
直接从 <thinking> 开始,不要解释。
</outfit_state_retry>`;
}
