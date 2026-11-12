import {
  createCharTagNewOp,
  createCharTagRenameOp,
  createCharTagSetOp,
  type CharTagAutoOp,
  type CharTagEntry,
  type CharTagField,
} from '@/state/charTags';
import { isMaleIdentity, type IdentityFact } from '@/state/characterIdentity';
import { femaleName } from './femaleCast';
import { resolveCanonicalCharName } from './charReuse';
import { recoverProfileFields } from './profileRecovery';
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

/** 这些名字是称呼不是人名：给她们建占位档案，等真名出现再 rename。 */
const GENERIC_NAME_RE =
  /^(?:她|她们|少女|女子|女孩|女生|姑娘|女人|女修|女士|小姐|夫人|太太|女仆|侍女|女官|女学生|女教师|女医生|护士|路人|陌生女子|陌生人|那女人|这女人|某女|无名氏|女人家)$/;

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
  const created: Array<{ name: string; fields: Record<string, string> }> = [];
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

      const looksLikeName = !!canonical && !GENERIC_NAME_RE.test(canonical);
      if (looksLikeName) {
        // 早先只按指代建过「无名女子」：外貌对得上就说明是同一个人，改名而不是新建第二条。
        const provisional = entries.find(
          (entry) => isProvisionalName(entry.name) && sameLook(entry.fields, fields),
        );
        if (provisional) {
          const op = createCharTagRenameOp(
            provisional.name,
            canonical,
            `第 ${floor} 楼出图时认出她就是先前的「${provisional.name}」`,
          );
          if (op) {
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
      if (!looksLikeName && created.some((item) => sameLook(item.fields, fields))) continue;
      const op = createCharTagNewOp(
        {
          name,
          fields: { ...fields, sex: fields.sex?.trim() ? fields.sex : '1girl' },
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
      if (!looksLikeName) created.push({ name, fields });
      items.push({ op, sourceLine: image.sourceLine, charOffset: image.charOffset });
      notes.push(`${name}: 出图自动建档`);
    }
  }
  return { items, notes, aliases };
}
