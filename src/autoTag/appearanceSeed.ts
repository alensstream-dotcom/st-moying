/**
 * 首楼外貌种子。
 *
 * 实机第一个故障：第 0 楼的外貌库是空的（`[system-maintained; currently empty]`），
 * 模型手里只有角色卡那段散文，于是它给「林夏」写了一份既没有发色也没有瞳色的
 * 角色块——那张图的脸与后面几楼对不上，而第 1 楼建档之后又反过来照抄第 0 楼
 * 这份残缺档案，错就一直传下去。
 *
 * 这里做的是**提取而非代写**：把角色卡里明确写到的外貌行摘出来，连同「必须据此
 * 建档、字段值用 danbooru 词、之后逐字沿用」的指令一起塞给模型。插件不替它生成
 * 外貌词——编造外貌是另一类错误（把用户没写的人设锁死）。
 */

const SEED_LINES = 8;
const SEED_CHARS = 700;

/**
 * 判断一行是不是外貌描写。
 *
 * 只认明确的生理特征词，不认「她喜欢看书」这类性格句：外貌档案写错比写漏更糟，
 * 漏了还能靠下一楼补，写错了每一张图都得跟着错。
 */
const APPEARANCE = /(头发|发色|发丝|发型|长发|短发|黑发|白发|银发|金发|棕发|瞳|眼睛|眸子|肤|皮肤|白皙|身材|体型|身高|胸|腰|腿|痣|疤|纹身|耳|脸型|五官|hair|eyes?|skin|body|height|breast)/i;

export interface AppearanceSeedInput {
  /** 角色卡正文（已去掉标题行）。 */
  charCard: string;
  /** 外貌库当前是否为空。 */
  libraryEmpty: boolean;
}

/** 从角色卡里摘出外貌行；摘不到就返回空串（不硬编）。 */
export function appearanceSeedLines(charCard: string): string[] {
  return String(charCard ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && APPEARANCE.test(line))
    .slice(0, SEED_LINES);
}

export function appearanceSeedBlock(input: AppearanceSeedInput): string {
  if (!input.libraryEmpty) return '';
  const lines = appearanceSeedLines(input.charCard);
  if (!lines.length) return '';
  const quoted = lines.join('\n').slice(0, SEED_CHARS);
  return [
    '【首楼外貌种子：来自角色卡，必须据此建档】',
    '外貌库还是空的，这是该角色第一次需要出图。下面几行是角色卡里明确写到的外貌原文：',
    quoted,
    '做法：本楼就为她报 changes（field:"new"，fields 里 hair / eyes / skin / body 尽量填满），字段值写成英文 danbooru 词——只翻译上面确实写到的部分，角色卡没写的（例如瞳色）宁可留空，也不要凭空补一个好看的颜色；她之后每一楼都逐字沿用这份档案，不要重新随机。',
    '如果上面这些行没有覆盖角色卡里的全部外貌信息，先读完整张角色卡再建档，仍然不许编造。',
  ].join('\n');
}