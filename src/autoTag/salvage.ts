/**
 * 半截 JSON 的抢救。
 *
 * 为什么要救而不是重试:截断的典型形态是「写完了前三张图,第四张写到一半被掐断」。
 * 旧实现把整份丢掉重发,于是那三张已经完成的图白写,还多花一次请求;重试若再被掐,
 * 整楼就一张图都没有。而这三张本身是完好的——缺的只是后面的收尾括号。
 *
 * 做法:**从后往前找一个还能闭合的位置**,把尾巴补成合法 JSON 再解析。先保整张图,
 * 其次才是重试。能救回 n 张就发 n 张,比「一张都不发 + 再赌一次」好得多。
 *
 * 只处理结构,不猜内容:被截掉的那半张图直接丢,不复原它的字段。
 */

/** 找到第一个 `{` 起、可闭合的 JSON 对象文本;救不出返回 null。 */
export function salvageJsonObject(raw: string): string | null {
  const text = raw ?? '';
  const start = text.indexOf('{');
  if (start < 0) return null;
  const body = text.slice(start);

  // 扫描一次:记下每个「对象在数组里刚闭合」的位置(优先救这些位置),同时维护开括号栈。
  // 另外记下每个「在 images 元素对象内部」的逗号位置:一条完整元素都没有时,只能靠它
  // 把最后那半张图补成合法对象——position 与 tag 是协议里的前两个键,截断时通常已经写完,
  // 保住它就是保住这一楼唯一的一张图。
  const cuts: Array<{ at: number; closers: string }> = [];
  const commas: Array<{ at: number; closers: string }> = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] !== ch) break; // 括号错位:后面的都不可信
      stack.pop();
      // 刚从 3 层回到 2 层 = images[] / changes[] 里刚写完一个完整元素,是最该救的位置。
      if (ch === '}' && stack.length === 2) {
        cuts.push({ at: i + 1, closers: [...stack].reverse().join('') });
      }
      continue;
    }
    // 3 层 = 正处在一个 image 对象内部:这个逗号之前是完整的键值对,可以在此切断并补括号。
    if (ch === ',' && stack.length === 3) {
      commas.push({ at: i, closers: [...stack].reverse().join('') });
    }
  }

  // 从后往前试:越靠后救回的图越多。每次都补上此刻栈里欠的收尾括号。
  for (let c = cuts.length - 1; c >= 0; c -= 1) {
    const candidate = body.slice(0, cuts[c].at) + cuts[c].closers;
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        if (Array.isArray(object.images) && object.images.length) return candidate;
      }
    } catch {
      // 这个位置也闭合不了,再往前试。
    }
  }

  // 一条完整元素都没写出来:退而修尾巴。截停位置常常正好在某个值写完、下一个键还没开始时,
  // 把尾巴补成合法对象就能保住唯一的那张图。
  // 顺序:先试「就地收尾」(丢掉悬空的逗号/冒号,字符串没闭合就补引号),再退到逗号切点
  // ——每往前退一步,留下的字段就更少。
  const tailCuts: string[] = [];
  if (stack.length >= 2) {
    let trimmed = body;
    if (escaped) trimmed = trimmed.slice(0, -1);
    trimmed = trimmed.replace(/[,:]\s*$/, '');
    if (inString && !escaped) trimmed += '"';
    tailCuts.push(trimmed + [...stack].reverse().join(''));
    for (let c = commas.length - 1; c >= 0; c -= 1) {
      tailCuts.push(body.slice(0, commas[c].at) + commas[c].closers);
    }
  }

  // 只有带上 position 与 tag 才值得留(解析器缺这两个键会直接拒)。
  for (const candidate of tailCuts) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        const images = object.images;
        if (!Array.isArray(images) || !images.length) continue;
        const tail = images[images.length - 1] as Record<string, unknown> | undefined;
        if (tail && typeof tail === 'object' && tail.position && tail.tag) return candidate;
      }
    } catch {
      // 继续往前试。
    }
  }
  return null;
}
