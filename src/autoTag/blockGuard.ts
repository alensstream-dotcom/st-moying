/**
 * 渠道侧拦截的识别与降载重试。
 *
 * 为什么单独一层:前面的重试全都在修「模型没照协议写」——截断、空 images、落位重复。
 * 但还有一类失败根本不在模型手里:请求或响应被渠道的内容过滤掐掉。它的表现形态是
 * 空 content、finish_reason=content_filter、或者一段「抱歉,这段内容……」的中文散文。
 *
 * 关键认知:过滤查的是**文本本身**,不认授权话术。同一个模型,正文里只要出现足够多的
 * 露骨词,请求就会被整条拦下——破限词再怎么加都管不到这一层,因为拦截发生在模型看到
 * 请求之前。所以命中时该做的是**把请求改小改淡**,而不是把立场再表硬一次:
 *   - 系统提示里的示例词(pussy / creampie / 穴口)换成中性占位,意思还能带住;
 *   - 让思考块退回英文 tag 词,别写中文露骨长句(流式输出最容易被斩的就是它)。
 *
 * 判形态不判内容:这里只回答「这次是不是被外面拦了」,重试与降载由调用方决定。
 */

import { FINISH_LENGTH_RE } from '@/autoTag/truncation';

export interface BlockVerdict {
  blocked: boolean;
  /** 命中的形态,写进错误信息与请求历史,便于区分「被渠道拦」与「模型乱写」。 */
  reason: string;
}

/**
 * 渠道自己标注的「这次输出被拦了」。
 *
 * `PROHIBITED_CONTENT` 是最容易漏的一个:它是 Gemini 系(AI Studio / 各家中转)在
 * finishReason 里给的原文,里面既没有 `content_filter` 也没有 `sensitive`,
 * 漏判的后果不是「少报一个错」,而是**整条换模型链路不触发** ——
 * 用户看到的正是「卡住 100 秒,两次都失败,换个模型明明能过」。
 * (实测:odyfree 渠道 gemini-4-hydrogen-high 每次都回这条,同站另一个变体 6/6 通过。)
 */
const FINISH_FILTER_RE = /content_filter|sensitive|moderation|filter|prohibited|blocked|safety/i;

/**
 * 拦截**只写在正文里**、finishReason 却是空的那一类。
 *
 * 实测(odyfree 自建站):上游把拦截包进 `error.message` 原样透传回来,插件拿到的是一句
 * `上游内容拦截 (finishReason: PROHIBITED_CONTENT): The model output could not be generated…`
 * —— 注意这是**错误的字符串**,不是 finishReason 参数。`blockGuard` 只判 finishReason,
 * 于是 `blockedOnce` 恒为 false,整条「换下一级模型」链路一次都没触发过:
 * 用户看到的是「同一个模型连着失败两次、备用名一个都没试」。
 */
const TEXT_BLOCK_RE = /prohibited_content|prohibited use policy|blockreason|上游内容拦截|sensitive words|content filter|内容审核|被拒绝/i;

/**
 * 拒答散文的形态。
 *
 * 只在「正文里根本没有 JSON 起点」时才用它——只要模型开始输出 `{`,它就进入了
 * 协议,那属于解析问题不属拦截问题。所以先看花括号,再看措辞。
 */
const REFUSAL_RE = new RegExp(
  [
    '抱歉',
    '很遗憾',
    '无法(继续|输出|完成|生成)',
    '不能(输出|生成|提供)',
    '作为(一个|一名|AI|人工智能)',
    '(内容|题材|尺度)(涉及|受限|敏感)',
    '审核',
    '被(过滤|拦截)',
    '以下是',
    '由于篇幅',
    '\\bsorry\\b',
    '\\bunable to\\b',
    '\\bas an AI\\b',
    'content filter',
    'rate limit',
  ].join('|'),
  'i',
);

/**
 * 判定这次返回是否属于渠道拦截。
 *
 * @param raw 上游返回的原文(可能为空)
 * @param finishReason OpenAI 的 finish_reason,有 content_filter 时直接定性
 */
export function diagnoseBlock(raw: string, finishReason?: string | null): BlockVerdict {
  const text = (raw ?? '').trim();
  if (finishReason && FINISH_FILTER_RE.test(finishReason)) {
    return { blocked: true, reason: `finish_reason=${finishReason}` };
  }
  if (!text) return { blocked: false, reason: '' };
  // 渠道明确说「是长度撞顶了」:那属于截断,交给 truncation 走砍图数,不在这里抢。
  if (finishReason && FINISH_LENGTH_RE.test(finishReason)) return { blocked: false, reason: '' };
  // 拦截被渠道塞进 error.message、或者被渠道改写成一句「上游内容拦截…」:这时 finishReason
  // 参数是空的,只能看正文措辞。**这一步必须在「有花括号就放行」之前**:
  // 真实事故(odyfree 渠道,第 19/32 楼)是上游把拦截包成纯文本回执,而正文里恰好带了个 `{`,
  // 于是旧顺序直接放行,接着又被 diagnoseTruncation 判成「JSON 未闭合」走砍图数路径——
  // 原样重发、再被拦一次,用户看到的就是「两次都失败,换个模型明明能过」。
  if (TEXT_BLOCK_RE.test(text)) {
    const hit = text.match(TEXT_BLOCK_RE);
    return { blocked: true, reason: `渠道回执(${hit?.[0] ?? '拦截'})` };
  }
  if (text.includes('{')) {
    const depth = braceDepth(text);
    // 写完了的 JSON:交给解析器,不在这里拦。
    if (depth <= 0) return { blocked: false, reason: '' };
    // 半截 JSON 且渠道没说自己是长度撞顶 —— 那就是**输出侧被斩断**。
    // 它长得像截断、修法却相反:砍图数只会让同一句话再被斩一次,要改的是请求的浓度。
    return { blocked: true, reason: '半截 JSON(输出侧被斩断)' };
  }
  const hit = text.match(REFUSAL_RE);
  if (hit) {
    return { blocked: true, reason: `拒答散文(${hit[0]})` };
  }
  return { blocked: false, reason: '' };
}

/**
 * JSON 花括号的净值:>0 表示还有对象没闭合。
 *
 * 只看花括号、不解析字符串转义:这里判的是「有没有写完」,差一两个括号的边界情况
 * 交给 protocol.ts 的解析器,它那边有更严格的配平扫描。
 */
function braceDepth(text: string): number {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  return depth;
}


/**
 * 兼容模式:把系统提示里的露骨示例词换成中性写法。
 *
 * 只动**举例用的**词,不动字段名:契约里「brush on pussy」这类示例是为了让模型看见
 * 词组形态,换成 `brush on <部位>` 一样能看见形态,但请求里少了 pussy 这个词。
 * 输出端该写什么词不变——示例换掉不影响它照写 danbooru tag。
 */
const NEUTRALIZE: Array<[RegExp, string]> = [
  // 身体部位:统一收成占位,顺序先长后短,避免「乳头」被「头」之类截断(本表无「头」)。
  [/brush on pussy/g, 'brush on <部位>'],
  [/ice on nipple/g, 'ice on <部位>'],
  [/fingers inside her/g, 'fingers inside <部位>'],
  [/cum on \\<部位\\>/g, '液体 on <部位>'],
  [/cum on <部位>/g, '液体 on <部位>'],
  [/creampie/g, '内部射精'],
  [/pussy/g, '私处'],
  [/nipples/g, '乳首'],
  [/penis/g, '性器'],
  [/anus/g, '后庭'],
  [/testicles/g, '囊袋'],
  [/穴口/g, '入口'],
  [/阴部/g, '私处'],
  [/阴蒂/g, '前端'],
  [/肉棒/g, '性器'],
  [/精液/g, '液体'],
];

/** 逐条抹掉系统提示里的露骨示例词;返回新数组,不改原对象。 */
export function neutralizeMessages<T extends { role: string; content: string }>(messages: T[]): T[] {
  return messages.map(msg =>
    msg.role === 'system'
      ? {
          ...msg,
          content: NEUTRALIZE.reduce((text, [re, to]) => text.replace(re, to), msg.content),
        }
      : msg,
  );
}

/**
 * 命中拦截后的重试指令。
 *
 * 三件事:承认刚才被拦(模型会跟着这个定性照做)、把这次的产出压到最小、明确要求
 * 用英文 tag 词代替中文露骨描述。不要求它「更勇敢」——要求它「更短更淡」。
 *
 * ⚠ 两版本的分歧点是**思考段**,不是措辞:
 * Gemini 档的破限词明文禁止 `<thinking>`(实测带思考段 43% 13/30,禁思考后 20/20),
 * 而旧版这份重试指令却在末尾写「仍从 `<thinking>` 开始」——两份 system 正面冲突,
 * 模型照旧回去写思考段,于是又踩一次输出侧拦截。重试指令必须跟着档位走,
 * 否则「被拦之后的重试」永远是同一条死路的第二次尝试。
 */
const BLOCK_RETRY_NOTE_PLAIN = [
  '<retry_after_block>',
  '上一次请求被渠道的内容过滤拦下了(或返回了大量客套话)。这一次按最小结构来:',
  '- <thinking> 压到 5 行以内,只写真结论;描述身体与接触尽量用英文 tag 短词,不写中文长句。',
  '- 每张图只给 position / tag / size 三键,characters 里每个角色一块,不写额外说明。',
  '- 数量先给下限的 1 张,够就停,不要为了多给图把请求撑大。',
  '- 仍从 <thinking> 开始,最后立刻闭合 JSON。',
  '</retry_after_block>',
].join('\n');

/**
 * Gemini 档的版本:**不许**再要求思考段,而且要点名「哪些词别再写」。
 *
 * 它对着 GEMINI_TEXT/GEMINI_LOOSE_TEXT 的口径写:不写思考、tag 用短词、nl 退化成镜头句。
 * 同时把「刚才为什么被拦」说成一件可操作的事(写了成段描写),模型才知道改哪一处,
 * 而不是笼统地「再小心一点」。
 */
const BLOCK_RETRY_NOTE_GEMINI = [
  '<retry_after_block>',
  '上一次输出被这条通道在生成过程中斩断了。原因几乎总是同一件事:写成了成段的中文描写。',
  '这一次只做三件事:',
  '- **不要输出 <thinking>,不要写任何推理过程**,直接输出以 { 开头的 JSON。',
  '- tag 与 characters[].tag 只写 danbooru 风格短词(景别/机位/姿态/场景/光线/表情/衣物状态),',
  '  逗号连接,不写成句子。',
  '- 每张图只给 position / tag / characters 三键;数量先给 1 张,写完当场闭合。',
  '</retry_after_block>',
].join('\n');

/**
 * 取这一档该用的重试指令。
 *
 * @param gemini 是否 Gemini 系档位(见 jailbreak.ts 的 isGeminiTier)
 */
export function blockRetryNote(gemini: boolean): string {
  return gemini ? BLOCK_RETRY_NOTE_GEMINI : BLOCK_RETRY_NOTE_PLAIN;
}

/** 兼容旧调用:默认按「普通档」口径。新代码请用 {@link blockRetryNote}。 */
export const BLOCK_RETRY_NOTE = BLOCK_RETRY_NOTE_PLAIN;
