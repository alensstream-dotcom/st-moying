import { normalizeOrientation, type Orientation } from '@/backends/size';
import type { TargetSegment } from '@/autoTag/clean';
import { parseClothingChanges, type ClothingChange } from './outfitTimeline';
import { parseIdentityClaims, type IdentityClaim } from '@/state/characterIdentity';
import { FORBIDDEN_SUBTAG, serializeImageTag } from '@/st/imageTagRegex';
import {
  CHAR_TAG_FIELDS,
  normalizeCharAge,
  type CharTagField,
  type CharTagHistoryField,
} from '@/state/charTags';

export interface ImageCharacterPrompt {
  name: string;
  tag: string;
  nl: string;
}

export interface ImageInsertion {
  /** 模型选择的目标正文位置 ID。 */
  position: string;
  /** 位置 ID 对应的原始物理行(0-based，仅插件内部使用)。 */
  sourceLine: number;
  /**
   * 该位置对应的句子在**原始物理行内**的结束偏移(不含)。0 = 未知,退回行尾插入。
   * injectImageTags 用它把 tag 插到那句话后面,而不是整段后面(见 clean.ts 的 TargetSegment)。
   */
  charOffset: number;
  /** danbooru 短 tag 部分(必填)。 */
  tag: string;
  /** 自然语言部分(可空;ComfyUI「生成自然语言」开启时由模型一并输出)。 */
  nl: string;
  /** 本画面动态负面 tag(可空;仅在 ComfyUI 工作流使用 %negative_prompt% 时要求模型输出)。 */
  negative: string;
  characters: ImageCharacterPrompt[];
  /** 画幅方向:模型只判横/竖,具体像素由用户在后端面板配置。漏给/乱给一律降级竖屏。 */
  size: Orientation;
}

export interface ImagePlan {
  costumeContexts?: unknown;
  identities?: IdentityClaim[];
  outfitChanges?: ClothingChange[];
  images: ImageInsertion[];
  /** AI 报告的角色库变更(建档/字段更新);调用方负责落库。 */
  changes: CharChange[];
}

/** AI 输出的单条角色变更(宽松形状;解析后字段全部合法才保留)。 */
export interface CharChange {
  evidence?: string;
  charOffset?: number;
  name: string;
  /** 'new' = 建档;其余为字段名/整串/自然语言。 */
  field: CharTagHistoryField;
  value: string;
  /** 自然语言外貌句(new 建档时可附带)。 */
  nl?: string;
  reason: string;
  /**
   * 永久变化开始生效的位置。建档(new)不受此约束——角色的固定外貌是本楼全程
   * 成立的事实,不是「从某处开始」的变化,这里只作记录与排序用。
   */
  position: string;
  /** position 对应的原始物理行(0-based,仅插件内部使用)。 */
  sourceLine: number;
}

const HISTORY_FIELDS: ReadonlySet<string> = new Set([
  'fandom',
  'sex',
  'age',
  'hair',
  'eyes',
  'skin',
  'body',
  'extra',
  'outfit',
  'new',
  'raw',
  'nl',
]);

interface SourceLine {
  start: number;
  text: string;
  eol: string;
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const newline = /\r\n|\n|\r/g;
  let start = 0;
  for (let match = newline.exec(source); match; match = newline.exec(source)) {
    lines.push({ start, text: source.slice(start, match.index), eol: match[0] });
    start = match.index + match[0].length;
  }
  lines.push({ start, text: source.slice(start), eol: '' });
  return lines;
}

function jsonObjects(raw: string): string[] {
  const cleaned = raw.replace(/<think(?:ing)?\b[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
  const candidates: string[] = [];
  for (const match of cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1].trim());
  candidates.push(cleaned);

  for (let start = 0; start < cleaned.length; start += 1) {
    if (cleaned[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < cleaned.length; index += 1) {
      const char = cleaned[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        candidates.push(cleaned.slice(start, index + 1));
        break;
      }
    }
  }
  return candidates;
}

function parseObject(raw: string): Record<string, unknown> {
  let firstObject: Record<string, unknown> | null = null;
  for (const candidate of jsonObjects(raw)) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        if (Array.isArray(object.images)) return object;
        firstObject ??= object;
      }
    } catch {
      // 尝试下一个候选 JSON 块。
    }
  }
  if (firstObject) return firstObject;
  throw new Error('AI 没有返回可解析的 JSON 对象');
}

/** tag / nl / negative 内容里不允许出现的子标签字面量（口径见 st/imageTagRegex.ts）。 */

function sanitizeContent(value: unknown, field: string, index: number): string {
  const text = typeof value === 'string' ? value.trim().replace(/[\r\n]+/g, ' ') : '';
  if (text && FORBIDDEN_SUBTAG.test(text)) {
    throw new Error(`images[${index}].${field} 不得包含 bbi_image/tag/nl/negative/size 标签`);
  }
  return text;
}

function sanitizeCharacters(value: unknown, imageIndex: number): ImageCharacterPrompt[] {
  if (!Array.isArray(value)) return [];
  const characters: ImageCharacterPrompt[] = [];
  for (let index = 0; index < value.length && characters.length < 32; index += 1) {
    const raw = value[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    try {
      const name = sanitizeContent(item.name, `characters[${index}].name`, imageIndex);
      const tag = sanitizeContent(item.tag ?? item.prompt, `characters[${index}].tag`, imageIndex);
      const nl = sanitizeContent(item.nl, `characters[${index}].nl`, imageIndex);
      if (name && tag) characters.push({ name, tag, nl });
    } catch {
      // A malformed character prompt must not discard an otherwise valid image plan.
    }
  }
  return characters;
}

function sanitizePosition(value: unknown, index: number): string {
  const position = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!position) throw new Error(`images[${index}].position 不能为空`);
  if (!/^P\d+$/.test(position)) throw new Error(`images[${index}].position 必须是目标正文中的 P编号`);
  return position;
}

/**
 * 解析并严格校验模型给出的“目标位置 ID + 提示词”列表。tag 必填;nl/negative 选填。
 * size 一律容忍:归一不出就当竖屏——为它抛错会白白吃掉 runner 的重试次数。
 * 图片超过上限时本地硬截断;少于用户明确设置的下限则抛错,交给 runner 重试。
 * changes 全程宽容:单条坏就丢弃,绝不连累 images——角色档案漏一条只是这个角色本轮
 * 没锚定,为它作废整次输出会连图一起没有,那是更坏的结果。
 */
export function parseImagePlan(
  raw: string,
  segments: TargetSegment[],
  minImages: number,
  maxImages: number,
): ImagePlan {
  const parsed = parseObject(raw);
  if (!Array.isArray(parsed.images)) throw new Error('AI 返回的 JSON 缺少 images 数组');
  const normalizedMax = Math.max(1, Math.floor(Number(maxImages)) || 1);
  const normalizedMin = Math.min(normalizedMax, Math.max(0, Math.floor(Number(minImages)) || 0));
  const positions = new Map(segments.map((segment) => [segment.id, segment.sourceLine]));
  // 行内落位用:同一行可能切出多个句子级段,故按 id 取整段而不是只取行号。
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));

  const images: ImageInsertion[] = [];
  for (let index = 0; index < parsed.images.length; index += 1) {
    const item = parsed.images[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`images[${index}] 必须是对象`);
    }
    const entry = item as Record<string, unknown>;
    const position = sanitizePosition(entry.position ?? entry.id, index);
    const segment = segmentById.get(position);
    if (!segment) {
      throw new Error(`images[${index}].position=${position} 不在目标正文可选位置中`);
    }
    const sourceLine = segment.sourceLine;
    // 兼容模型按旧协议/习惯返回 prompt 键的情况
    const tag = sanitizeContent(entry.tag ?? entry.prompt, 'tag', index);
    if (!tag) throw new Error(`images[${index}].tag 不能为空`);
    const nl = sanitizeContent(entry.nl, 'nl', index);
    const negative = sanitizeContent(entry.negative ?? entry.negative_prompt, 'negative', index);
    const characters = sanitizeCharacters(entry.characters, index);
    // 兼容模型按习惯返回 orientation / aspect 键
    const size = normalizeOrientation(entry.size ?? entry.orientation ?? entry.aspect);
    images.push({
      position,
      sourceLine,
      charOffset: segment.charOffset ?? 0,
      tag,
      nl,
      negative,
      characters,
      size,
    });
  }

  const limitedImages = images.slice(0, normalizedMax);
  if (limitedImages.length < normalizedMin) {
    throw new Error(`AI 返回了 ${limitedImages.length} 张图片，少于设置的最少图片数 ${normalizedMin}`);
  }
  return {
    images: limitedImages,
    changes: parseChanges(parsed.changes, positions, segmentById),
    costumeContexts: parsed.costumeContexts,
    outfitChanges: parseClothingChanges(parsed.outfitChanges, segments),
    identities: parseIdentityClaims(parsed.identities),
  };
}

/**
 * 解析变化生效位置。建档(new)缺位置不是错——它本就全楼生效;
 * 解析不出时回落到首个位置,只用于排序。
 */
function parsePosition(
  value: unknown,
  positions: Map<string, number>,
): { position: string; sourceLine: number } | null {
  const position = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^P\d+$/.test(position)) return null;
  const sourceLine = positions.get(position);
  if (sourceLine === undefined) return null;
  return { position, sourceLine };
}

function firstPosition(positions: Map<string, number>): { position: string; sourceLine: number } {
  for (const [position, sourceLine] of positions) return { position, sourceLine };
  return { position: '', sourceLine: 0 };
}

/**
 * 建档字段:hair 与 eyes 是二次元身份锚点,缺任一条则该条建档不可用(调用方丢弃)。
 *
 * age 在此归一成规范词(`teenager`、`mature female`);模型常直接抄正文里的
 * 「刚毕业的大学生」,不归一会让每张图各猜一个年龄。
 */
function parseNewFields(raw: Record<string, unknown>): string | null {
  const fields: Partial<Record<CharTagField, string>> = {};
  for (const field of CHAR_TAG_FIELDS) {
    const value = raw[field];
    const text = typeof value === 'string' ? value.trim().replace(/[\r\n]+/g, ' ') : '';
    if (text) fields[field] = text;
  }
  if (fields.age) fields.age = normalizeCharAge(fields.age);
  if (!fields.hair || !fields.eyes) return null;
  return JSON.stringify(fields);
}

function parseChanges(
  raw: unknown,
  positions: Map<string, number>,
  segments?: Map<string, TargetSegment>,
): CharChange[] {
  if (!Array.isArray(raw)) return [];
  const out: CharChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const fieldRaw = typeof o.field === 'string' ? o.field.trim() : '';
    if (!name || !HISTORY_FIELDS.has(fieldRaw)) continue;
    const field = fieldRaw as CharTagHistoryField;
    const parsedPosition = parsePosition(o.position ?? o.at, positions);
    // 建档全楼生效,位置只作记录,缺失就回落首位;永久变化必须知道从哪生效,位置坏 = 丢弃
    if (!parsedPosition && field !== 'new') continue;
    const { position, sourceLine } = parsedPosition ?? firstPosition(positions);
    let value = typeof o.value === 'string' ? o.value.trim() : '';
    const fields =
      o.fields && typeof o.fields === 'object' && !Array.isArray(o.fields)
        ? (o.fields as Record<string, unknown>)
        : null;
    if (field === 'new') {
      const parsedFields = fields ? parseNewFields(fields) : null;
      if (!parsedFields) continue;
      value = parsedFields;
    }
    const nl = typeof o.nl === 'string' ? o.nl.trim() : '';
    const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
    if (!value && !nl) continue;
    out.push({
      name,
      field,
      value,
      nl: nl || undefined,
      reason,
      position,
      sourceLine,
      charOffset: segments?.get(position)?.charOffset ?? 0,
      evidence: typeof o.evidence === 'string' ? o.evidence.trim().slice(0, 1600) : undefined,
    });
  }
  return out;
}

/**
 * 保持原文及原换行符不变，把 tag 插进模型选中的位置。
 *
 * 落位口径(0.4.1 起):优先**行内句子末尾**(charOffset)，其次整行行尾。
 * 旧实现一律插在物理行之后，于是「一行好几句话」的正文里，一张配第三句的图
 * 会掉到整段末尾——事后描写之后，看起来就是图和剧情对不上。现在只要该位置
 * 知道自己在行内的结束偏移，tag 就钉在那句话后面，并把该行剩余内容接在 tag 之后
 * 换行继续，读起来就是图夹在两段叙事中间。
 */
/** A block image must never be foster-parented above an HTML table or
 * swallowed by a code fence. Coordinates are UTF-16 offsets in the original text. */
function safeImageOffset(source: string, offset: number): number {
  let at = offset;
  // Fences can contain arbitrary HTML-like text, so also handle their source span.
  const lines = sourceLines(source);
  const fenceRanges: Array<{ start: number; end: number }> = [];
  let fence: { marker: string; size: number; start: number } | undefined;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (!m) continue;
    if (!fence) fence = { marker: m[1][0], size: m[1].length, start: line.start };
    else if (
      m[1][0] === fence.marker &&
      m[1].length >= fence.size &&
      /^ {0,3}(?:`+|~+)\s*$/.test(line.text)
    ) {
      const end = line.start + line.text.length;
      fenceRanges.push({ start: fence.start, end });
      if (fence.start < at && at <= end) at = end;
      fence = undefined;
    }
  }
  if (fence && fence.start < at) throw new Error('图片定位落在未闭合的代码块内，请先修正正文格式');
  const containers: Array<{ name: string; start: number }> = [];
  const html = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi;
  let enclosingEnd = -1;
  for (const match of source.matchAll(html)) {
    const start = match.index!,
      end = start + match[0].length;
    if (fenceRanges.some((range) => start >= range.start && start < range.end)) continue;
    if (start < at && at < end) at = end;
    const name = (match[1] || '').toLowerCase();
    if (!['table', 'pre', 'script', 'style', 'textarea', 'select'].includes(name)) continue;
    if (/^<\//.test(match[0])) {
      const index = containers.map((c) => c.name).lastIndexOf(name);
      if (index >= 0) {
        const open = containers[index];
        containers.splice(index);
        if (open.start < at && at <= end) enclosingEnd = Math.max(enclosingEnd, end);
      }
    } else if (!/\/\s*>$/.test(match[0])) containers.push({ name, start });
  }
  if (enclosingEnd >= 0) at = Math.max(at, enclosingEnd);
  if (containers.some((c) => c.start < at))
    throw new Error('图片定位落在未闭合的 HTML 容器内，请先修正正文格式');
  // Keep markdown table rows intact. A block div inside a row can appear above it.
  let index = lines.findIndex((line) => at >= line.start && at <= line.start + line.text.length);
  if (index >= 0 && lines[index].text.includes('|')) {
    let first = index,
      last = index;
    while (first > 0 && lines[first - 1].text.trim() && lines[first - 1].text.includes('|')) first--;
    while (last + 1 < lines.length && lines[last + 1].text.trim() && lines[last + 1].text.includes('|'))
      last++;
    if (lines.slice(first, last + 1).some((line) => /^\s*\|?\s*:?-{3,}:?\s*\|/.test(line.text)))
      at = lines[last].start + lines[last].text.length;
  }
  // A sentence-ending quote belongs before its illustration.
  while (at < source.length && /[」』”’）】]/.test(source[at])) at++;
  return at;
}

export function injectImageTags(source: string, images: ImageInsertion[]): string {
  if (!images.length) return source;
  const lines = sourceLines(source);
  const byLine = new Map<number, ImageInsertion[]>();
  for (const original of images) {
    let image = original;
    if (!Number.isInteger(image.sourceLine) || image.sourceLine < 0 || image.sourceLine >= lines.length) {
      throw new Error(`位置 ${image.position} 对应的原始物理行已失效`);
    }
    const originalLine = lines[image.sourceLine];
    const relative =
      Number.isFinite(image.charOffset) && image.charOffset > 0
        ? Math.min(Math.round(image.charOffset), originalLine.text.length)
        : originalLine.text.length;
    const offset = safeImageOffset(source, originalLine.start + relative);
    const resolvedLine = lines.findIndex((l) => offset >= l.start && offset <= l.start + l.text.length);
    if (resolvedLine < 0) throw new Error('无法定位安全的剧情段尾，本次未写入图片标签');
    image = { ...image, sourceLine: resolvedLine, charOffset: offset - lines[resolvedLine].start };
    const line = image.sourceLine;
    const list = byLine.get(line) ?? [];
    list.push(image);
    byLine.set(line, list);
  }

  const fallbackEol = lines.find((line) => line.eol)?.eol || '\n';
  let output = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inserted = byLine.get(index) ?? [];
    const insertedEol = line.eol || fallbackEol;
    if (!inserted.length) {
      output += line.text + line.eol;
      continue;
    }

    // 稳定排序:同一偏移的多张图保持模型给出的原相对顺序
    const ordered = inserted
      .map((image, order) => ({ image, order }))
      .sort((a, b) => (a.image.charOffset || 0) - (b.image.charOffset || 0) || a.order - b.order)
      .map((item) => item.image);

    const inline: ImageInsertion[] = [];
    const tail: ImageInsertion[] = [];
    for (const image of ordered) {
      const at = Math.round(Number(image.charOffset) || 0);
      if (at > 0 && at < line.text.length) inline.push({ ...image, charOffset: at });
      else tail.push(image);
    }

    let piece = '';
    let cursor = 0;
    for (const image of inline) {
      piece += line.text.slice(cursor, image.charOffset);
      // 序列化口径见 st/imageTagRegex.ts 的 serializeImageTag（与手动编辑弹窗共用同一份，
      // 两处漂移会让「解析出的字段」与「落进正文的原文」对不上，而 promptHash 吃的是原文）。
      piece += `${insertedEol}${insertedEol}${serializeImageTag(image)}${insertedEol}${insertedEol}`;
      cursor = image.charOffset;
      // 吃掉句后原有的空白/缩进,免得 tag 后面拖出一串空格
      while (cursor < line.text.length && /[ \t]/.test(line.text[cursor])) cursor += 1;
    }
    piece += line.text.slice(cursor);
    for (const image of tail)
      piece += `${insertedEol}${insertedEol}${serializeImageTag(image)}${insertedEol}`;
    output += piece + line.eol;
  }
  return output;
}
