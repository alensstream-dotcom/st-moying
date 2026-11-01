/**
 * 外形相似度(lookMatch):判断「正文描写的这个人」和「库里某条现成形象」是不是同一个人。
 *
 * 为什么需要它:召回层原先只认「触发词命中」——正文点名角色/作品,或撞上一两个外形词。
 * 于是正文把角色写成「银白长发、紫瞳、尖耳精灵」这种完整外形时,库里明明躺着一条一模一样的
 * 现成骨相,模型却还是照着自己的想象重新编一张脸;用户看到的差别就是「明明写得很具体,
 * 出来的人却和库里的对不上」。
 *
 * 做法是按维度抽取:发色 / 发长 / 发型 / 瞳色 / 瞳型 / 体格 / 种族 / 印记,每个维度抽出值集合,
 * 逐维比对——命中维度越多越像,同维度抽到不同值就算冲突(银发对黑发是冲突,不是不相似)。
 *
 * 只在命中足够多维、且没有冲突时才判「就是这个人」,让它直接顶到候选第一位并标记 pinned,
 * 渲染成「照抄这条,不要自己编」。命中一两维的仍旧只是普通候选,免得把不相干的脸硬塞进来。
 */
import type { LoreItemBase } from '@/data/loreTypes';

/** 比对维度。不同维度互不相干,同维度有值冲突才算不像。 */
export type LookDimension =
  | 'hairColor'
  | 'hairLength'
  | 'hairStyle'
  | 'eyeColor'
  | 'pupil'
  | 'body'
  | 'race'
  | 'mark';

/**
 * 中英词表:同一概念的中文说法与 danbooru 英文 tag 归成同一个规范值。
 *
 * 两边都要收:正文是中文(「银白长发」),库里字段是英文 tag(`white hair, long hair`)。
 * 只收一边的话,比对永远只能中一边。
 */
const VOCAB: Record<LookDimension, Record<string, string[]>> = {
  hairColor: {
    white: ['白发', '银发', '银白', '雪白', '白毛', '白色', 'white hair', 'silver hair'],
    grey: ['灰发', '铅灰', '灰白', 'grey hair', 'gray hair'],
    blonde: ['金发', '浅金', 'blonde hair', 'golden hair'],
    black: ['黑发', '乌黑', '黑长', 'black hair'],
    brown: ['棕发', '褐发', '栗色', 'brown hair'],
    red: ['红发', '赤发', 'red hair'],
    pink: ['粉发', '粉色头发', 'pink hair'],
    purple: ['紫发', '紫罗兰', 'purple hair', 'violet hair'],
    blue: ['蓝发', 'blue hair'],
    green: ['绿发', 'green hair'],
    orange: ['橙发', '橘发', 'orange hair'],
    twotone: ['挑染', '双色发', '渐层', 'streaked hair', 'two-tone hair', 'multicolored hair'],
  },
  hairLength: {
    short: ['短发', '及耳', 'short hair'],
    medium: ['中长发', '及肩', 'medium hair'],
    long: ['长发', 'long hair'],
    verylong: ['超长发', '及腰', '拖地', 'very long hair'],
  },
  hairStyle: {
    twintail: ['双马尾', 'twintails', 'twin tails'],
    ponytail: ['马尾', 'ponytail'],
    braid: ['麻花辫', '辫子', 'braid', 'braids'],
    bun: ['丸子头', '团子头', 'hair bun'],
    straight: ['直发', 'straight hair'],
    curly: ['卷发', 'curly hair', 'wavy hair'],
    blunt: ['齐刘海', 'blunt bangs'],
    himecut: ['姬发式', '公主切', 'hime cut'],
    ahoge: ['呆毛', 'ahoge'],
  },
  eyeColor: {
    red: ['红瞳', '赤瞳', 'red eyes'],
    blue: ['蓝瞳', 'blue eyes'],
    green: ['绿瞳', 'green eyes'],
    purple: ['紫瞳', 'purple eyes', 'violet eyes'],
    gold: ['金瞳', '黄瞳', '琥珀瞳', 'yellow eyes', 'gold eyes', 'golden eyes', 'amber eyes'],
    grey: ['灰瞳', 'grey eyes', 'gray eyes'],
    pink: ['粉瞳', 'pink eyes'],
    black: ['黑瞳', 'black eyes'],
    orange: ['橙瞳', 'orange eyes'],
  },
  pupil: {
    heterochromia: ['异色瞳', 'heterochromia'],
    heart: ['心形瞳', 'heart-shaped pupils'],
    star: ['星形瞳', 'star-shaped pupils'],
    cross: ['十字瞳', 'x-shaped pupils'],
    slit: ['竖瞳', '蛇瞳', '猫瞳', 'slit pupils'],
    symbol: ['符号瞳', 'symbol-shaped pupils'],
  },
  body: {
    petite: ['娇小', '小个子', '轻盈', 'petite'],
    tall: ['高挑', '九头身', '高大', 'tall', 'model height'],
    voluptuous: ['丰腴', '丰满', '巨乳', '肉感', 'voluptuous', 'large breasts'],
    slim: ['纤细', '清瘦', '骨感', '瘦', 'slim', 'slender'],
    muscular: ['肌肉', '健壮', '马甲线', 'muscular', 'toned'],
    chubby: ['微胖', '有点肉', '软肉', 'chubby', 'plump'],
    pregnant: ['孕妇', '怀孕', '孕肚', 'pregnant'],
  },
  race: {
    elf: ['精灵', '尖耳', 'pointed ears', 'elf'],
    cat: ['猫耳', '猫娘', 'cat ears', 'catgirl'],
    fox: ['狐耳', '狐娘', '狐狸耳朵', 'fox ears', 'fox girl'],
    wolf: ['狼耳', '狼娘', 'wolf ears'],
    rabbit: ['兔耳', '兔娘', 'rabbit ears'],
    dog: ['犬耳', '狗耳', 'droopy ears', 'dog ears'],
    angel: ['天使', '光翼', 'angel', 'halo'],
    demon: ['恶魔', '魔角', '恶魔翼', 'demon', 'demon horns'],
    succubus: ['魅魔', 'succubus'],
    vampire: ['吸血鬼', 'vampire', 'fang'],
    android: ['机械', '仿生', '人偶', '赛博格', 'android', 'cyborg', 'robot'],
    mermaid: ['人鱼', '鲛人', 'mermaid', 'fish tail'],
    ghost: ['幽灵', '亡魂', 'ghost'],
  },
  mark: {
    mole: ['泪痣', '痣', 'mole'],
    freckles: ['雀斑', 'freckles'],
    tattoo: ['纹身', '刺青', 'tattoo'],
    scar: ['疤', '伤痕', 'scar'],
    eyepatch: ['眼罩', '单眼罩', 'eyepatch', 'eye mask'],
    bandage: ['绷带', 'bandage'],
    glasses: ['眼镜', 'glasses'],
  },
};

/** 一条文本抽出来的维度值:维度 → 命中到的规范值集合。 */
export type LookProfile = Map<LookDimension, Set<string>>;

/**
 * 从一段文本抽外形维度。
 *
 * 只在文本里直接出现词表说法时才记;不做推断(写「银白长发」不会同时记成 grey 与 white 的父类),
 * 因为比对要的是「写得一模一样」,不是「大致同色系」。
 */
export function scanLook(text: string): LookProfile {
  const hay = (text ?? '').toLowerCase();
  const profile: LookProfile = new Map();
  if (!hay.trim()) return profile;
  for (const dimension of Object.keys(VOCAB) as LookDimension[]) {
    const table = VOCAB[dimension];
    for (const [value, surfaces] of Object.entries(table)) {
      if (!surfaces.some(surface => hay.includes(surface.toLowerCase()))) continue;
      const bucket = profile.get(dimension);
      if (bucket) bucket.add(value);
      else profile.set(dimension, new Set([value]));
    }
  }
  return profile;
}

/** 合并两次扫描:正文要同时看目标句与角色在场描写,分开扫再并集。 */
export function mergeLook(...profiles: (LookProfile | undefined)[]): LookProfile {
  const merged: LookProfile = new Map();
  for (const profile of profiles) {
    if (!profile) continue;
    for (const [dimension, values] of profile) {
      const bucket = merged.get(dimension);
      if (bucket) values.forEach(value => bucket.add(value));
      else merged.set(dimension, new Set(values));
    }
  }
  return merged;
}

export interface LookMatch {
  /** 命中的维度数(冲突维度不计)。 */
  matched: number;
  /** 命中的维度名,渲染时给模型看。 */
  dimensions: LookDimension[];
  /** 冲突的维度:同一维度两边抽到了不同的值。 */
  conflicts: LookDimension[];
  /** 0–1,命中的维度占双方都有值维度的比例;有冲突直接清零。 */
  ratio: number;
}

/**
 * 比对两份外形档案。
 *
 * 冲突判定偏严:同一维度只要两边都有值且没有交集就算冲突。银发 vs 黑发是冲突,
 * 因为那明显是两个人;而「白毛 + 紫瞳」与「白毛 + 金瞳」只有瞳色冲突,也判冲突——
 * 这与用户的原始抱怨一致:瞳色不同就是另一张脸。
 */
export function compareLook(a: LookProfile, b: LookProfile): LookMatch {
  const dimensions: LookDimension[] = [];
  const conflicts: LookDimension[] = [];
  let shared = 0;
  for (const [dimension, values] of a) {
    const other = b.get(dimension);
    if (!other || !other.size) continue;
    shared += 1;
    const overlap = [...values].some(value => other.has(value));
    if (overlap) dimensions.push(dimension);
    else conflicts.push(dimension);
  }
  const ratio = shared ? (conflicts.length ? 0 : dimensions.length / shared) : 0;
  return { matched: dimensions.length, conflicts, dimensions, ratio };
}

/**
 * 条目侧要参与比对的那半边:只有带 hair/eyes 的条目(同人骨相)才谈得上「同一个人」。
 *
 * 脸型/体型条目是抽象气质,本来就不该被当成具名角色去复用,混进来只会让阈值失真。
 */
export function lookTextOf(item: LoreItemBase): string {
  const record = item as LoreItemBase & { hair?: string; eyes?: string; archetype?: string };
  return [record.hair ?? '', record.eyes ?? '', item.tags].filter(Boolean).join(', ');
}

/** 判「就是这个人」的最低命中维度数:三维起(如 发色 + 瞳色 + 种族),再少就只是擦边。 */
export const LOOK_PIN_MIN_DIMENSIONS = 3;

/** 判定结果是否达到「可直接复用」的门槛。 */
export function isLookPin(match: LookMatch): boolean {
  return match.matched >= LOOK_PIN_MIN_DIMENSIONS && match.conflicts.length === 0;
}

/** 维度名的中文展示,写进候选行让模型看得懂凭什么选它。 */
export const LOOK_DIMENSION_LABEL: Record<LookDimension, string> = {
  hairColor: '发色',
  hairLength: '发长',
  hairStyle: '发型',
  eyeColor: '瞳色',
  pupil: '瞳型',
  body: '体格',
  race: '种族',
  mark: '印记',
};
