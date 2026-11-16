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

/**
 * 「引句不在正文里」检查：`after` 必须是本楼正文的逐字引用。
 *
 * 为什么要单独查：`parseImagePlan` 定位不到时会给一个 position 兜底（这是为了让
 * 标点/换行的细微差异不至于丢整张图），可副作用是「模型自己编了一个画面」也能混进来。
 * 实测第 12 楼正文只有李斌一个人在书房计划，模型却给了「温岚坐在沙发上喝奶茶」——
 * 引句是编的，位置兜底成 P 编号，图照样落库。这里把「引句找不到」当成可纠错误：
 * 还有重试次数时让模型重挑真正写在正文里的那一句，重试到底再放行（不整张丢弃）。
 */
export function unanchoredAfters(
  images: Array<{ afterQuote?: string }>,
  targetText: string,
): string[] {
  const norm = (value: string) =>
    value.replace(/\s+/g, '').replace(/["'“”‘’「」『』…—\-~、,，。.!！?？；;:：]/g, '');
  const body = norm(targetText);
  const bad: string[] = [];
  for (const image of images) {
    const quote = String(image.afterQuote ?? '').trim();
    if (!quote) continue;
    if (!body.includes(norm(quote))) bad.push(quote.slice(0, 24));
  }
  return bad;
}

export function unanchoredQuoteNote(quotes: string[]): string {
  return `<quote_retry>
上一版有 ${quotes.length} 张图的 after 引句在这楼正文里找不到（${quotes.join(' / ')}）。
after 必须是**本楼正文里逐字存在**的一句话：那句话读完之后，画面里需要的事实刚好全部成立。
- 不许自己造句、不许拿上一楼或前情里的句子顶替、不许把别处的描写拼过来。
- 如果这一楼确实没有能支撑那张图的句子，就换一个正文里真实存在的瞬间；实在没有可画的，减少张数。
直接从 <thinking> 开始，不要解释。
</quote_retry>`;
}
