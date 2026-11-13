import type { CharTagEntry } from '@/state/charTags';
import { DRAW_WORTHY } from './fallbackImage';
import { mentionIndexes } from './femaleCast';

/**
 * 这一楼值不值得为它花钱分析。
 *
 * 现实痛点：多楼层批量出图时，用户根本不知道哪一楼有女角色出场，插件却为一楼
 * 「他点了根烟」照样上传一次完整的历史 + 正文给规划模型，既慢又费 token，最后
 * 还因为「没有女性主体」被丢掉。
 *
 * 判据刻意**宽松**：只要正文里出现任何女性线索就照常分析。宁可多花一次钱，
 * 也不要因为判据太紧漏掉一楼该出的图——漏图比多花 token 更难被用户接受。
 *
 * @param entries 本楼可用的角色档（用来认「晚晴」这种对库名「林晚晴」的简称）
 */
export function hasFemaleSignal(
  source: string,
  femaleNames: readonly string[] = [],
  entries: readonly CharTagEntry[] = [],
): boolean {
  const text = String(source ?? '');
  if (!text.trim()) return true; // 空正文交给后面的闸门处理,不在这里判
  // 「她」是最强的在场证据;「女」覆盖女子/女人/少女/美女/女仆等一切写法。
  // 英文楼层(翻译过的正文)用 she/her/woman/girl 兜住,别把整楼当纯男性跳过。
  if (/她|女|\b(?:she|her|hers|woman|women|girl|girls|lady|milf)\b/i.test(text)) return true;
  // 情欲描写即使没点名也值得试:这类楼层九成有人,只是用词绕。
  if (DRAW_WORTHY.test(text)) return true;
  // 已建档女性在本楼被提到(含「晚晴」这种简称)。
  return femaleNames.some((name) => mentionIndexes(text, name, entries).length > 0);
}

/** 供 runner 组装名单时复用:库里的女性 + 正文判定出的女性。 */
export function femaleSignalNames(entries: readonly CharTagEntry[], names: readonly string[]): string[] {
  return [...new Set([...entries.map((entry) => entry.name), ...names])];
}
