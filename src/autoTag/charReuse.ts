import { characterAliases } from '@/state/characterAliases';
import { currentIdentityFacts, type IdentityFact } from '@/state/characterIdentity';
/**
 * 已建档角色的「直接复用」与「同人异称归并」判定。
 *
 * 用户的原话是:
 * 1) 剧情里写出来的形象,和库里已有的形象差不多的时候,就直接拿库里那条来用。
 * 2) 当一个角色在剧情中出现多个称呼时(比如有时候叫风千华,有时候叫风阿姨/千华),
 *    角色库不重复收录是对的,但生出的图片形象不能变动。
 *
 * 代码层对应三件事:
 * - 素材库候选层(loreIndex):正文外形与某条同人/脸型骨相多维重合 → 标 pinned 顶到第一位;
 * - 外形复用(findCharReuse):正文外形与**已经建档的角色**多维重合 → 直接点名「这段就是她」;
 * - 称呼归并(findCharAliases / resolveCanonicalCharName / normalizePlanCharacters):
 *   把正文或模型输出里的「姓氏+尊称/辈分/职务」(风阿姨、林老师、苏总)、「直呼其名/亲昵简称」(千华、千华姐)
 *   唯一归并回已建档主名(风千华),并在模型因换称呼漏抄固定外貌时用档案字段兜底补齐。
 */
import { type CharTagEntry, type CharTagField } from '@/state/charTags';
import { LOOK_DIMENSION_LABEL, compareLook, isLookPin, scanLook } from '@/data/lookMatch';

export interface CharReuse {
  name: string;
  /** 命中的维度中文名。 */
  dimensions: string;
  /** 命中的维度数,多者优先。 */
  matched: number;
}

export interface CharAliasHit {
  /** 档案里的标准主名(如「风千华」)。 */
  name: string;
  /** 本段正文中实际出现的同源别称/尊称/简称(如 `['风阿姨', '千华']`)。 */
  aliases: string[];
}

/** 常见汉语复姓:拆姓与名时优先匹配双字姓,其余 2~4 字中文名按单字姓拆。 */
const COMPOUND_SURNAMES = [
  '欧阳',
  '太史',
  '端木',
  '上官',
  '司马',
  '东方',
  '独孤',
  '南宫',
  '万俟',
  '闻人',
  '夏侯',
  '诸葛',
  '尉迟',
  '公羊',
  '赫连',
  '澹台',
  '皇甫',
  '宗政',
  '濮阳',
  '公冶',
  '太叔',
  '申屠',
  '公孙',
  '慕容',
  '仲孙',
  '钟离',
  '长孙',
  '宇文',
  '司徒',
  '鲜于',
  '司空',
  '闾丘',
  '子车',
  '亓官',
  '司寇',
  '巫马',
  '公西',
  '颛孙',
  '壤驷',
  '公良',
  '漆雕',
  '乐正',
  '宰父',
  '谷梁',
  '拓跋',
  '夹谷',
  '轩辕',
  '令狐',
  '段干',
  '百里',
  '呼延',
  '东郭',
  '南门',
  '羊舌',
  '微生',
  '梁丘',
  '左丘',
  '西门',
  '百里',
  '第五',
];

/** 姓氏或名字后面常接的尊称、辈分、亲属、职务、仙侠/校园称谓后缀。 */
const HONORIFIC_SUFFIXES = [
  '阿姨',
  '大姨',
  '小姨',
  '姨妈',
  '姨母',
  '姨娘',
  '姨',
  '妈妈',
  '母亲',
  '母后',
  '母妃',
  '母',
  '娘亲',
  '娘',
  '姐姐',
  '老姐',
  '大姐',
  '小姐姐',
  '姐',
  '妹妹',
  '小妹',
  '妹子',
  '妹',
  '嫂子',
  '大嫂',
  '表嫂',
  '嫂',
  '婶婶',
  '大婶',
  '小婶',
  '婶子',
  '婶',
  '姑姑',
  '大姑',
  '小姑',
  '姑妈',
  '姑母',
  '姑',
  '奶奶',
  '婆婆',
  '外婆',
  '姥姥',
  '太后',
  '老夫人',
  '老太太',
  '夫人',
  '太太',
  '女士',
  '小姐',
  '姑娘',
  '丫头',
  '女侠',
  '千金',
  '大小姐',
  '二小姐',
  '三小姐',
  '老师',
  '教师',
  '教授',
  '导师',
  '先生',
  '医生',
  '大夫',
  '护士',
  '院长',
  '主任',
  '总',
  '总裁',
  '董事长',
  '董',
  '经理',
  '总监',
  '部长',
  '处长',
  '局长',
  '科长',
  '书记',
  '厂长',
  '店长',
  '老板娘',
  '老板',
  '校长',
  '会长',
  '社长',
  '班长',
  '队长',
  '团长',
  '组长',
  '委员',
  '学姐',
  '学妹',
  '学长',
  '同学',
  '前辈',
  '后辈',
  '师尊',
  '师父',
  '师傅',
  '师娘',
  '师母',
  '师姐',
  '师妹',
  '师叔',
  '师伯',
  '师祖',
  '仙子',
  '仙尊',
  '仙姑',
  '真人',
  '真君',
  '道长',
  '圣女',
  '魔女',
  '妖女',
  '神女',
  '女帝',
  '女皇',
  '女王',
  '长老',
  '掌门',
  '宗主',
  '门主',
  '谷主',
  '宫主',
  '阁主',
  '殿主',
  '峰主',
  '堂主',
  '教主',
  '帮主',
  '家主',
  '殿下',
  '公主',
  '郡主',
  '王妃',
  '皇妃',
  '贵妃',
  '娘娘',
  '皇后',
  '太妃',
  '小主',
  '格格',
  '大人',
  '将军',
  '统领',
  '警官',
  '探长',
];

/** 前缀式亲昵称呼:小X、阿X、老X。 */
const AFFECTION_PREFIXES = ['小', '阿', '老'];

const CJK_NAME_RE = /^[\u4e00-\u9fa5]{2,5}$/;

interface NameParts {
  full: string;
  surname: string;
  given: string;
}

/** 把中文姓名拆成「姓 + 名」。非中文名或已带称谓后缀的名字不拆。 */
function splitChineseName(raw: string): NameParts | null {
  const full = raw.trim();
  if (!CJK_NAME_RE.test(full)) return null;
  // 若建档名本身就以称谓后缀结尾(如「风阿姨」「王老师」),提取前面的姓氏作为词根
  for (const suffix of HONORIFIC_SUFFIXES) {
    if (full.length > suffix.length && full.endsWith(suffix)) {
      const stem = full.slice(0, full.length - suffix.length);
      if (stem.length === 1 || COMPOUND_SURNAMES.includes(stem)) {
        return { full, surname: stem, given: '' };
      }
    }
  }
  for (const compound of COMPOUND_SURNAMES) {
    if (full.startsWith(compound) && full.length > compound.length) {
      return { full, surname: compound, given: full.slice(compound.length) };
    }
  }
  if (full.length >= 2 && full.length <= 4) {
    return { full, surname: full.slice(0, 1), given: full.slice(1) };
  }
  return null;
}

/**
 * 为单个已建档角色生成所有合理的同源称呼候选(不含原名本身)。
 *
 * 例:「风千华」→
 * - 姓氏+称谓:风阿姨、风姨、风姐、风妈妈、风夫人、风太太、风老师、风总、风仙子、风师尊……
 * - 前缀+姓/名:小风、老风、阿风、小千华、阿千华
 * - 直呼其名/名字+称谓:千华、千华姐、千华阿姨、千华老师……
 * - 叠字小名(若单字名或尾字):华华(仅当原名 2 字如「风华」时生成「华华」)
 */
export function candidateAliasesForEntry(entry: CharTagEntry, facts = currentIdentityFacts()): string[] {
  const canonical = entry.name.trim();
  if (!canonical) return [];
  const parts = splitChineseName(canonical);
  const out = new Set(characterAliases(canonical, facts));
  if (!parts) return [...out];
  const { surname, given } = parts;

  if (surname) {
    for (const suffix of HONORIFIC_SUFFIXES) {
      out.add(`${surname}${suffix}`);
    }
    for (const prefix of AFFECTION_PREFIXES) {
      out.add(`${prefix}${surname}`);
    }
  }

  if (given) {
    if (given.length >= 2) {
      out.add(given);
      for (const prefix of AFFECTION_PREFIXES) {
        out.add(`${prefix}${given}`);
      }
    }
    for (const suffix of HONORIFIC_SUFFIXES) {
      out.add(`${given}${suffix}`);
    }
    if (given.length === 1) {
      out.add(`${given}${given}`);
      for (const prefix of AFFECTION_PREFIXES) {
        out.add(`${prefix}${given}`);
      }
    }
  }

  out.delete(canonical);
  return [...out];
}

/**
 * 把模型或正文里的称呼 `rawName` 归一到【角色固定外貌库】里的标准档案名。
 *
 * 规则:
 * 1. 已精确等于某个 `entry.name` → 原样返回。
 * 2. 命中唯一一个已建档角色的同源别称(如「风阿姨」「千华」→「风千华」) → 返回「风千华」。
 * 3. 若某个称呼同时命中多个已建档角色(例如库里同时有「风千华」与「风铃」,而称呼是「风姐」):
 *    - 优先看谁的 `entry.desc` 里显式写过这个称呼;
 *    - 仍无法唯一区分时**不强行归并**,原样返回 `rawName`,宁可不合也绝不把 A 的脸安到 B 头上。
 */
export function resolveCanonicalCharName(
  rawName: string,
  entries: readonly CharTagEntry[],
  facts: IdentityFact[] = currentIdentityFacts(),
): string {
  const trimmed = rawName.trim();
  if (!trimmed || !entries.length) return trimmed;
  for (const entry of entries) {
    if (entry.name.trim() === trimmed) return entry.name.trim();
  }

  const confirmed = entries.filter((entry) => characterAliases(entry.name, facts).includes(trimmed));
  if (confirmed.length === 1) return confirmed[0].name.trim();
  if (confirmed.length > 1) return trimmed;
  const matched: CharTagEntry[] = [];
  for (const entry of entries) {
    const aliases = candidateAliasesForEntry(entry, facts);
    if (aliases.includes(trimmed)) {
      // A shared surname plus a title is not a unique identity, especially across genders.
      const title =
        /老师|先生|女士|师兄|师姐|师弟|师妹|公子|少爷|夫人|阿姨|叔叔|姐姐|哥哥|妹妹|弟弟|师尊|掌门|长老|前辈|道友/;
      if (
        title.test(trimmed) &&
        !(
          entry.desc.includes(trimmed) &&
          /又名|别名|也叫|称呼|叫她|叫他|also known|alias|aka/i.test(entry.desc)
        )
      )
        continue;
      matched.push(entry);
      continue;
    }
    // 兼容括号注明形态,如「风阿姨(风千华)」「风千华（风阿姨）」
    const canonical = entry.name.trim();
    if (
      canonical &&
      (trimmed.includes(`(${canonical})`) ||
        trimmed.includes(`（${canonical}）`) ||
        trimmed.startsWith(`${canonical}(`) ||
        trimmed.startsWith(`${canonical}（`))
    ) {
      matched.push(entry);
    }
  }

  if (matched.length === 1) return matched[0].name.trim();
  if (matched.length > 1) {
    const byDesc = matched.filter((entry) => entry.desc && entry.desc.includes(trimmed));
    if (byDesc.length === 1) return byDesc[0].name.trim();
  }
  return trimmed;
}

/**
 * 扫描本段正文中实际出现的已建档角色别称/尊称/简称。
 *
 * 只返回「唯一指向某一个已建档角色」的别称,供提示词层直接点名告诉模型:
 * 「正文里的『风阿姨』就是档案里的『风千华』,统一用『风千华』并照抄她的外貌与服装」。
 */
export function findCharAliases(entries: readonly CharTagEntry[], text: string): CharAliasHit[] {
  if (!entries.length || !text.trim()) return [];
  const facts = currentIdentityFacts();
  const existingNames = new Set(entries.map((e) => e.name.trim()).filter(Boolean));
  const byEntry = new Map<string, string[]>();

  for (const entry of entries) {
    const canonical = entry.name.trim();
    if (!canonical) continue;
    const hits: string[] = [];
    for (const alias of candidateAliasesForEntry(entry, facts)) {
      if (existingNames.has(alias)) continue;
      if (!text.includes(alias)) continue;
      // 单字名+常见字(如「小雪」的「阿雪」可以,但避免被更长的词误包含时先确认唯一归属)
      if (resolveCanonicalCharName(alias, entries, facts) !== canonical) continue;
      hits.push(alias);
    }
    if (hits.length) {
      // 长词优先展示(如「风阿姨」排在「风姨」前),每角色最多列 4 个最常用的
      hits.sort((a, b) => b.length - a.length);
      byEntry.set(canonical, hits.slice(0, 4));
    }
  }

  return [...byEntry.entries()].map(([name, aliases]) => ({ name, aliases }));
}

/**
 * 对模型输出的 `images[].characters` 做角色名归一与固定外貌字段兜底。
 *
 * 解决两个实际痛点:
 * 1) 模型在 `characters[].name` 里写了正文别称(如「风阿姨」),导致查不到「风千华」的服装现状账本,
 *    下一楼读回 `<characters>` 时也认不出是「风千华」;
 * 2) 模型因为正文叫她「风阿姨」,误把她当成未建档称谓或漏抄了「风千华」档案里的核心外貌
 *    (发色 hair / 瞳色 eyes / 年龄段 age / 体型 body / 同人身份 fandom),导致生出来的图换了一张脸。
 */
export function normalizePlanCharacters(
  images: Array<{ characters?: Array<{ name: string; tag: string; nl?: string }> }>,
  entries: readonly CharTagEntry[],
  excludedNames: ReadonlySet<string> = new Set(),
): void {
  if (!entries.length) return;
  const byName = new Map(entries.map((entry) => [entry.name.trim(), entry]));

  for (const image of images) {
    for (const character of image.characters ?? []) {
      if (excludedNames.has(character.name)) continue;
      const rawName = character.name.trim();
      if (!rawName) continue;
      const canonical = resolveCanonicalCharName(rawName, entries);
      const wasAlias = canonical !== rawName;
      if (wasAlias) {
        character.name = canonical;
      }
      const entry = byName.get(canonical);
      if (!entry) continue;
      character.tag = ensureEntryAppearanceInCharacterTag(character.tag, entry, wasAlias);
    }
  }
}

/** 提取发色/瞳色核心词(如 `long black hair` → `black hair`, `purple eyes` → `purple eyes`)用于判断是否已写。 */
function hasCoreFeature(tagLower: string, fieldVal: string, kind: 'hair' | 'eyes'): boolean {
  const clean = fieldVal.trim().toLowerCase();
  if (!clean) return true;
  if (tagLower.includes(clean)) return true;
  const regex = kind === 'hair' ? /\b([a-z]+\s+hair)\b/ : /\b([a-z]+\s+eyes)\b/;
  const match = clean.match(regex);
  if (match && tagLower.includes(match[1])) return true;
  return false;
}

/**
 * 确保角色块 `tag` 中带有档案规定的核心固定外貌(fandom / age / hair / eyes / skin / body / extra)。
 *
 * - 当模型原本写的是别称(`wasAlias === true`)且自己瞎编了冲突的发色/瞳色时,先把冲突的发色/瞳色剥掉再补档案值;
 * - 当档案字段在 `character.tag` 中缺失时,按标准顺序补在主体词(`girl`/`boy`)之后,保证同一角色无论被怎么称呼,
 *   送去生图的固定外貌 tag 永远一致。
 */
function ensureEntryAppearanceInCharacterTag(rawTag: string, entry: CharTagEntry, wasAlias: boolean): string {
  const tag = rawTag.trim();
  if (!tag) return tag;

  const hair = entry.fields.hair.trim();
  const eyes = entry.fields.eyes.trim();
  const age = entry.fields.age.trim();
  const skin = entry.fields.skin.trim();
  const body = entry.fields.body.trim();
  const extra = entry.fields.extra.trim();
  const fandom = entry.fields.fandom.trim();

  // 同人纯标签模式(hair/eyes/skin/body 全空、只靠 fandom 决定长相):只保 fandom
  const isFandomOnly = Boolean(fandom && !hair && !eyes && !skin && !body);

  let segments = tag
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let lower = segments.join(', ').toLowerCase();

  const missingHair = Boolean(hair && !hasCoreFeature(lower, hair, 'hair'));
  const missingEyes = Boolean(eyes && !hasCoreFeature(lower, eyes, 'eyes'));

  // 若是因为别称(如「风阿姨」)导致模型没抄档案、自己乱写了别的发色/瞳色,剔除乱写的发色/瞳色词组
  if (wasAlias && (missingHair || missingEyes)) {
    segments = segments.filter((seg) => {
      const s = seg.toLowerCase();
      if (
        missingHair &&
        /\bhair\b/.test(s) &&
        !/\b(?:ornament|ribbon|clip|band|pin|tie|flower|bow|grabbing|pulling|holding|brushing|tucking)\b/.test(
          s,
        )
      ) {
        return false;
      }
      if (
        missingEyes &&
        /\beyes\b/.test(s) &&
        !/\b(?:closed|half-closed|narrowed|wide|rolling|covering|teary|crying|looking|eye contact)\b/.test(s)
      ) {
        return false;
      }
      return true;
    });
    lower = segments.join(', ').toLowerCase();
  }

  const toInsert: string[] = [];
  const pushMissing = (fieldValue: string) => {
    for (const part of fieldValue
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const partLower = part.toLowerCase();
      if (!lower.includes(partLower)) {
        toInsert.push(part);
        lower = `${lower}, ${partLower}`;
      }
    }
  };

  if (fandom && !lower.includes(fandom.toLowerCase())) {
    segments.unshift(fandom);
    lower = segments.join(', ').toLowerCase();
  }

  if (!isFandomOnly) {
    if (age) pushMissing(age);
    if (hair && !hasCoreFeature(lower, hair, 'hair')) pushMissing(hair);
    if (eyes && !hasCoreFeature(lower, eyes, 'eyes')) pushMissing(eyes);
    if (skin) pushMissing(skin);
    if (body && (wasAlias || missingHair || missingEyes)) pushMissing(body);
    if (extra && (wasAlias || missingHair || missingEyes)) pushMissing(extra);
  }

  if (!toInsert.length) return segments.join(', ');

  // 插在 fandom 与 girl/boy 主体词之后,动作与服装之前
  let insertAt = 0;
  for (let i = 0; i < Math.min(segments.length, 3); i++) {
    const s = segments[i].toLowerCase();
    if (
      (fandom && s === fandom.toLowerCase()) ||
      /^(?:\d+)?(?:girl|girls|boy|boys|woman|women|man|men|female|male|mature female|young adult|teenager|child)$/.test(
        s,
      )
    ) {
      insertAt = i + 1;
    }
  }
  segments.splice(insertAt, 0, ...toInsert);
  return segments.join(', ');
}

/** 档案侧参与比对的字段:只取长期不变的外形,outfit 会把「今天穿了什么」也算进相似度。 */
// 写成字面量而不是 CHAR_TAG_FIELDS.filter:characterIdentity 在模块顶层 import 本文件,
// 而本文件又 import charTags,成环时求值顺序会让 CHAR_TAG_FIELDS 还是 undefined。
const LOOK_FIELDS: CharTagField[] = ['hair', 'eyes', 'body', 'extra', 'skin'];

function entryLookText(entry: CharTagEntry): string {
  return LOOK_FIELDS.map((field) => entry.fields[field] ?? '')
    .concat(entry.raw)
    .filter(Boolean)
    .join(', ');
}

/**
 * 在已建档角色里找与这段正文外形重合的人。
 *
 * 阈值与素材库同口径(三维起且无冲突),并且要求命中的维度里**至少含发色或瞳色**——
 * 光靠「精灵、巨乳、有痣」也够三维,但那可以是任意一个精灵巨乳角色,认错人比认不出更糟。
 */
export function findCharReuse(entries: readonly CharTagEntry[], text: string): CharReuse[] {
  const bodyLook = scanLook(text);
  if (!bodyLook.size) return [];
  const found: CharReuse[] = [];
  for (const entry of entries) {
    if (!entry.name.trim()) continue;
    const look = compareLook(bodyLook, scanLook(entryLookText(entry)));
    if (!isLookPin(look)) continue;
    if (!look.dimensions.includes('hairColor') && !look.dimensions.includes('eyeColor')) continue;
    found.push({
      name: entry.name,
      dimensions: look.dimensions.map((dimension) => LOOK_DIMENSION_LABEL[dimension]).join('、'),
      matched: look.matched,
    });
  }
  found.sort((a, b) => b.matched - a.matched || a.name.localeCompare(b.name));
  return found;
}

/**
 * 渲染成注入块。空数组返回空串(不占上下文)。
 *
 * 同时承载两类「同一人别拆成两个人」的强约束:
 * 1) 外形对上的已建档角色;
 * 2) 正文中用别称/尊称/简称(如「风阿姨」「千华」)指代的已建档角色(如「风千华」)。
 */
export function buildCharReuseBlock(
  reuse: readonly CharReuse[],
  aliases: readonly CharAliasHit[] = [],
): string {
  const sections: string[] = [];

  if (aliases.length) {
    const aliasLines = aliases.map(
      (item) =>
        `- 正文中的「${item.aliases.join('」「')}」即已建档角色「${item.name}」本人：不是新角色，更不是【一次性】角色！在思考块、角色块名称与 tag/nl 中必须一律写成档案原名「${item.name}」（严禁写「${item.aliases[0]}」），并逐字照抄「${item.name}」的固定外貌与【服装现状】。`,
    );
    sections.push(
      ['【本段正文同人异称归并】[同一角色不同称呼，严禁换脸或当成别人]', ...aliasLines].join('\n'),
    );
  }

  if (reuse.length) {
    const lines = reuse.map((item) => `- ${item.name}（发色/瞳色等逐项对上：${item.dimensions}）`);
    sections.push(
      [
        '【本段正文已对上的建档角色】[不要重新编脸]',
        '下面这些角色在库里有档案,而且正文写的发色、瞳色、体形、种族与档案逐项一致。用法:',
        '- 正文这一段写的就是他们本人:直接照抄档案字段画,不要另写一套外貌,也不要在 changes 里再输出 field:"new"。',
        '- 只有正文明确写了与档案不同的改动(换发型、变老、受伤留疤),才用 field:"set" 改对应的那一项;没写就一个字都不要改。',
        ...lines,
      ].join('\n'),
    );
  }

  return sections.join('\n\n');
}
