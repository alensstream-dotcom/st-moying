/**
 * 「这一格必须看得见什么」的封闭判定。
 *
 * 模型挑景别时看的是整段文字的"气氛"，经常把「她穿着丝袜和高跟鞋站在门口」
 * 画成上半身特写——衣服的下半身部分根本没进画面。景别是构图判断，可由模型定，
 * 但"正文点名了下半身 → 画面必须包含下半身"是硬事实，由代码守。
 *
 * 只做三件事：把正文点名可见的部位收成集合、检查当前景别是否装得下、装不下就换景别。
 * 不新增任何正文没有的东西（不会因为写了"腿"就补一条丝袜）。
 */

export interface SeeNeeds {
  lower: boolean;
  upper: boolean;
  face: boolean;
  hands: boolean;
}

const LOWER_TEXT =
  /丝袜|长袜|过膝袜|短袜|袜|鞋|高跟|靴|脚踝|脚背|赤脚|双腿|大腿|小腿|腿|裙摆|裙下|坐姿|蹲下|跪下|跪在|跨坐|牛仔裤|短裤|热裤|内裤|下体|秘处|私处/;
const UPPER_TEXT = /胸口|胸前|乳|领口|锁骨|肩膀|脊背|后背|上衣|衬衫|奶/;
const FACE_TEXT = /亲|吻|嘴唇|嘴角|脸颊|对视|看着她的脸|耳语|耳边|贴近|凑近|\b(?:kiss\w*|lips?|cheeks?|face|whisper\w*|forehead)\b/i;
const HANDS_TEXT = /手|掌|指|握|抓|按|抚|捏|拉|扯|牵着|环住|搂|\b(?:hands?|palms?|fingers?|grips?|gripping|holds?|holding|presses?|pressing|touches?|touching|reaches?|reaching)\b/i;

const SCALES = ['wide shot', 'full body', 'cowboy shot', 'medium shot', 'upper body', 'portrait', 'close-up', 'face focus'];
/** 装不下下半身的景别。 */
const UPPER_ONLY = new Set(['upper body', 'portrait', 'close-up', 'face focus']);
/** 装不下手的景别（脸特写基本看不见手在做什么）。 */
const FACE_ONLY = new Set(['close-up', 'face focus']);

export function seeNeeds(text: string): SeeNeeds {
  const body = String(text ?? '');
  return {
    lower: LOWER_TEXT.test(body),
    upper: UPPER_TEXT.test(body),
    face: FACE_TEXT.test(body),
    hands: HANDS_TEXT.test(body),
  };
}

/**
 * 按需要把景别换掉。只动景别词，机位/光线/人物都不动。
 * 返回被换掉的原词，供日志与排查用。
 */
export function enforceShotCoverage(tag: string, needs: SeeNeeds): { tag: string; changed: string[] } {
  const tokens = tag
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  const scale = tokens.find((token) => SCALES.includes(token.toLowerCase()));
  if (!scale) return { tag, changed: [] };
  const lowered = scale.toLowerCase();
  let next = '';
  if (needs.lower && UPPER_ONLY.has(lowered)) next = 'full body';
  else if (needs.hands && FACE_ONLY.has(lowered)) next = 'cowboy shot';
  if (!next || next === lowered) return { tag, changed: [] };
  const rebuilt = tokens.map((token) => (token.toLowerCase() === lowered ? next : token));
  return { tag: rebuilt.join(', '), changed: [scale] };
}

/** 事实表里的动作/身体条目也算「正文写了什么」：模型这楼写「她的手按在他胸口」，
 *  就必须让画面装得下手；写「她低头看自己的小腿」，就必须有下半身。
 */
export function needsFromFacts(facts: readonly { kind: string; value: string }[]): SeeNeeds {
  const text = facts.filter((f) => f.kind === 'action' || f.kind === 'body').map((f) => f.value).join('，');
  return text ? seeNeeds(text) : { lower: false, upper: false, face: false, hands: false };
}