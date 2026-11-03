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
