/**
 * 候选瞬间的打分与筛选。
 *
 * 背景：以前由模型直接决定「这楼画哪几句」，它挑完就进提示词。实测的两种坏结果是
 * 「她根本不在场的那句被挑来当落点」（凭空造景）和「一格两图是同一瞬间拍两遍」。
 *
 * 现在让模型在同一次回答里多写几行候选（不额外发请求），由代码按封闭的五项打分排序：
 *   可见性（这句有没有具体可见的东西）、剧情价值（是不是转折）、
 *   新信息（跟最近画过的比是不是重复）、可画性（要的东西是否都在画面里）、
 *   不确定性（模型自己标的不确定）。
 * 这些分数只用于模型候选的排序。整楼模式还会逐句核对人物是否在场和画面动作。
 */
export interface Candidate {
  /** 目标段编号，形如 P3。 */
  position: string;
  /** 这一格的画面，中文一句话，只用于日志与复查。 */
  action: string;
  evidence?: string;
  visible: number;
  value: number;
  novelty: number;
  drawable: number;
  unsure: number;
}

const CLAMP = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(3, Math.round(v))) : 1);

const num = (raw: unknown): number => CLAMP(typeof raw === 'number' ? raw : Number(raw));

/** 五项加权：可见与剧情价值最高，重复与不确定扣分。 */
export function scoreCandidate(candidate: Candidate): number {
  return (
    3 * CLAMP(candidate.visible) +
    3 * CLAMP(candidate.value) +
    2 * CLAMP(candidate.novelty) +
    CLAMP(candidate.drawable) -
    3 * CLAMP(candidate.unsure)
  );
}

/** 解析候选数组；位置不合法的整条丢掉（宁缺不猜）。 */
export function parseCandidates(raw: unknown, positions: ReadonlySet<string>): Candidate[] {
  if (!Array.isArray(raw)) return [];
  const list: Candidate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const position = String(record.position ?? '').trim().toUpperCase();
    if (!positions.has(position)) continue;
    if (list.some((item) => item.position === position)) continue;
    list.push({
      position,
      action: String(record.action ?? record.what ?? record.beat ?? '').trim().slice(0, 80),
      ...(typeof record.evidence === 'string' && record.evidence.trim() ? { evidence: record.evidence.trim().slice(0, 300) } : {}),
      visible: num(record.visible),
      value: num(record.value ?? record.story),
      novelty: num(record.novelty ?? record.fresh),
      drawable: num(record.drawable ?? record.paintable),
      unsure: num(record.unsure ?? record.uncertain),
    });
  }
  return list;
}

/** 按分数从高到低，同分保持模型给的顺序。 */
export function rankCandidates(list: readonly Candidate[]): Candidate[] {
  return list
    .map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.candidate);
}

/** 低分门槛：低于它的候选不配当落点（纯心理、纯对话、看不清的）。 */
export const CANDIDATE_FLOOR = 6;

/**
 * 用候选表筛掉不该画的图。
 * 只在模型给了候选时生效——没给候选说明它没走这条路，此时保持原样，不擅自删图。
 */
export function pruneByCandidates<T extends { position: string }>(
  images: readonly T[],
  candidates: readonly Candidate[],
  maxImages: number,
): { images: T[]; dropped: Array<{ position: string; score: number | null }> } {
  if (!candidates.length || !images.length) return { images: [...images], dropped: [] };
  const scored = new Map(rankCandidates(candidates).map((candidate) => [candidate.position, scoreCandidate(candidate)]));
  const kept: T[] = [];
  const dropped: Array<{ position: string; score: number | null }> = [];
  for (const image of images) {
    const score = scored.get(image.position) ?? null;
    // 候选表里没有这个位置：模型自己跳出了候选层，按「没论证过的画面」丢掉。
    if (score === null || score < CANDIDATE_FLOOR) {
      dropped.push({ position: image.position, score });
      continue;
    }
    kept.push(image);
  }
  // 超出上限时优先留高分：候选表已经排好序，这里按分数回填顺序。
  if (kept.length > maxImages) {
    const order = new Map([...scored.keys()].map((position, index) => [position, index]));
    kept.sort((a, b) => (order.get(a.position) ?? 99) - (order.get(b.position) ?? 99));
    for (const extra of kept.splice(maxImages)) dropped.push({ position: extra.position, score: scored.get(extra.position) ?? null });
  }
  return { images: kept, dropped };
}
