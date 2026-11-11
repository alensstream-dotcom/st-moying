import { getTagGenChannel } from '@/state/settings';
import { requestCompletion, requestViaMainApi } from '@/api/client';
import type { CharTagEntry } from '@/state/charTags';
import type { TargetSegment } from './clean';
import { acceptClothingChanges, parseClothingChanges, unreportedClothingActions, CLOTHING_PROTOCOL, type ClothingChange, type ClothingState } from './outfitTimeline';

/** One bounded event-only repair. Never selects scenes or rewrites identities. */
export async function repairClothingEvents(source: string, segments: TargetSegment[], before: ClothingState, entries: CharTagEntry[], changes: ClothingChange[], signal: AbortSignal, force = false) {
  const accepted = acceptClothingChanges(changes, source, before, entries);
  const missing = unreportedClothingActions(source, accepted.changes, entries, before);
  const issues = [...accepted.rejected, ...missing];
  if (!issues.length && !force) return accepted;
  if (force) issues.push('用户要求核对本图之前的衣物状态；发现错误时只补充有目标原文证据的事件，不能改变已确认款式。');
  const messages = [
    { role: 'system' as const, content: CLOTHING_PROTOCOL + '\n仅修复给定疑点，返回 JSON {outfitChanges:[]}。不输出图片、不改变镜头、不写长篇思考。只补充遗漏或纠正被拒绝事件，不重复已接受事件。timeline=main 或 memory:P起始编号，回忆与现实隔离。引文只能从目标正文复制；无依据时返回空数组，不能编造证据。主体不确定则跳过。' },
    { role: 'user' as const, content: JSON.stringify({ before: [...before.values()], characters: entries.map(e => e.name), accepted: accepted.changes, issues: issues.slice(0, 16), target: segments.map(s => ({ position: s.id, text: s.text })) }) },
  ];
  try {
    const channel = getTagGenChannel();
    const options = { signal, source: '衣物事件局部核对（不重选剧情）' };
    const reply = channel ? await requestCompletion(channel, messages, options) : await requestViaMainApi(messages, options);
    const raw = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/g, '');
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const additions = parseClothingChanges(parsed.outfitChanges, segments, source);
    const key = (c: ClothingChange) => JSON.stringify([c.name, c.timeline || 'main', c.operation, c.sourceLine, c.charOffset, c.pieces]);
    const known = new Set(accepted.changes.map(key));
    const result = acceptClothingChanges([...accepted.changes, ...additions.filter(c => !known.has(key(c)))].sort((a,b) => a.sourceLine-b.sourceLine || a.charOffset-b.charOffset), source, before, entries);
    // A malformed repair cannot discard already validated facts.
    if (accepted.changes.some(c => !result.changes.some(r => key(r) === key(c)))) return accepted;
    result.rejected.push(...unreportedClothingActions(source, result.changes, entries, before).map(x => '待核对的穿脱动作：' + x));
    const correctedNames = new Set(result.changes.filter(c => !known.has(key(c))).map(c => c.name));
    result.rejected.push(...accepted.rejected.filter(note => ![...correctedNames].some(name => note.startsWith(name))));
    if (!additions.length && !force) result.rejected.push(...missing);
    return result;
  } catch (error) {
    if (signal.aborted) throw error;
    return { ...accepted, rejected: [...issues, '局部核对未完成；保留已确认事件，不重跑整楼。'] };
  }
}
