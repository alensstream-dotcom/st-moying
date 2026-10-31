/**
 * 输出被截断的形态识别。
 *
 * 为什么要单独判一次:副 API 的拒答常常不是「明确拒绝」,而是**输出到一半被切断**——
 * <thinking> 写到一半没了、JSON 只写到 characters[1] 就结束。parseImagePlan 在这种情况下
 * 只会抛「不是合法 JSON」,重试一次还是同样的长度,于是三楼都失败。
 *
 * 这里只做形态判断(括号是否闭合、思考块是否闭合),不判断内容质量;
 * 命中即说明「请求被中途掐断」,重试时应当降载(压缩思考、精简 tag、先保证闭合)
 * 而不是原样重发。
 */

export interface TruncationVerdict {
  truncated: boolean;
  reason: string;
}

const OPEN_THINK = '<thinking>';
const CLOSE_THINK = '</thinking>';

export function diagnoseTruncation(raw: string): TruncationVerdict {
  const text = (raw ?? '').trim();
  if (!text) return { truncated: true, reason: '空输出' };

  const openAt = text.indexOf(OPEN_THINK);
  const closeAt = text.lastIndexOf(CLOSE_THINK);
  if (openAt >= 0 && closeAt < openAt) {
    return { truncated: true, reason: '思考块未闭合' };
  }

  // 只看 </thinking> 之后的部分:思考块里出现的花括号不是 JSON。
  const body = closeAt >= 0 ? text.slice(closeAt + CLOSE_THINK.length) : text;
  const jsonStart = body.indexOf('{');
  if (jsonStart < 0) {
    // 没有 JSON 起点:可能是纯文本拒答,也可能是只输出了一小段前言。
    return { truncated: true, reason: '没有 JSON 对象' };
  }

  const json = body.slice(jsonStart);
  const depth = braceDepth(json);
  if (depth > 0) return { truncated: true, reason: `JSON 未闭合(差 ${depth} 个收尾括号)` };
  if (depth < 0) return { truncated: true, reason: 'JSON 括号错位' };
  return { truncated: false, reason: '' };
}

/** 括号深度差(跳过字符串内的括号与转义);>0 少收尾,<0 多收尾。 */
function braceDepth(json: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    if (depth < 0) return depth;
  }
  // 字符串没闭合也算截断:模型停在了某个 tag 串中间。
  return inString ? depth + 1 : depth;
}

/**
 * 命中截断时的重试附加指令。
 *
 * 写在重试请求的最后一条 system 里,只影响这一次:要求模型把输出压到能一次说完,
 * 并把「先闭合结构」排在「多给一张图」之前——截断的根因是输出太长,
 * 不是模型不懂要求。
 */
export const TRUNCATION_RETRY_NOTE = [
  '<retry_after_truncation>',
  '上一次的输出在中途被切断了(思考块或 JSON 没有闭合)。本次必须一次说完:',
  '- <thinking> 压到 5 行以内,只写结论,不再逐条复述正文。',
  '- 每张图的 tag 只保留必要词,不写同义重复;characters 里每个角色一块即可。',
  '- 先写完 Base 再逐个写角色,最后立刻闭合 JSON;宁可少给一张图,也不要在中途断掉。',
  '- 不要解释为什么变短,直接从 <thinking> 开始输出。',
  '</retry_after_truncation>',
].join('\n');
