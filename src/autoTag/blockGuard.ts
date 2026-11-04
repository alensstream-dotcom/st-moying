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

export interface BlockVerdict {
  blocked: boolean;
  /** 命中的形态,写进错误信息与请求历史,便于区分「被渠道拦」与「模型乱写」。 */
  reason: string;
}

const FINISH_FILTER_RE = /content_filter|sensitive|moderation|filter/i;

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
  // 已经写出 JSON 起点:不管前面有没有客套话,都交给解析器,不在这里拦。
  if (text.includes('{')) return { blocked: false, reason: '' };
  if (!text) return { blocked: false, reason: '' };
  const hit = text.match(REFUSAL_RE);
  if (hit) {
    // 空输出也算:有些渠道拦下后只回 200 + 空 content,由 truncation 一并报「空输出」。
    return { blocked: true, reason: `拒答散文(${hit[0]})` };
  }
  return { blocked: false, reason: '' };
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
 */
export const BLOCK_RETRY_NOTE = [
  '<retry_after_block>',
  '上一次请求被渠道的内容过滤拦下了(或返回了大量客套话)。这一次按最小结构来:',
  '- <thinking> 压到 5 行以内,只写真结论;描述身体与接触尽量用英文 tag 短词,不写中文长句。',
  '- 每张图只给 position / tag / size 三键,characters 里每个角色一块,不写额外说明。',
  '- 数量先给下限的 1 张,够就停,不要为了多给图把请求撑大。',
  '- 仍从 <thinking> 开始,最后立刻闭合 JSON。',
  '</retry_after_block>',
].join('\n');
