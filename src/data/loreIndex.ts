/**
 * 素材库召回层(loreIndex):把「正文 + 设置」压成一段能直接塞进 prompt 的候选清单。
 *
 * 分层:
 * - wardrobe.ts / poseBank.ts / faceBank.ts 只存数据(款式指纹);
 * - loreMatch.ts 只做打分排序;
 * - 本文件负责「召回策略 + 渲染成给模型看的文字」,是唯一被 autoTag 调用的入口。
 *
 * 三处策略,都是冲着「生成结果雷同」这个现象定的:
 *
 * 1. **单类命中时放大配额。** 正文只写了「黑丝」,匹配结果必然全落在 hosiery 一类;
 *    这时如果还按「每类 2 条」截断,模型看到的候选就只有 2 条,还是回到老路。
 *    所以命中类别越少,单类配额越大(1 类 → 6 条,2 类 → 3 条,≥3 类 → 2 条),
 *    保证「一个泛词」也能拿到足够多的差异款。
 * 2. **候选只用于「照抄」,不用于「参考」。** 块头写死:库里有对应条目时必须用库里的版本,
 *    不得替换成更泛的词。否则模型会把 `lace-trimmed sheer black pantyhose` 又简化回 `pantyhose`,
 *    整个库白建。
 * 3. **没命中就不注入。** 宁可少一块上下文,也不要塞一堆无关条目把正文挤到后面去。
 */

import { WARDROBE_CATEGORIES, WARDROBE_ITEMS } from '@/data/wardrobe';
import { POSE_CATEGORIES, POSE_ITEMS } from '@/data/poseBank';
import { BODY_PRESETS, FACE_PRESETS, FANDOM_PRESETS } from '@/data/faceBank';
import { BODY_EXTRA, FACE_EXTRA, FANDOM_EXTRA } from '@/data/faceExtra';
import { scoreLore } from '@/data/loreMatch';
import { customPoses, customWardrobe } from '@/data/customLore';
import type {
  BodyPreset,
  FacePreset,
  FandomPreset,
  LoreItemBase,
  NsfwLevel,
  PoseEntry,
  WardrobeItem,
} from '@/data/loreTypes';

export interface LoreOptions {
  /** 允许出现的最高 NSFW 档;默认 3。 */
  maxNsfw?: NsfwLevel;
  /** 服装候选条数上限,默认 8。 */
  wardrobeLimit?: number;
  /** 姿势候选条数上限,默认 6。 */
  poseLimit?: number;
  /** 是否召回人物外貌指纹;默认关(同人 tag 只在明确作品时才该用)。 */
  faces?: boolean;
  /** 角色气质词,用于给对味条目加权。 */
  vibes?: string[];
}

export interface LoreHit<T extends LoreItemBase> {
  item: T;
  score: number;
  /** 命中的触发词,按长度降序;渲染进候选行,便于解释「为什么它在这里」。 */
  hits: string[];
  category: string;
}

export interface LoreCandidates {
  wardrobe: LoreHit<WardrobeItem>[];
  poses: LoreHit<PoseEntry>[];
  faces: LoreHit<FaceCard>[];
}

/** 人物指纹的三种来源:脸型 / 体型 / 同人角色。 */
export type FaceCardKind = 'face' | 'body' | 'fandom';
export type FaceCard = (FacePreset | BodyPreset | FandomPreset) & { kind: FaceCardKind };

/**
 * 三类人物预设拼成一张表。
 *
 * 为什么不直接把 three tables 塞进 pickDiverse:命中词不同来源不同(「清冷」是脸型词,
 * 「精灵」是同人词),拼在一起后 categoryOf 用 kind 区分,配额就自然按三类分。
 */
export const FACE_CARDS: FaceCard[] = [
  ...[...FACE_PRESETS, ...FACE_EXTRA].map(preset => ({ ...preset, kind: 'face' as const })),
  ...[...BODY_PRESETS, ...BODY_EXTRA].map(preset => ({ ...preset, kind: 'body' as const })),
  ...[...FANDOM_PRESETS, ...FANDOM_EXTRA].map(preset => ({ ...preset, kind: 'fandom' as const })),
];

const WARDROBE_CATEGORY_LABEL = new Map<string, string>(WARDROBE_CATEGORIES.map(c => [c.id, c.label]));
const POSE_CATEGORY_LABEL = new Map<string, string>(POSE_CATEGORIES.map(c => [c.id, c.label]));

/**
 * 按「命中类别数」自适应配额挑选:分数降序,同类别累计不超过 perCat。
 * 纯函数,便于单测与 UI 复用。
 */
export function pickDiverse<T extends LoreItemBase>(
  items: readonly T[],
  text: string,
  categoryOf: (item: T) => string,
  options: { limit: number; maxNsfw?: NsfwLevel; vibes?: string[] },
): LoreHit<T>[] {
  const maxNsfw = options.maxNsfw ?? 3;
  const vibes = options.vibes ?? [];
  // limit 0 表示「这一类不要」,必须直接返回空:否则下面的循环会在 push 后才 break,
  // 仍然漏出一条出去(设置页把条数调到 0 时就会多出一块不该有的候选)。
  if (!(options.limit > 0)) return [];
  const scored: LoreHit<T>[] = [];
  for (const item of items) {
    if (item.nsfw > maxNsfw) continue;
    const { score, hits } = scoreLore(item, text, vibes);
    if (score > 0) scored.push({ item, score, hits, category: categoryOf(item) });
  }
  if (!scored.length) return [];
  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  const categories = new Set(scored.map(hit => hit.category));
  const perCat = categories.size <= 1 ? 6 : categories.size === 2 ? 3 : 2;
  const used = new Map<string, number>();
  const picked: LoreHit<T>[] = [];
  for (const hit of scored) {
    const count = used.get(hit.category) ?? 0;
    if (count >= perCat) continue;
    used.set(hit.category, count + 1);
    picked.push(hit);
    if (picked.length >= options.limit) break;
  }
  return picked;
}

/** 服装 + 姿势 + (可选)人物外貌一次召回。正文为空/无命中时对应数组为空。 */
export function collectLoreCandidates(text: string, options: LoreOptions = {}): LoreCandidates {
  const body = (text ?? '').trim();
  if (!body) return { wardrobe: [], poses: [], faces: [] };
  return {
    wardrobe: pickDiverse(allWardrobeItems(), body, item => item.category, {
      limit: options.wardrobeLimit ?? 8,
      maxNsfw: options.maxNsfw,
      vibes: options.vibes,
    }),
    poses: pickDiverse(allPoseItems(), body, item => item.category, {
      limit: options.poseLimit ?? 6,
      maxNsfw: options.maxNsfw,
      vibes: options.vibes,
    }),
    faces: options.faces
      ? pickDiverse(FACE_CARDS, body, card => card.kind, {
          limit: 4,
          maxNsfw: options.maxNsfw,
          vibes: options.vibes,
        })
      : [],
  };
}

/** 一行的渲染:`- [分类] 名字: tags`(命中词与 note 追加在后面,不占主行)。 */
function renderLine<T extends LoreItemBase>(
  hit: LoreHit<T>,
  categoryLabel: string,
  extra?: string,
): string {
  const hits = hit.hits.slice(0, 3).join('、');
  const note = (hit.item.note ?? '').trim();
  const tail = [hits ? `命中：${hits}` : '', note].filter(Boolean).join('；');
  const head = `- [${categoryLabel}] ${hit.item.name}: ${hit.item.tags}`;
  return tail ? `${head}${extra ? ` | ${extra}` : ''}\n  （${tail}）` : head;
}

/**
 * 渲染注入 prompt 的候选块。返回空串表示不需要注入。
 *
 * 块的措辞是有意的:它不请求模型「参考」,而是要求「照抄」——因为这个协议里
 * tag 是字段值,不是创作。候选行自带命中词,模型能自己核对是哪句正文触发的。
 */
export function buildLoreBlock(text: string, options: LoreOptions = {}): string {
  const { wardrobe, poses, faces } = collectLoreCandidates(text, options);
  if (!wardrobe.length && !poses.length && !faces.length) return '';
  const parts: string[] = [];

  if (wardrobe.length) {
    const lines = wardrobe.map(hit =>
      renderLine(hit, WARDROBE_CATEGORY_LABEL.get(hit.category) ?? hit.category, hit.item.slot),
    );
    parts.push(
      [
        '【服装候选库】[candidate-only; copy one tag set verbatim]',
        '正文里的衣着词已经命中下列款式指纹。用法:',
        '- 同一角色同一部位只挑一条,挑中的 `tags` 原样照抄进角色的 tag 串(允许按正文删掉明显不符的部件,但不许换成更泛的词,例如不许把 `lace-trimmed sheer black pantyhose` 简化成 `pantyhose`)。',
        '- 正文明确写了款式而库里有对应条目时,用库里的版本,不要凭印象另写一套。',
        '- **上了身就锁死**:一个角色在本楼选定一套之后,本楼**所有图**都必须逐字复用同一串服装 tag。候选有多条是为了让你挑最贴正文的那一条,不是让每张图各挑一条。多张图之间的差异用姿势、机位、景别和衣物状态词(`unzipped`/`slipped down`/`wet`/`pulled aside`/`torn`)表现,不靠换衣服。',
        '- 只有正文在两张图之间明确写了换装、脱下或衣物被毁,才允许换成另一条候选,并从那一张起生效;正文没写就换,读者会看见同一段剧情里她在莫名其妙地换衣服。',
        '',
        ...lines,
      ].join('\n'),
    );
  }

  if (poses.length) {
    const lines = poses.map(hit => {
      const meta = [hit.item.camera ? `机位 ${hit.item.camera}` : '', hit.item.direction ?? '']
        .filter(Boolean)
        .join(' / ');
      return renderLine(hit, POSE_CATEGORY_LABEL.get(hit.category) ?? hit.category, meta);
    });
    parts.push(
      [
        '【姿势与机位候选库】[candidate-only; copy one tag set verbatim]',
        '正文的亲密动作已经命中下列姿势指纹。用法:',
        '- 每条都包含「体位 + 肢体关系 + 机位」;照抄整组才能保住构图,只抄体位名会退回最普通的画面。',
        '- 机位一栏是该体位最不容易画崩人体的机位;正文没写机位时优先采用它。',
        '- 同一张图只用一条候选;多张图之间应体现姿势推进(前戏 → 正体位 → 高潮 → 事后),不要并列堆叠。',
        '',
        ...lines,
      ].join('\n'),
    );
  }

  if (faces.length) {
    const lines = faces.map(hit => {
      const extra =
        hit.item.kind === 'fandom'
          ? ((hit.item as FandomPreset).franchise ?? '')
          : hit.item.kind === 'body'
            ? ((hit.item as BodyPreset).archetype ?? '')
            : '';
      return renderLine(hit, FACE_KIND_LABEL[hit.item.kind], extra);
    });
    parts.push(
      [
        '【人物外貌候选库】[candidate-only; copy one tag set verbatim]',
        '正文的外形描写已经命中下列指纹。用法:',
        '- 每条是一整套「脸型 + 眼型 + 睫毛 + 唇形 + 关键痣/颊色」。整组照抄,不要只抽一两个词,单抽必然退回大众脸。',
        '- `同人角色` 只在正文明确指向该作品的该角色时使用;不确定就改用 `脸型` 或 `体型` 条,不要硬套。',
        '- 已建档角色仍以【角色固定外貌库】为准;候选只用于新建档、或补该角色库里缺的字段。',
        '',
        ...lines,
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}

const FACE_KIND_LABEL: Record<FaceCardKind, string> = {
  face: '脸型',
  body: '体型',
  fandom: '同人角色',
};

/** UI 用:按分类分组(服装)。 */
export function wardrobeByCategory(): Map<string, WardrobeItem[]> {
  const map = new Map<string, WardrobeItem[]>();
  for (const item of allWardrobeItems()) {
    const list = map.get(item.category);
    if (list) list.push(item);
    else map.set(item.category, [item]);
  }
  return map;
}

/** UI 用:按分类分组(姿势)。 */
export function posesByCategory(): Map<string, PoseEntry[]> {
  const map = new Map<string, PoseEntry[]>();
  for (const item of allPoseItems()) {
    const list = map.get(item.category);
    if (list) list.push(item);
    else map.set(item.category, [item]);
  }
  return map;
}

/** UI 用:分类展示名。 */
export function wardrobeCategoryLabel(id: string): string {
  return WARDROBE_CATEGORY_LABEL.get(id) ?? id;
}

export function poseCategoryLabel(id: string): string {
  return POSE_CATEGORY_LABEL.get(id) ?? id;
}

/**
 * 内置 + 自定义的完整候选池。
 *
 * 为什么做成函数而不是常量:自定义条目存在 localStorage,导入/删除后池子必须立刻变;
 * 常量快照会让「刚导入的款式这一轮还用不上」。
 */
export function allWardrobeItems(): WardrobeItem[] {
  return [...WARDROBE_ITEMS, ...customWardrobe()];
}

export function allPoseItems(): PoseEntry[] {
  return [...POSE_ITEMS, ...customPoses()];
}
