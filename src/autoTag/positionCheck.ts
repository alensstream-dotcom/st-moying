/**
 * 落位重复检查：多张图挤在同一个可选位置上。
 *
 * 位置 ID 是「段尾」——同一段里塞两张图，两张画的几乎一定是同一个瞬间的两格
 * （同一个人、同一套衣服、同一处接触），出来的效果就是「一张图渲了两遍」。
 * 协议本身不查重（同位置在单槽重写里是合法的），所以这条必须由这里兜住。
 *
 * 只在**可选位置够用**时才要求互不相同：席位数还没正文段数多时，硬要求不重复
 * 等于逼模型把图挤到不成立的段上去，反而更差。
 */

export interface PositionPlan {
  position: string;
}

/**
 * 返回出现重复的位置 ID（保持首次出现顺序，去重）。
 *
 * @param images 已解析的插入项（至少含 position）
 * @param positionCount 目标正文可选位置的总数
 */
export function duplicatePositions(images: PositionPlan[], positionCount: number): string[] {
  // 位置不够分：允许重叠，不算错。
  if (positionCount < images.length) return [];
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const image of images) {
    const position = String(image.position ?? '');
    if (!position) continue;
    if (seen.has(position)) {
      if (!dup.includes(position)) dup.push(position);
      continue;
    }
    seen.add(position);
  }
  return dup;
}

/**
 * 「两张图落在同一段」时追加给模型的补救指令。
 *
 * 措辞要点：不是让它删图，也不是让它换景别——只把其中一张挪到别的段上去，
 * 画面内容与张数都保留。只说「别重复」模型会删掉一张，白白少一根图。
 */
export function duplicatePositionNote(positions: string[]): string {
  return `<position_retry>
上一版有 ${positions.length} 个位置被两张图同时占用（${positions.join('、')}）。同一段里放两张，画出来会是同一个瞬间拍两遍。
改法：张数不变、画面内容不变，只把多出来的那张挪到**另一个段尾**——挑能让这个画面所需事实刚好完整成立、且与另一张隔开一段正文的位置。
- 两张图之间至少要隔若干段正文，隔着同一个人物的不同动作才行；不要挪到相邻的下一段，那还是同一个瞬间。
- 位置一律写成目标正文里标出的 P 编号，不许自编。
直接从 <thinking> 开始，不要解释。
</position_retry>`;
}

/**
 * 检查是否把两张图放在了紧挨着的前后两句话（如 P5 与 P6）上。
 *
 * 仅在正文句子总数充裕（positionCount >= max(8, images.length * 4)）时生效：
 * 短楼层本来就没几句话，允许相邻；长楼层（如 10～30 句）里选 P5 和 P6，
 * 几乎必然是同一自然段同一动作的前后半句，插出来两张图紧贴在一起且画面雷同。
 */
export function adjacentPositions(
  images: PositionPlan[],
  positionCount: number,
): Array<[string, string]> {
  if (images.length < 2) return [];
  if (positionCount < Math.max(8, images.length * 4)) return [];
  const nums: number[] = [];
  for (const image of images) {
    const m = /^P(\d+)$/i.exec(String(image.position ?? '').trim());
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && !nums.includes(n)) nums.push(n);
  }
  nums.sort((a, b) => a - b);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i + 1] - nums[i] === 1) {
      pairs.push([`P${nums[i]}`, `P${nums[i + 1]}`]);
    }
  }
  return pairs;
}

/**
 * 「两张图挤在相邻两句话」时追加给模型的补救指令。
 */
export function adjacentPositionNote(pairs: Array<[string, string]>): string {
  const list = pairs.map(([a, b]) => `${a} 与 ${b}`).join('、');
  return `<position_retry>
上一版把多张图放在了紧挨着的前后两句话上（${list}）。由于 P 编号是按单句切分的，相邻两句属于同一个自然段里的同一个瞬间，连放两张会导致插图紧贴且画面雷同。
改法：张数不变，把其中一张改选到本楼另一处独立的剧情节点（如前段的场景建立/对峙、中段的动作转折、或后段的情绪高潮/余韵），让两张图之间至少隔开 2 句以上正文，并相应更新那张图的画面概括与 tag。
直接从 <thinking> 开始，不要解释。
</position_retry>`;
}
