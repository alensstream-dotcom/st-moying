import { rerollLook as rerollFields } from '@/autoTag/lookDiversity';
import { resolveCanonicalCharName } from '@/autoTag/charReuse';
import {
  CHAR_TAG_FIELD_LABELS,
  charTagLib,
  findCharTag,
  recomputeCharTags,
  upsertCharTag,
  type CharTagEntry,
  type CharTagField,
} from '@/state/charTags';
import { appearancePolicy, setAppearancePolicy } from '@/state/appearancePolicy';
import { lookSettings, saveLook } from '@/state/characterStudio';

/**
 * 重掷一个角色的形象。
 *
 * 用户的诉求是「随机出来的样子我不喜欢，但剧情写死的部分不许动」：
 * 所以这里只换**剧情没点名**的外貌轴（发色、发型、瞳色、眼形、体型、发饰），
 * 正文写过的那几轴原样保留，掷完也不会和库里另一个女主撞脸。
 *
 * 已经固定过形象（appearancePolicy 为 manual/fandom）的角色，policy 里那份
 * 字段是真正的下发源（appearanceLock 用它覆盖档案），所以必须同步改；
 * 不同步的话档案换了、出图还是老样子——这正是「点了固定就再也改不动」的坑。
 */
export interface RerollSummary {
  name: string;
  /** 人话描述，直接进 toast。 */
  text: string;
  /** 有没有真的改动档案。 */
  changed: boolean;
}

export function rerollCharacterLook(rawName: string, story = ''): RerollSummary {
  const entries = charTagLib.entries;
  const name = entries.length ? resolveCanonicalCharName(rawName, entries) : rawName.trim();
  const entry = findCharTag(name);
  if (!entry) throw new Error(`角色「${rawName}」还没有档案，先固定一次形象再来重掷`);

  const others: Array<Pick<CharTagEntry, 'fields'>> = entries.filter((item) => item.name !== name);
  const result = rerollFields(entry.fields, others, story, name);
  if (!result.changes.length)
    throw new Error(
      `「${name}」的外貌在正文里都写死了，没有可以重掷的分类${result.kept.length ? `（${result.kept.map((field) => CHAR_TAG_FIELD_LABELS[field as CharTagField] ?? field).join('、')}）` : ''}`,
    );

  const next: CharTagEntry = {
    ...entry,
    fields: { ...entry.fields, ...result.fields },
  };
  if (!upsertCharTag(next, name, { recordChanges: true })) throw new Error('形象保存失败');

  /**
   * 重掷过的轴必须写进 appearancePolicy，否则这次重掷对出图毫无影响。
   *
   * 原因是出图端（`src/generate.ts` 的 storyFrame 分支）会拿本楼生图时存下的
   * `frame.appearance` 快照再锁一次外貌——那是**上一套**形象。唯一能压过快照的
   * 是 policy：`applyAppearancePolicies` 用 `{...e.fields, ...p.fields}` 覆盖。
   * 所以哪怕这个角色原本没有 policy（纯剧情跟随），重掷之后也要落一条 manual，
   * 只含被重掷的那几轴；没重掷的轴（正文写死的）仍然跟着剧情走。
   */
  const policy = appearancePolicy(name);
  const merged = { ...(policy?.fields ?? {}) };
  for (const change of result.changes)
    merged[change.field as CharTagField] = next.fields[change.field as CharTagField];
  /**
   * mode 也要跟着走：原本是 `story`（显式声明「完全跟随剧情」）时，重掷必须把它
   * 提成 `manual`，否则 `applyAppearancePolicies` 在 `mode === 'story'` 时原样
   * 返回档案，这次重掷又被丢掉。fandom 保留（同人形象本来就该由 fandom 主导，
   * 这里补的只是它没锁的那几轴）。
   */
  const mode = !policy || policy.mode === 'story' ? 'manual' : policy.mode;
  setAppearancePolicy(name, { ...(policy ?? { fields: {} }), mode, fields: merged }, next);
  recomputeCharTags();

  /**
   * 定妆图是「上一套外貌」的照片，重掷之后它就和档案对不上了。
   *
   * 这里不动定妆图本身（那是用户存过的照片，删掉就找不回来），只把参考图发送关掉：
   * 否则角色页勾着「自动携带定妆图」，出图端却因指纹不符静默跳过，用户看不出原因。
   * 想要参考图，重新点一次「固定形象」即可把新外貌和新照片一起存下来。
   */
  const look = lookSettings(name);
  const pausedReference = look.reference;
  if (look.reference) saveLook(name, { ...look, reference: false });

  const text = result.changes
    .map(
      (change) =>
        `${CHAR_TAG_FIELD_LABELS[change.field as CharTagField] ?? change.field} ${change.from} → ${change.to}`,
    )
    .join('；');
  const kept = result.kept.length
    ? `（正文写死、未改动：${result.kept.map((field) => CHAR_TAG_FIELD_LABELS[field as CharTagField] ?? field).join('、')}）`
    : '';
  const referenceNote = pausedReference ? '；定妆图与旧样貌不符，参考图发送已暂停' : '';
  return { name, text: `${name}：${text}${kept}${referenceNote}`, changed: true };
}
