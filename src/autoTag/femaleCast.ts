import { readCounts } from './castCheck';
import { candidateAliasesForEntry, resolveCanonicalCharName } from './charReuse';
import {
  femaleStoryFact,
  isMaleIdentity,
  type IdentityFact,
} from '@/state/characterIdentity';
import type { CharTagEntry } from '@/state/charTags';
import type { ImageInsertion } from './protocol';
import type { TargetSegment } from './clean';

/**
 * 画面里必须有女性主体。
 *
 * 生成模型偶尔会交「只有男主 / 只有背景」的图：正文这一段在写男人或环境，
 * 它就把那一格画成没有女主的画面。这种图对用户毫无价值，还会把整楼的
 * 代入感切断。提示词层已经写了「画面主体永远是女性」，但那只是建议：
 * 走 reader 的 headless 路径没有人工复核，模型偶尔照样交空镜。
 *
 * 这里做确定性兜底：
 * 1. 图里已经出现女性角色（库性别 / 身份事实 / 正文女性指代）→ 放行；
 * 2. 该段正文里出现了女性库角色 / 只有「她」这类女性指代 → 把最近的那位
 *    补进 characters，并把 1girl 补进 base tag；
 * 3. 既没有女性角色也没有女性指代 → 这一格本来就不该出图，交给上层丢弃。
 */

const FEMALE_SEX_RE = /girl|female|woman|女/i;
const MALE_SEX_RE = /boy|male|man|男/i;
/** 只要句中只有「她」这类女性指代，就说明这一段有女性在场。 */
export const FEMALE_CUE_RE =
  /她|少女|女人|女子|女孩|姑娘|女修|女士|小姐|女仆|母亲|妻子|姐姐|妹妹|夫人|太太/;

export function sexSaysFemale(entry?: CharTagEntry): boolean {
  const sex = (entry?.fields?.sex ?? '').trim();
  if (!sex) return false;
  return FEMALE_SEX_RE.test(sex) && !MALE_SEX_RE.test(sex);
}

export function sexSaysMale(entry?: CharTagEntry): boolean {
  const sex = (entry?.fields?.sex ?? '').trim();
  if (!sex) return false;
  return MALE_SEX_RE.test(sex) && !FEMALE_SEX_RE.test(sex);
}

/**
 * 这个名字在库/身份事实/正文里是否属于女性。
 * 先归一化到库里的规范名，再用「库里的性别」压过「正文代词」：库里写明男性
 * 的角色不会因为一句「她」被误判成女性。
 */
export function femaleName(
  name: string,
  entries: readonly CharTagEntry[],
  facts: IdentityFact[],
  story: string,
): boolean {
  const raw = name.trim();
  if (!raw) return false;
  const canonical = resolveCanonicalCharName(raw, entries, facts);
  const entry = entries.find((item) => item.name.trim() === canonical);
  if (entry && sexSaysMale(entry)) return false;
  if (entry && sexSaysFemale(entry)) return true;
  if (isMaleIdentity(canonical, facts) || isMaleIdentity(raw, facts)) return false;
  return Boolean(femaleStoryFact(canonical, story) || femaleStoryFact(raw, story));
}

/** 本楼真正能进画面的女性名单（库 + 身份事实 + 正文指代）。 */
export function femaleCastNames(
  entries: readonly CharTagEntry[],
  facts: IdentityFact[],
  story: string,
  extra: readonly string[] = [],
): string[] {
  const names = new Set<string>();
  for (const name of [...entries.map((entry) => entry.name), ...extra]) {
    if (femaleName(name, entries, facts, story)) names.add(name);
  }
  return [...names];
}

/** 图里是否已经有女性：命名角色，或 base tag 里的人数。 */
export function imageHasFemale(
  image: Pick<ImageInsertion, 'tag' | 'characters'>,
  femaleNames: readonly string[],
  entries: readonly CharTagEntry[],
  facts: IdentityFact[],
  story: string,
): boolean {
  if ((image.characters ?? []).some((character) => femaleNames.includes(character.name))) return true;
  if ((image.characters ?? []).some((character) => femaleName(character.name, entries, facts, story)))
    return true;
  return readCounts(image.tag ?? '').girls > 0;
}

/**
 * 这个名字在正文里出现过的全部位置。
 *
 * 只认全名不够：正文九成写「晚晴」「晚晴小姐」，库名却是「林晚晴」。字面比对
 * 会判成「这一段没有女性」→ 整张图被丢掉，正是「明明有女角色却出背景图」。
 */
export function mentionIndexes(
  text: string,
  name: string,
  entries: readonly CharTagEntry[],
): number[] {
  if (!text || !name) return [];
  const entry = entries.find((item) => item.name.trim() === name);
  const needles = new Set<string>([name]);
  if (entry) for (const alias of candidateAliasesForEntry(entry)) if (alias) needles.add(alias);
  const hits: number[] = [];
  for (const needle of needles)
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) hits.push(at);
  return hits.sort((left, right) => left - right);
}

/** 候选女性条目按「离这一格最近的一次点名」排序。 */
function closestMention(
  items: readonly { name: string }[],
  story: string,
  at: number,
  entries: readonly CharTagEntry[],
): { name: string }[] {
  const ranked = items
    .map((item) => {
      const hits = mentionIndexes(story, item.name, entries);
      const before = hits.filter((hit) => hit <= at).pop();
      // 以被点名处到这一格的距离排，不是以「文中位置前后」排：后面很远才提一句的人
      // 不该压过紧挨着这一格的人。没有更早提及时退到其后第一次提名（距离为正）。
      const index = before ?? hits.find((hit) => hit > at) ?? -1;
      return { item, index, distance: index < 0 ? Infinity : Math.abs(index - at) };
    })
    .filter((hit) => hit.index >= 0)
    .sort((left, right) => left.distance - right.distance);
  return ranked.map((hit) => hit.item);
}


export interface FemaleCastOutcome {
  /** 保留下来的图片（可能少了几张）。 */
  images: ImageInsertion[];
  /** 被跳过的图，形如 `P7（没有女性角色在场）`。 */
  dropped: string[];
  /** 自动补进画面的女性，形如 `P7 补入「风千华」`。 */
  attached: string[];
}

export interface FemaleCastOptions {
  /** true 时把没有女性主体的图整张丢掉；false（单槽重写）只尝试补人。 */
  drop?: boolean;
}

/** 图片的全局偏移。charOffset 是「行内偏移」，直接拿来和正文比会永远落在文章开头。 */
function absoluteAt(story: string, image: ImageInsertion): number {
  const lines = story.split('\n');
  const line = Math.max(0, Math.min(lines.length - 1, image.sourceLine ?? 0));
  let at = 0;
  for (let i = 0; i < line; i += 1) at += (lines[i] ?? '').length + 1;
  return Math.max(0, Math.min(story.length, at + (image.charOffset ?? 0)));
}

/**
 * 保证每张图至少有一个女性主体。返回新的图片数组与原数组顺序一致。
 */
export function ensureFemaleSubjects(
  images: readonly ImageInsertion[],
  segments: readonly TargetSegment[],
  entries: readonly CharTagEntry[],
  facts: IdentityFact[],
  story: string,
  options: FemaleCastOptions = {},
): FemaleCastOutcome {
  const segmentText = new Map(segments.map((segment) => [segment.id, segment.text]));
  const names = femaleCastNames(entries, facts, story);
  const dropped: string[] = [];
  const attached: string[] = [];
  const kept: ImageInsertion[] = [];
  const drop = options.drop !== false;

  for (const image of images) {
    if (imageHasFemale(image, names, entries, facts, story)) {
      kept.push(image);
      continue;
    }
    const text = segmentText.get(image.position) ?? '';
    // 之前直接拿 charOffset 当全局位置：那只是行内偏移，几乎总是很小的数，
    // closestMention 于是总挑「整楼最前面被点名的人」——补进来的往往不是这一段的人。
    const at = absoluteAt(story, image);
    const namedInText = names.filter((name) => mentionIndexes(text, name, entries).length > 0);
    let pick = namedInText.length
      ? closestMention(
          namedInText.map((name) => ({ name })),
          story,
          at,
          entries,
        )[0]?.name
      : '';
    if (!pick && FEMALE_CUE_RE.test(text)) {
      // 正文只写「她」：从整楼里她最近一次被点名的地方补。
      const candidates = names.map((name) => ({ name }));
      pick = closestMention(candidates, story, at, entries)[0]?.name ?? '';
    }
    const entry = entries.find((item) => item.name.trim() === pick);
    if (!pick) {
      dropped.push(`${image.position}（这一段没有女性角色在场）`);
      if (!drop) kept.push(image);
      continue;
    }
    const character = {
      name: entry?.name ?? pick,
      tag: '1girl',
      nl: 'a woman',
    };
    image.characters = [...(image.characters ?? []), character];
    if (readCounts(image.tag ?? '').girls === 0) {
      image.tag = `${image.tag ? `${image.tag}, ` : ''}1girl`;
    }
    attached.push(`${image.position} 补入「${character.name}」`);
    kept.push(image);
  }

  return { images: kept, dropped, attached };
}
