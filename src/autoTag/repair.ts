/**
 * 局部修复：某一格被校验挡掉时，只重写这一格。
 *
 * 为什么不让整楼重跑：一楼重跑要 10 分钟以上（上游慢的时候要 3 次尝试），而且重跑会把
 * 同一楼里**已经合格的**那几张一起重掷，本来对的那张可能变错。这里只把「这一格」的
 * 原文段落 + 它自己的定场信息 + 具体错误交给模型重写一次，其余图原样保留。
 *
 * 这条路径不带整份契约、不带词表菜单、不带四楼上下文——它要回答的只是一个很窄的问题：
 * 「在 P3 这句话上，把这张图的 tag/nl 写对，且引句必须是原文里逐字存在的」。
 */
import type { ChatMsg } from '@/api/client';

export interface RepairRequest {
  /** 这一格的原文段落（模型只能落在这句上）。 */
  segment: string;
  /** 目标段编号，例如 P3。 */
  position: string;
  /** 上一次写错的那句 after（用来告诉模型错在哪里）。 */
  badQuote?: string;
  /** 这一格被挡掉的具体原因。 */
  error: string;
  /** 这个角色此刻的穿着（只给这一格用，避免它按别的楼层的衣服画）。 */
  outfitLine?: string;
  /** 定格动作/焦点（如果模型上一次写过）。 */
  frameAction?: string;
  focus?: string;
}

const HEAD = `你只负责一件事：把下面这一段原文里**这一格**的画面写成一份 JSON。
不要重写别的格子，不要解释，不要复述原文，只输出 JSON 本体。`;

export function repairMessages(request: RepairRequest): ChatMsg[] {
  const lines = [
    '<Order>',
    HEAD,
    '</Order>',
    '',
    `<Input>位置：${request.position}（只能是这一格，position 就写 ${request.position}）`,
    `原文段落：${request.segment}`,
  ];
  if (request.outfitLine) lines.push(`这一刻她的穿着：${request.outfitLine}`);
  lines.push('</Input>', '', '<Error>', request.error);
  if (request.badQuote) lines.push(`上一次写的引句是「${request.badQuote}」，它不是原文里逐字存在的句子。`);
  if (request.frameAction) lines.push(`上一次的定格动作是：${request.frameAction}`);
  if (request.focus) lines.push(`上一次的焦点是：${request.focus}`);
  lines.push('</Error>', '', '<Rules>');
  lines.push('1. after 必须从上面「原文段落」里逐字抄一句，不能改标点、不能缩写；也可以直接写位置编号。');
  lines.push('2. tag 用可枚举的英文词条（人数、外貌、衣物品类与状态、景别、姿势、光道具），不要写器官名、体液、行为词。');
  lines.push('3. nl 是一句完整英文，只写这一格看得见的事：谁在做什么、接触落在哪里、她的身体在动作下是什么状态；');
  lines.push('   可以重复衣物名词指认落点（如 the hem of her shirt），但不要整段罗列穿着。');
  lines.push('4. 只写这一段原文里成立的画面：不要新增原文没有的人、道具、事件，也不要把别的格子的动作搬过来。');
  lines.push('5. 输出结构与主契约一致：{ "images": [{ position, tag, nl, characters, after, size, candidateId, frameAction, focus }] }。');
  lines.push('</Rules>');
  return [
    { role: 'system', content: lines.join('\n') },
    { role: 'user', content: `把 ${request.position} 这一格写对，只输出 JSON。` },
  ];
}