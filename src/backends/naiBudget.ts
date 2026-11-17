/**
 * NAI 提示词预算核算。
 *
 * 官方口径（docs.novelai.net/en/image/models）：V4.5 的提示词上限是
 * 「~512 T5 tokens over the base prompt and **all character prompts combined**」，
 * base_caption 与全部 char_captions 共享同一份额度。超了 NAI 不报错，
 * 直接从尾部静默丢弃——而尾部正是 NL 句与后写的角色块。
 *
 * 浏览器里没有 T5 分词器，这里只做保守估算：宁可高估（少写几个词），也不低估。
 * 本模块只负责「量」与「报警」，不负责改写内容：截断与改写会丢用户剧情，
 * 长度纪律交给规范（DEFAULT_NAI_V5_SPEC 第 6 条）与 nai.ts 的 clampNlWords。
 */

import { clampNlWords, fullPositivePrompt, isNai5 } from '@/backends/nai';
import type { ImageCharacterPrompt } from '@/autoTag/protocol';
import type { NaiSettings } from '@/state/settings';

/** 官方上限（base + 全部 char_captions 合计）。取不到认识的模型时按最紧的 512 走。 */
export function naiTokenBudget(model: string): number {
  if (isNai5(model)) return model.includes('curated') ? 703 : 1471;
  return 512;
}

/**
 * 保守估算 token 数。
 *
 * 英文按 3.2 字符/token（比常规 4 更紧：danbooru 的下划线、圆括号、权重语法
 * 都会被拆成更多 token）；CJK 按 1.8 token/字（4.5 官方明说 T5 不支持 Unicode，
 * 中文会退化成一堆字节级 token）。
 */
export function estimateNaiTokens(text: string): number {
  const value = text ?? '';
  if (!value.trim()) return 0;
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const rest = value.length - cjk;
  return Math.ceil(rest / 3.2) + Math.ceil(cjk * 1.8);
}

export interface NaiBudgetReport {
  /** 模型官方上限。 */
  total: number;
  /** 本次请求估算总量（含画师串、质量词、画风锚与全部角色块）。 */
  used: number;
  /** 是否超了。 */
  over: boolean;
  /** Base 段（tag + nl）估算。 */
  base: number;
  /** 各角色块估算，顺序同 characters。 */
  characters: number[];
}

/** 把整份请求按 NAI 口径算成 token 数并给出分段明细。 */
export function reportNaiBudget(
  nai: NaiSettings,
  prompt: string,
  nl: string,
  characters: ReadonlyArray<ImageCharacterPrompt>,
): NaiBudgetReport {
  const total = naiTokenBudget(nai.model);
  const base = estimateNaiTokens(fullPositivePrompt(nai, prompt, nl));
  const perCharacter = characters.map(
    (character) => estimateNaiTokens(character.tag) + estimateNaiTokens(character.nl) + 1,
  );
  const used = base + perCharacter.reduce((sum, value) => sum + value, 0);
  return { total, used, over: used > total, base, characters: perCharacter };
}

/**
 * 出图前量一次，超预算就记一条警告（不拦请求）。
 *
 * 这条日志是排查「NL 写了却没生效 / 后面那个角色没画出来」的第一现场：
 * 超预算时 NAI 静默截尾，用户只会看到画面莫名缺东西。
 */
export function warnIfOverBudget(
  nai: NaiSettings,
  prompt: string,
  nl: string,
  characters: ReadonlyArray<ImageCharacterPrompt>,
): NaiBudgetReport {
  const report = reportNaiBudget(nai, prompt, nl, characters);
  if (report.over) {
    console.warn(
      `[墨影] NAI 提示词超预算：估算 ${report.used}/${report.total} tokens` +
        `（Base ${report.base}，角色 ${report.characters.join('/')}），尾部内容可能被模型静默丢弃`,
    );
  }
  return report;
}
/** 预算闸门的失约异常：调用方按「这一张画不出来」处理，不要静默发出去。 */
export class NaiBudgetError extends Error {
  constructor(message: string, readonly report: NaiBudgetReport) {
    super(message);
    this.name = 'NaiBudgetError';
  }
}

/**
 * 发送前的预算闸门。
 *
 * 顺序：先按保守估算量一次 → 超了就收紧 NL（整句/整从句，交给 clampNlWords）→
 * 仍超就从 Base 里去掉「只增加体量、不增加信息」的通用场景词（house / indoors /
 * indoors 这类）→ 还超就不发，把超额来源写在错误里。
 *
 * 不做的三件事：不从末尾剪断（会留下半个动作）、不删角色块（少一个人比少一句更错）、
 * 不改用户固定画师串（那是用户的钱和审美）。这三件正是旧版「警告一下照发」留下的坑。
 */
export function enforceNaiBudget(
  nai: NaiSettings,
  prompt: string,
  nl: string,
  characters: ReadonlyArray<ImageCharacterPrompt>,
): { prompt: string; nl: string; characters: ReadonlyArray<ImageCharacterPrompt>; report: NaiBudgetReport } {
  const GENERIC = /\b(?:indoors?|outside|house|room|day|night)\b/gi;
  let currentPrompt = prompt;
  let currentNl = nl;
  let report = reportNaiBudget(nai, currentPrompt, currentNl, characters);
  if (!report.over) return { prompt: currentPrompt, nl: currentNl, characters, report };

  // 1) 收紧 NL：只留最短的那句（上限直接砍到 14 词）。
  const tightened = clampNlWords(currentNl, 14);
  if (tightened !== currentNl) {
    currentNl = tightened;
    report = reportNaiBudget(nai, currentPrompt, currentNl, characters);
    if (!report.over) return { prompt: currentPrompt, nl: currentNl, characters, report };
  }

  // 2) 去掉不承载信息的通用场景词（具体场所词不动）。
  const trimmedPrompt = currentPrompt
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token && !GENERIC.test(token))
    .join(', ');
  if (trimmedPrompt !== currentPrompt) {
    currentPrompt = trimmedPrompt;
    report = reportNaiBudget(nai, currentPrompt, currentNl, characters);
    if (!report.over) return { prompt: currentPrompt, nl: currentNl, characters, report };
  }

  throw new NaiBudgetError(
    `提示词超出 NAI 预算：估算 ${report.used}/${report.total} tokens（Base ${report.base}，角色 ${report.characters.join('+')}）。` +
      '已先收紧 NL、再删通用场景词，仍然放不下。请减少角色数或缩短服装描述，不要指望模型替你截断。',
    report,
  );
}
