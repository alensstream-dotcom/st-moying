import {
  createCharTagNewOp,
  createCharTagRenameOp,
  createCharTagSetOp,
  normalizeCharAge,
  type CharTagAutoOp,
  type CharTagEntry,
  type CharTagField,
} from '@/state/charTags';
import { isMaleIdentity, type IdentityFact } from '@/state/characterIdentity';
import { femaleName } from './femaleCast';
import { isGenericCharacterName } from './genericName';
import { resolveCanonicalCharName } from './charReuse';
import { recoverProfileFields } from './profileRecovery';
import { bandFromName, diversifyLook } from './lookDiversity';
import type { ImageInsertion } from './protocol';

/**
 * 出图即建档。
 *
 * 用户的要求：只要画面里出了女角色，就立刻给她入角色库；这一刻还没有名字的
 * 也要先建一条「无名女子」占位，等后面剧情给出名字再把这条档案认领过去；
 * 档案一开始只有画面里的部分特征（比如只有发色+瞳色）也照常出图，后面补全
 * 时继续往同一条档案里写。
 *
 * 这条兜底放在模型 changes 之外，因为模型漏报 changes.new 是常态：它只负责
 * 画图，不负责维护数据库。这里直接从图片的角色块里榨出能确定的外貌特征，
 * 生成正常的 new op 写进本楼 delta，于是重放时和模型自己建档案走同一条路。
 */

/** 这些名字是称呼不是人名：给她们建占位档案，等真名出现再 rename（口径见 genericName.ts）。 */

export const PROVISIONAL_PREFIX = '无名女子';

export interface ImageProfileItem {
  op: CharTagAutoOp;
  sourceLine: number;
  charOffset: number;
}

export interface ImageProfileResult {
  items: ImageProfileItem[];
  notes: string[];
  /** 画面里用了别的称呼、但能归到已有档案的名字，交给上层持久化成别名。 */
  aliases: Array<[canonical: string, alias: string]>;
}

const SIGNATURE_FIELDS = ['hair', 'eyes', 'skin', 'body', 'extra'] as const;

/** 允许从画面补全的字段：外貌为主，服装交给服装账本。 */
const FILL_FIELDS: CharTagField[] = ['hair', 'eyes', 'skin', 'body', 'extra', 'age'];

function signature(fields: Record<string, string>): string[] {
  return SIGNATURE_FIELDS.map((key) => (fields[key] ?? '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

/** 两条档案能对上号：至少两个特征相同（只有零散一个特征时宁可新建）。 */
function sameLook(a: Record<string, string>, b: Record<string, string>): boolean {
  const left = new Set(signature(a));
  const right = signature(b);
  return right.length >= 2 && right.filter((token) => left.has(token)).length >= 2;
}

export function isProvisionalName(name: string): boolean {
  return name.trim().startsWith(PROVISIONAL_PREFIX);
}

/**
 * 从正文里找这个名字附近有没有年龄线索（「十二岁的少女」「三十多岁的女人」）。
 *
 * 建档时 age 是**体型锚唯一的开关**（见 `appearanceLock` 的骨架词）：模型写进角色 tag 的
 * 年龄词可遇不可求，绝大多数时候整条档案没有任何身高体量。留空就等着它每张图各画一个
 * 身高。所以先按正文就近猜，猜不到再落到中性档。
 */
const AGE_WORD =
  /(小女孩|儿童|幼女|萝莉|小学生|少女|女高中生|高中生|中学生|jk|年轻女性|大学生|成熟女性|熟女|人妻|少妇|三十多岁|四十多岁|四十岁|五十岁|老妇|老婆婆|奶奶|(?:\d|[一二三四五六七八九十]{1,3}|十[一二三四五六七八九]?|二十|三十|四十|五十)\s*(?:多)?\s*岁|young woman|young adult|mature female|teenager|child|elderly|old woman)/i;

function ageNear(text: string, name: string): string {
  if (!text || !name) return '';
  const at = text.indexOf(name);
  if (at < 0) return '';
  // 只取这句的前后一小段：整楼里别人的年龄不该算到她头上。
  const window = text.slice(Math.max(0, at - 24), Math.min(text.length, at + name.length + 24));
  const word = window.match(AGE_WORD)?.[0];
  if (!word) return '';
  const band = normalizeCharAge(chineseYears(word));
  // 只写「12 岁」时 normalizeCharAge 不会给出档位，而骨架词只认档位词——
  // 按岁数自己补一档，否则这条年龄等于白记。
  if (/\d+\s*岁/.test(band) && !/child|teenager|young adult|mature female/.test(band)) {
    const years = Number(band.match(/(\d+)\s*岁/)?.[1] ?? 0);
    // 档位边界按中文语感取：13 岁以下算儿童，20 岁以下少女，30 岁以下年轻女性，再往上成熟。
    const guess =
      years && years < 13 ? 'child' : years && years < 20 ? 'teenager' : years && years < 30 ? 'young adult' : 'mature female';
    return `${guess}, ${band}`;
  }
  return band;
}

/** 「十二岁」→「12岁」：归一表只认阿拉伯数字，中文数字要自己转。 */
const DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function chineseYears(text: string): string {
  return text.replace(/([一二两三四五六七八九十]{1,3})\s*(?:多)?\s*岁/g, (_, word: string) => {
    if (!word.includes('十')) return `${DIGITS[word] ?? 0}岁`;
    const [tens, ones] = word.split('十');
    const value = (tens ? (DIGITS[tens] ?? 0) : 1) * 10 + (ones ? (DIGITS[ones] ?? 0) : 0);
    return `${value}岁`;
  });
}

function provisionalIndex(entries: readonly CharTagEntry[]): number {
  let max = 0;
  for (const entry of entries) {
    if (!isProvisionalName(entry.name)) continue;
    const tail = Number(entry.name.trim().slice(PROVISIONAL_PREFIX.length));
    if (Number.isFinite(tail) && tail > max) max = tail;
  }
  return max;
}

export function ensureImageProfiles(
  images: readonly ImageInsertion[],
  entries: readonly CharTagEntry[],
  facts: IdentityFact[],
  floor: number,
  story: string,
  options: { locked?: ReadonlySet<string>; story?: string } = {},
): ImageProfileResult {
  const items: ImageProfileItem[] = [];
  const notes: string[] = [];
  const aliases: Array<[string, string]> = [];
  const text = options.story ?? story;
  const known = entries.map((entry) => entry.name.trim());
  const taken = new Set(known);
  /**
   * 本楼已经建过档的人。
   * `source` 存模型原始写的那套特征（用来判「是不是同一个无名女子」），
   * `fields` 存岔开之后真正落库的值（用来让下一个人避开）。
   */
  const created: Array<{ name: string; source: Record<string, string>; fields: Record<string, string> }> = [];
  /** 本楼已经用掉的占位名：一条占位档案只能被认领一次。 */
  const claimed = new Set<string>();
  const supplied = new Set<string>();
  let counter = provisionalIndex(entries);

  for (const image of images) {
    for (const character of image.characters) {
      const raw = (character.name ?? '').trim();
      if (!raw) continue;
      const canonical = resolveCanonicalCharName(raw, entries, facts);
      const existing = entries.find((entry) => entry.name.trim() === canonical);
      if (existing) {
        if (raw !== existing.name && !aliases.some((pair) => pair[1] === raw))
          aliases.push([existing.name, raw]);
        // 档案先建、形象后补：只填空白字段，绝不覆盖已有值，也不动用户手锁的档案。
        if (!options.locked?.has(existing.name) && existing.source !== 'manual') {
          const filled = recoverProfileFields(character.tag);
          // age 还要看正文：老档案普遍只建了头发眼睛，age 空着就永远没有体型锚。
          if (!filled.age?.trim()) {
            const guessed = ageNear(text, canonical);
            if (guessed) filled.age = guessed;
          }
          for (const field of FILL_FIELDS) {
            if (existing.fields[field]?.trim()) continue;
            const value = filled[field]?.trim();
            if (!value) continue;
            const key = `${existing.name}|${field}`;
            if (supplied.has(key)) continue;
            const op = createCharTagSetOp(
              existing.name,
              field,
              value,
              `第 ${floor} 楼出图补全形象`,
            );
            if (!op) continue;
            supplied.add(key);
            items.push({ op, sourceLine: image.sourceLine, charOffset: image.charOffset });
            notes.push(`${existing.name}: 补全 ${field}`);
          }
        }
        continue;
      }
      if (taken.has(canonical)) continue;
      if (isMaleIdentity(canonical, facts)) continue;
      if (
        /\b\d*boys?\b|\bmales?\b|\bmen\b/i.test(character.tag) &&
        !/\b\d*girls?\b|\bwomans?\b|\bfemales?\b/i.test(character.tag)
      )
        continue;
      if (options.locked?.has(canonical)) continue;

      const fields = recoverProfileFields(character.tag);
      const sex = fields.sex;
      const female =
        (/girl|female|woman|女/i.test(sex) && !/boy|male|man|男/i.test(sex)) ||
        femaleName(canonical, entries, facts, text) ||
        /\b\d*girls?\b|\bwoman\b|\bfemale\b/i.test(character.tag);
      if (!female) continue;

      const looksLikeName = !!canonical && !isGenericCharacterName(canonical);
      if (looksLikeName) {
        // 早先只按指代建过「无名女子」：外貌对得上就说明是同一个人，改名而不是新建第二条。
        // 一条占位档案只能被认领一次——同一楼里两个真名长得一样时，第二个再发一次
        // `rename 无名女子1` 会因为源名已经不存在而被 applyCharTagOps 静默跳过，
        // 结果她整楼都没有档案。
        const provisional = entries.find(
          (entry) =>
            isProvisionalName(entry.name) &&
            !claimed.has(entry.name) &&
            sameLook(entry.fields, fields),
        );
        if (provisional) {
          const op = createCharTagRenameOp(
            provisional.name,
            canonical,
            `第 ${floor} 楼出图时认出她就是先前的「${provisional.name}」`,
          );
          if (op) {
            claimed.add(provisional.name);
            taken.add(canonical);
            taken.add(provisional.name);
            items.push({ op, sourceLine: image.sourceLine, charOffset: image.charOffset });
            notes.push(`${provisional.name} → ${canonical}`);
            continue;
          }
        }
      }

      const name = looksLikeName ? canonical : `${PROVISIONAL_PREFIX}${(counter += 1)}`;
      if (taken.has(name)) continue;
      // 同一张楼里同一位无名女子可能出现在好几张图上：外貌对上了就并回刚才
      // 那条占位档案，别再建一堆「无名女子N」把形象拆散。
      if (!looksLikeName && created.some((item) => sameLook(item.source, fields))) continue;
      /**
       * 年龄必须落地，否则这条档案永远没有体型锚。
       *
       * 篡位顺序：模型写在角色 tag 里的 → 正文这个名字附近写的 → 名字里的称呼
       * （「阿姨/夫人/嫂子」本身就是年龄证据）→ 空的。猜不到就留空，绝不硬塞。
       */
      const age = fields.age?.trim() || ageNear(text, canonical) || bandFromName(canonical);
      // 新档的形象要和库里已有的女角色岔开，否则几个「没写长相的少女」会全是同一张脸。
      // 同一楼里**同批新建的人之间也要岔开**：只拿 entries 当参照时，两个本楼新角色
      // 谁都还没进库，于是都留着同一头黑发同一双蓝眼，同框就是双胞胎。
      // 只岔空着的与撞车的特征，正文写过的词一律不动。
      // 年龄段先定好再挑体型词：角色卡里叫「阿姨」的人不能分到 petite 这种儿童骨架词。
      const diverse = diversifyLook(
        { ...fields, ...(age ? { age } : {}) },
        [...entries, ...created],
        text,
        name,
      );
      if (diverse.notes.length) notes.push(`${name}: 形象错开 ${diverse.notes.join('；')}`);
      const op = createCharTagNewOp(
        {
          name,
          fields: {
            ...diverse.fields,
            sex: fields.sex?.trim() ? fields.sex : '1girl',
            ...(age ? { age } : {}),
          },
          raw: character.tag,
          nl: character.nl ?? '',
          source: 'ai',
          desc: looksLikeName
            ? `第 ${floor} 楼出图自动建档`
            : `第 ${floor} 楼出图自动建档：原文只写了「${canonical}」，先按画面特征占位，等真名出现再认领`,
        },
        '出图自动建档',
      );
      if (!op) continue;
      taken.add(name);
      // 记下**岔开之后**的字段：下一个角色要避开的正是上面真正写进去的值。
      created.push({ name, source: fields, fields: diverse.fields });
      items.push({ op, sourceLine: image.sourceLine, charOffset: image.charOffset });
      notes.push(`${name}: 出图自动建档`);
    }
  }
  return { items, notes, aliases };
}
