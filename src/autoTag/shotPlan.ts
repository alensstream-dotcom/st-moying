import type { ChatMsg } from '@/api/client';
import type { CharTagEntry } from '@/state/charTags';
import { identityFactFor, type IdentityFact } from '@/state/characterIdentity';
import { CANDIDATE_FLOOR, scoreCandidate } from './candidates';
import type { TargetSegment } from './clean';
import type { StoryFact } from './facts';
import { FEMALE_CUE_RE, femaleCastNames, mentionIndexes } from './femaleCast';
import { isNarratedOnly } from './onScreen';
import { unanchoredIndexes } from './positionCheck';
import type { ImageInsertion, ImagePlan } from './protocol';
import { groundScenes, primaryPlace } from './storyGarments';

interface VisibleAction {
  source: RegExp;
  picture: RegExp;
  tags: string[];
  words: string;
  value: number;
  scale?: 'full body' | 'cowboy shot' | 'upper body';
}

const ACTIONS: Record<string, VisibleAction> = {
  catchCup: { source: /接住.{0,8}(?:玻璃杯|水杯|杯子)|(?:玻璃杯|水杯|杯子).{0,12}被接住/,
    picture: /catch(?:es|ing)?.{0,30}(?:glass|cup)|(?:glass|cup).{0,16}(?:caught|catch)/i,
    tags: ['catching', 'reaching out', 'cup'], words: 'catches the falling cup', value: 35, scale: 'cowboy shot' },
  shield: { source: /(?:挡|护)在.{1,14}(?:身前|面前)|张开双臂.{0,8}(?:挡住|挡在)/,
    picture: /shield|protect|blocks?.{0,14}(?:debris|sparks)/i,
    tags: ['arms spread', 'protecting'], words: 'spreads her arms to shield the person behind her', value: 34, scale: 'cowboy shot' },
  kiss: { source: /吻住|亲吻|吻上|接吻|吻着|深吻|嘴唇.{0,5}(?:相贴|贴在一起)|\bkisses\b/i,
    picture: /kiss|lips (?:meet|touch|press against)/i, tags: ['kissing'], words: 'kisses her partner', value: 28, scale: 'upper body' },
  waist: { source: /(?:搂住|环住|环抱|抱住|揽住|搂着|揽着|扣住|扶住)[^，。！？；]{0,13}(?:腰间|腰部|腰肢|腰)|\barms? around (?:her|his) waist\b/i,
    picture: /(?:arms?|hands?|hold|grip|wrap).{0,20}\bwaist\b|\bwaist\b.{0,16}(?:held|arms?)/i,
    tags: ['hugging', 'arm around waist'], words: 'is held by an arm around her waist', value: 16, scale: 'cowboy shot' },
  kneel: { source: /单膝跪|跪下|跪在|\bkneels\b/i, picture: /kneel|one knee/i,
    tags: ['kneeling'], words: 'kneels', value: 15, scale: 'full body' },
  pickBall: { source: /(?:捡起|拿起|拾起).{0,13}(?:皮球|球)|(?:皮球|红球|小球).{0,17}(?:捡起|拾起)/,
    picture: /(?:pick|grab|reach|retriev|lift).{0,26}ball/i, tags: ['reaching out', 'ball'],
    words: 'reaches down to pick up the ball', value: 15, scale: 'full body' },
  plan: { source: /(?:摊开|展开).{0,14}(?:草图|蓝图|图纸)|(?:草图|蓝图|图纸).{0,10}(?:摊开|铺开)/,
    picture: /(?:spread|unfold|open|unroll).{0,23}(?:plan|drawing|blueprint|sheet)/i, tags: ['holding paper', 'blueprint'],
    words: 'spreads the drawing out in front of her', value: 20, scale: 'cowboy shot' },
  removeCoat: { source: /(?:脱下|脱掉|褪下)[^，。！？；]{0,12}(?:外套|夹克|大衣)|(?:外套|夹克|大衣)[^，。！？；]{0,8}(?:脱下|脱掉)/,
    picture: /(?:off|remove|hang|drap|hold).{0,24}(?:coat|jacket)|(?:coat|jacket).{0,18}(?:chair|rack|off)/i,
    tags: ['holding jacket'], words: 'holds the jacket she has just taken off', value: 21, scale: 'cowboy shot' },
  openCollar: { source: /(?:敞开|解开|松开)[^，。！？；]{0,12}(?:衣领|领口)|(?:衣领|领口)[^，。！？；]{0,6}(?:敞开|解开)/,
    picture: /(?:open|loos|unbutton).{0,20}collar|collar.{0,13}(?:open|loos|unbutton)/i,
    tags: ['open collar'], words: 'opens the collar of her shirt', value: 20, scale: 'upper body' },
};

const UNSEEN = /想起|回想|回忆|盘算|打算|想要|要不要|如果|假如|梦见|照片里|画像里|闪过.{0,8}身影|独自.{0,12}(?:想|记得)|\b(?:remembers?|recalls?|imagines?|plans to|wonders if)\b/i;
const OFFSCREEN_OBJECT = /(?:她|那位女士|那个女孩)(?:的)?(?:照片|画像|相片|相框|报名表|档案|名字|消息)|\bher (?:photo(?:graph)?|portrait|name|file|profile|message)\b/gi;
const FEMALE_PRONOUN = /她(?!们)|\b(?:she|her)\b/i;
const MALE_PRONOUN = /(?<!其|别)他(?!人|们)|\b(?:he|him|his)\b/i;
const GROUP_PRONOUN = /两人|[他她]们|\bthey\b/i;
const PLACE_BREAK = /独自|只有.{1,12}一个人|隔壁|镜头转到|第二天|次日|隔天|回到|离开/;
const APPEARANCE_OR_ACTION = /起身|站在|坐在|冲向|跌|坠|扑|接住|挡住|张开|抓|松手|倒下|跪|抬|低头|转身|递|掀|披|穿|脱|敞|退|挥|摊开|展开|推|拉|吻|抱|握|望|笑|哭|脸色|身穿|出现|\b(?:stands?|sits?|kneels?|holds?|reaches?|jumps?|falls?|walks?|turns?|steps?|smiles?)\b/i;

export interface ShotMoment {
  segment: TargetSegment;
  action: string;
  actions: string[];
  female: string[];
  cast: string[];
  score: number;
  continues?: TargetSegment;
}

export function shotSelectionInstructions(min: number, max: number, withNl: boolean): string {
  return [
    '镜头排序先于提示词编写。逐句审视目标正文，列出女性实际入画且值得插图的独立瞬间：强动作、关键接触、局势转折、明显服装或形态变化优先于进门、静坐和空环境。',
    'candidates 每条写 position、evidence（该位置实际发生的原文）、action（谁对谁做了什么）、visible/value/novelty/drawable/unsure（0–3）。候选至少覆盖所有关键转折，包含同一个房间里的不同转折。',
    `若合格独立瞬间有 K 个，实际插入较高价值的前 min(K, ${max}) 个。最少设置为 ${min}，它只在有真实在场女性的可见瞬间中适用。女角色只被提及、只出现在回忆、只在画外，或本楼是纯男性及空景时输出 []。`,
    '在这一次回复中给所有首选镜头写完 images。如果另有同样值得画的候选，可在数组末尾附最多两条完整备选提示词供程序排序，实际插图仍按上限。',
    '每个独立瞬间只取一个画面。相邻两句发生实质不同的可见事件时允许各选一张；同一动作连着写几句时在事实完整成立处合成一张。',
    '每图 position、candidateId 与 after 对齐。frameAction 写同一时刻全部关键动作、施动方、接触落点和可见姿态；镜头能同时看见这些落点。截掉其中一个落点的特写不用。',
    '重要的复合动作在 facts 里逐项写 action。subject 写实际施动者，evidence 逐字引用本句描写该动作的短语，value 用带对象或落点的英文动词短语（如 gripping the rail）。同一人物同时做两项动作时要有两项事实。',
    withNl
      ? '英文 tag 给可见事实，角色 nl 用完整的短句把动作与落点绑定。例：He holds her waist with one arm while kissing her on the lips. 把人物外貌和现穿服装交给账本，关系句优先写动作。'
      : '按设置省略 nl。英文 tag 必须分别写出各关键动作和接触落点，例如 kissing, hugging, arm around waist。',
  ].join('\n');
}

export function visibleShotText(text: string): string {
  // A named person in a memory, a plan, or a photo is outside this shot.
  const unreal = text.search(UNSEEN);
  return (unreal < 0 ? text : text.slice(0, unreal)).trim();
}

function actionKeys(text: string): string[] {
  return Object.keys(ACTIONS).filter((id) => ACTIONS[id].source.test(text));
}

function quoteMatches(quote: string, segment: TargetSegment): boolean {
  return !!quote && (/^P\d+$/i.test(quote)
    ? quote.toUpperCase() === segment.id
    : !unanchoredIndexes([{ afterQuote: quote }], segment.text).length);
}

export function inventoryShots(
  segments: readonly TargetSegment[],
  plan: ImagePlan,
  entries: readonly CharTagEntry[],
  identities: IdentityFact[],
  story: string,
  min: number,
): ShotMoment[] {
  const imageNames = plan.images.flatMap((image) => image.characters.map((c) => c.name));
  const names = [...new Set([...entries.map((e) => e.name), ...identities.map((fact) => fact.name), ...imageNames])];
  const inferred = new Set(femaleCastNames(entries, identities, story, names));
  const women = new Set(names.filter((name) => {
    const fact = identityFactFor(name, identities);
    return fact?.gender === 'female' || fact?.gender !== 'male' && inferred.has(name);
  }));
  const candidates = new Map(plan.candidates?.map((item) => [item.position, item]));
  const proposed = new Set(plan.images.filter((image) => image.afterQuote).map((image) => image.position));
  const moments: ShotMoment[] = [];
  let recentCast: string[] = [];
  let prior: ShotMoment | undefined;
  for (const segment of segments) {
    const text = visibleShotText(segment.text);
    const previous = prior;
    prior = undefined;
    if (!text || isNarratedOnly(text)) continue;
    if (PLACE_BREAK.test(text)) recentCast = [];
    const cast = names.filter((name) => mentionIndexes(text, name, entries).length &&
      !(text.includes(name + '的') && !text.replaceAll(name + '的', '').includes(name) &&
        /照片|画像|报名表|档案|名字/.test(text)));
    const female = cast.filter((name) => women.has(name));
    const actions = actionKeys(text);
    const continues = actions.includes('kiss') && !actions.includes('waist') &&
      previous?.actions.includes('waist') &&
      /(?:随即|紧接着|仍|两人|他们|她|他|\bthey\b)/i.test(text) &&
      !/松开|放开|推开|退开|离开|隔天|后来|分钟后|小时后/.test(text)
      ? previous : undefined;
    if (continues) {
      actions.push('waist');
      for (const name of continues.female) if (!female.includes(name)) female.push(name);
      for (const name of continues.cast) if (!cast.includes(name)) cast.push(name);
    }
    const presenceText = text.replace(OFFSCREEN_OBJECT, '');
    const group = GROUP_PRONOUN.test(presenceText) && recentCast.length === 2;
    const femaleCue = FEMALE_CUE_RE.test(presenceText) || /\b(?:she|her|woman|women|girl|lady)\b/i.test(presenceText);
    const recentWomen = recentCast.filter((name) => women.has(name));
    const recentOthers = recentCast.filter((name) => !women.has(name));
    if (!female.length && (group || FEMALE_PRONOUN.test(presenceText) && recentWomen.length === 1)) female.push(...recentWomen);
    if (!cast.some((name) => !women.has(name)) && (group || MALE_PRONOUN.test(presenceText) && recentOthers.length === 1))
      cast.push(...recentOthers);
    if (cast.length || female.length) recentCast = [...new Set([...cast, ...female, ...recentCast])].slice(0, 3);
    if (!female.length && !femaleCue) continue;
    const model = candidates.get(segment.id);
    const grounded = !!model?.evidence && !/^P\d+$/i.test(model.evidence) &&
      quoteMatches(model.evidence, { ...segment, text });
    const quality = model && model.visible >= 2 && model.drawable >= 1 && scoreCandidate(model) >= CANDIDATE_FLOOR;
    if (!APPEARANCE_OR_ACTION.test(text) && !actions.length && !(grounded && quality)) continue;
    if (!actions.length && !quality && (model || !proposed.has(segment.id)) && min === 0) continue;
    const sourceValue = actions.reduce((sum, id) => sum + ACTIONS[id].value, 0);
    const modelValue = quality ? Math.min(actions.length ? 8 : 27, scoreCandidate(model)) : 0;
    const strength = sourceValue + modelValue + (grounded ? 2 : 0);
    prior = { segment, action: grounded && model?.action ? model.action : text, actions, female,
      cast: [...new Set([...cast, ...female])], score: strength, continues: continues?.segment };
    moments.push(prior);
  }
  return moments.sort((left, right) => right.score - left.score ||
    left.segment.sourceLine - right.segment.sourceLine || left.segment.charOffset - right.segment.charOffset);
}

export function independentShots(moments: readonly ShotMoment[]): ShotMoment[] {
  const selected: ShotMoment[] = [];
  for (const moment of moments) {
    if (selected.some((other) => {
      if (other.continues?.id === moment.segment.id || moment.continues?.id === other.segment.id) return true;
      const distance = Math.abs(Number(other.segment.id.slice(1)) - Number(moment.segment.id.slice(1)));
      if (distance === 0) return true;
      if (distance > 2) return false;
      const sameAction = moment.actions.length > 0 && moment.actions.join('/') === other.actions.join('/');
      return moment.action === other.action || sameAction && moment.cast.join('/') === other.cast.join('/');
    })) continue;
    selected.push(moment);
  }
  return selected;
}

export function verifiedShot(image: ImageInsertion, moment: ShotMoment, facts: readonly StoryFact[] = []): boolean {
  if (image.position !== moment.segment.id || image.sourceLine !== moment.segment.sourceLine ||
      image.charOffset !== moment.segment.charOffset || !quoteMatches(image.afterQuote ?? '', moment.segment)) return false;
  if (!image.characters.length || moment.female.length && !image.characters.some((c) => moment.female.includes(c.name)))
    return false;
  if (moment.cast.length && image.characters.some((c) => !moment.cast.includes(c.name)) &&
      !/(?:他|她|两人|众人|大家|\bthey\b)/i.test(moment.segment.text)) return false;
  if (!moment.female.length && !/\b(?:1girl|2girls|woman|female|girl)\b/i.test(
    [image.tag, ...image.characters.map(c => c.tag)].join(', '))) return false;
  if (moment.actions.includes('waist') && moment.actions.includes('kiss') && image.characters.length < 2) return false;
  if ((moment.actions.includes('shield') || moment.actions.includes('plan') && /另一端|两人/.test(moment.segment.text)) &&
      moment.cast.length === 2 &&
      !moment.cast.every((name) => image.characters.some((c) => c.name === name))) return false;
  const caption = [image.tag, image.nl, ...image.characters.flatMap((c) => [c.tag, c.nl])].join(' ');
  // A known action in a caption cannot be imported from a different beat.
  const stray = ['kiss', 'waist', 'catchCup', 'kneel', 'shield'].some((id) =>
    ACTIONS[id].picture.test(caption) && !moment.actions.includes(id));
  if (stray) return false;
  if (moment.actions.length) return moment.actions.some((id) => ACTIONS[id].picture.test(caption));
  const local = shotActionFacts(image.characters.map((c) => c.name), moment, facts);
  if (local.length) return local.some((fact) => {
    const character = image.characters.find((c) => c.name === fact.subject);
    return coversAction([image.tag, image.nl, character?.tag, character?.nl].join(' '), fact.value);
  });
  return !!image.frameAction || !!image.nl || image.characters.some((c) => c.nl);
}

/** Actions with source evidence can be compiled even if the model omits their finished prompt. */
export function draftKnownShot(moment: ShotMoment, facts: readonly StoryFact[] = []): ImageInsertion | undefined {
  const { segment, actions, female, cast } = moment;
  if (!female.length) return;
  const reported = actions.length ? [] : shotActionFacts(cast, moment, facts);
  if (!actions.length && !reported.length) return;
  const relational = actions.some((id) => ['kiss', 'waist', 'shield'].includes(id)) ||
    actions.includes('plan') && /两人|他们|一起|另一端/.test(segment.text);
  if (relational && cast.length !== 2) return;
  const castNames = [...new Set([female[0], ...(relational ? cast : reported.map((fact) => fact.subject))])];
  const girlCount = castNames.filter((name) => female.includes(name)).length;
  const boyCount = castNames.length - girlCount;
  return {
    position: segment.id, sourceLine: segment.sourceLine, charOffset: segment.charOffset,
    afterQuote: segment.text, frameAction: moment.action, candidateId: segment.id,
    tag: [`${girlCount}girl${girlCount > 1 ? 's' : ''}`, boyCount ? `${boyCount}boy${boyCount > 1 ? 's' : ''}` : '',
      primaryPlace(segment.text), castNames.length > 1 ? 'from side' : '', 'soft lighting'].filter(Boolean).join(', '),
    nl: '', negative: '', size: castNames.length > 1 ? 'landscape' : 'portrait',
    characters: castNames.map((name) =>
      ({ name, tag: female.includes(name) ? '1girl' : '1boy', nl: '' })),
  };
}

const SCALE = /^(?:wide shot|full body|cowboy shot|medium shot|upper body|portrait|close-up)$/i;
const TIGHT_ANGLE = /^(?:pov|point of view|extreme close-up|face focus)$/i;
const OPPOSING_POSE = /^(?:solo|standing|sitting|lying|lying down|looking at viewer|closed mouth)$/i;
const tags = (text: string) => text.split(',').map((part) => part.trim()).filter(Boolean);
const ACTION_STOPWORDS = new Set(['the', 'and', 'hers', 'with', 'from', 'while', 'into', 'over', 'both']);

function actionWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((word) => !ACTION_STOPWORDS.has(word))
    .map((word) => word.replace(/(?:ing|ed|s)$/, ''));
}

function coversAction(caption: string, action: string): boolean {
  const words = actionWords(action);
  const available = new Set(actionWords(caption));
  return words.length > 0 && words.every((word) => available.has(word));
}

function shotActionFacts(cast: readonly string[], moment: ShotMoment, facts: readonly StoryFact[]): StoryFact[] {
  const visible = visibleShotText(moment.segment.text);
  return facts.filter((fact) => fact.kind === 'action' && fact.confidence === 'explicit' && fact.evidence &&
    visible.includes(fact.evidence) && cast.includes(fact.subject) &&
    /^[a-z][a-z ,'-]*$/i.test(fact.value) && actionWords(fact.value).length >= 2);
}

function compileReportedActions(image: ImageInsertion, moment: ShotMoment, facts: readonly StoryFact[], withNl: boolean): void {
  const local = shotActionFacts(image.characters.map((c) => c.name), moment, facts);
  for (const character of image.characters) {
    const actions = [...new Set(local.filter((fact) => fact.subject === character.name).map((fact) => fact.value))];
    if (!actions.length) continue;
    const missingTags = actions.filter((action) => !coversAction(character.tag, action));
    const missingNl = actions.filter((action) => !coversAction(character.nl, action));
    character.tag = [...missingTags, ...tags(character.tag)].join(', ');
    if (withNl && missingNl.length) {
      const pronoun = moment.female.includes(character.name) || /\b(?:1girl|girl|woman)\b/i.test(character.tag) ? 'She' : 'He';
      const phrases = missingNl.map((action, index) => {
        const subject = index === 0 ? pronoun : pronoun.toLowerCase();
        const phrase = action.replace(/^(?:she|he|they)\s+/i, '').toLowerCase();
        return /^[a-z]+ing\b/.test(phrase) ? `${subject} is ${phrase}` : `${subject} ${phrase}`;
      });
      const supplement = `${phrases.join(' while ')}.`;
      character.nl = [character.nl, supplement].filter(Boolean).join(' ');
    }
  }
}

/** Bind actor, contact and pose after the per-frame appearance and wardrobe have been applied. */
export function compileShotActions(
  image: ImageInsertion, moment: ShotMoment, withNl: boolean, independent = true, facts: readonly StoryFact[] = [],
): void {
  const actions = moment.actions;
  if (!actions.length) {
    compileReportedActions(image, moment, facts, withNl);
    return;
  }
  const woman = image.characters.find((c) => moment.female.includes(c.name)) ??
    image.characters.find((c) => /\b(?:1girl|girl|woman|female)\b/i.test(c.tag));
  if (!woman) return;
  const compound = actions.includes('kiss') && actions.includes('waist');
  const partner = compound ? image.characters.find((c) => c !== woman && moment.cast.includes(c.name)) ??
    (image.characters.length === 2 ? image.characters.find((c) => c !== woman) : undefined) : undefined;
  const words = actions.map((id) => ACTIONS[id].words);
  const wanted = actions.flatMap((id) => ACTIONS[id].tags);
  // A coat can be on a chair in the same completed beat. Keep the object's relationship in NL.
  if (actions.includes('removeCoat') && /挂|搭在|椅背|衣架/.test(moment.segment.text)) {
    wanted.splice(wanted.indexOf('holding jacket'), 1);
    words[actions.indexOf('removeCoat')] = /衣架|挂/.test(moment.segment.text)
      ? 'hangs the jacket she has just taken off' : 'sets her removed jacket over the chair back';
  }
  const full = actions.some((id) => ACTIONS[id].scale === 'full body');
  const scale = full ? 'full body' : compound || actions.some((id) => ACTIONS[id].scale === 'cowboy shot')
    ? 'cowboy shot' : 'upper body';
  const scene = primaryPlace(visibleShotText(moment.segment.text));
  const groundedBase = scene ? groundScenes(`${image.tag}, ${scene}`, moment.segment.text) : image.tag;
  const base = tags(groundedBase).filter((token) => !SCALE.test(token) && !TIGHT_ANGLE.test(token) &&
    !(compound && /^(?:solo|1girl|1boy|2girls)$/i.test(token)));
  if (compound && partner) {
    const femalePartner = moment.female.includes(partner.name);
    base.unshift(...(femalePartner ? ['2girls'] : ['1girl', '1boy']));
    // A kiss with a waist grip needs both subjects, both lips and the waist in the same view.
    if (!base.some((token) => /from side|three-quarter/i.test(token))) base.push('from side');
    woman.center ??= { x: 0.58, y: 0.5 };
    partner.center ??= { x: 0.42, y: 0.5 };
    const pronoun = femalePartner ? 'her' : 'his';
    const role = femalePartner ? 'The other woman' : 'The man';
    const waistText = moment.continues?.text ?? moment.segment.text;
    const waistAt = waistText.search(ACTIONS.waist.source);
    const lead = waistText.slice(0, waistAt).split(/[。，；]/).at(-1) ?? '';
    const femaleHolds = /她(?!的)/.test(lead) || lead.lastIndexOf(woman.name) > lead.lastIndexOf(partner.name);
    woman.tag = [...new Set(['kissing', ...(femaleHolds ? ['hugging', 'arm around waist'] : ['hugged']),
      ...tags(woman.tag).filter((token) => !OPPOSING_POSE.test(token))])].join(', ');
    partner.tag = [...new Set(['kissing', ...(femaleHolds ? ['hugged'] : ['hugging', 'arm around waist']),
      ...tags(partner.tag).filter((token) => !OPPOSING_POSE.test(token))])].join(', ');
    if (withNl) {
      woman.nl = femaleHolds
        ? `She wraps an arm around ${pronoun} waist as their lips meet in a kiss.`
        : `She kisses ${pronoun === 'his' ? 'him' : 'her'} on the lips as ${pronoun} arm wraps firmly around her waist.`;
      partner.nl = femaleHolds ? `${role} kisses her as she holds ${pronoun} waist.`
        : `${role} holds her waist with one arm while kissing her on the lips.`;
      image.nl = 'In profile, both faces and the arm around the waist are visible as they kiss.';
    }
  } else {
    const text = moment.segment.text;
    const catchCup = actions.includes('catchCup');
    const shield = actions.includes('shield');
    const pickRedBall = actions.includes('pickBall') && /红色.{0,4}球|红球/.test(text);
    if (catchCup && /掉|跌|落|坠/.test(text)) {
      base.push('action lines');
      const prop = /玻璃杯/.test(text) ? 'clear glass' : 'cup';
      const hands = /双手|两手/.test(text) ? 'both of her open palms' : 'her hand';
      const reaches = /俯身|弯腰/.test(text);
      if (reaches) wanted.push('leaning forward');
      words[actions.indexOf('catchCup')] = `catches the falling ${prop} with ${hands}`;
      if (withNl) image.nl = `The falling ${prop} is just meeting ${hands}${reaches ? ' as she lunges forward' : ''}.`;
    }
    if (shield) {
      if (/碎屑/.test(text)) base.push('flying debris');
      if (/火花/.test(text)) base.push('sparks');
      if (withNl && /碎屑|火花/.test(text)) {
        image.nl = 'She holds both arms wide to block the falling debris from reaching the person behind her.';
        words[actions.indexOf('shield')] = 'holds both arms wide to shield the person behind her from falling debris';
      }
    }
    if (pickRedBall) {
      wanted[wanted.indexOf('ball')] = 'red ball';
      words[actions.indexOf('pickBall')] = 'reaches down to pick up the red ball';
    }
    const planPartner = actions.includes('plan') && /另一端|两人/.test(text) &&
      image.characters.find((c) => c !== woman && moment.cast.includes(c.name));
    if (planPartner) {
      planPartner.tag = [...new Set(['holding paper', ...tags(planPartner.tag)])].join(', ');
      words[actions.indexOf('plan')] = 'unfolds the blueprint and grips one edge with both hands';
      if (withNl) {
        planPartner.nl = 'One hand holds the opposite edge of the same blueprint.';
        image.nl = 'They stretch one large blueprint flat between them, each gripping an opposite edge.';
      }
    }
    woman.tag = [...new Set([...wanted, ...tags(woman.tag).filter((token) =>
      !((full || catchCup || actions.includes('kiss')) && OPPOSING_POSE.test(token)) &&
      !(catchCup && /^(?:holding (?:cup|glass)|drinking)$/i.test(token)))])].join(', ');
    if (withNl) {
      const caption = woman.nl || '';
      if (catchCup || shield || pickRedBall || planPartner || !actions.every((id) => ACTIONS[id].picture.test(caption))) {
        const clauses = [...words];
        if (actions.includes('kneel') && /单膝/.test(text)) clauses[actions.indexOf('kneel')] = 'kneels on one knee';
        woman.nl = `She ${clauses.join(' and ')}.`;
      }
    }
  }
  image.tag = [...new Set([...base, scale])].join(', ');
  if (!independent) {
    image.inlineCharacters = true;
    if (withNl && !compound) image.nl = woman.nl;
  }
}

export function shotRepairMessages(moments: readonly ShotMoment[], withNl: boolean, clothes: string): ChatMsg[] {
  return [
    { role: 'system', content: [
      '只给指定的正文镜头补写出图提示词。各位置独立校验，不能换位置、并图或偷换动作。',
      '每张给 position、after（对应句逐字引用）、frameAction（包括同一瞬间每项动作及落点）、focus、tag、characters、size。',
      '必须把实际在场的女性放在画面焦点。人物用原名。两人互动要标出两人及谁对谁、手在哪里、身体姿势、反应；同时看清所有关键接触点。',
      'Base tag 放人数、环境和景别。每个角色的 tag 放自己的动作和相关部位，款式沿用账本。勿写正文未发生的事件。',
      withNl ? 'Base nl 写构图；每个角色的 nl 用一句自然英文绑定动作、人物及具体落点，同一画面包含的动作不能省略。' : 'nl 留空，动作及落点全部用英文短 tag 表达。',
      '只输出 {"images":[{"position":"P1","after":"原句","frameAction":"关键动作","focus":"要看清的位置","tag":"英文 tag","nl":"","characters":[{"name":"原名","tag":"英文 tag","nl":""}],"size":"portrait"}]}。',
      clothes,
    ].filter(Boolean).join('\n') },
    { role: 'user', content: JSON.stringify(moments.map((moment) => ({
      position: moment.segment.id, text: moment.segment.text, previousContact: moment.continues?.text, female: moment.female,
      visibleCast: moment.cast, action: moment.action,
    }))) },
  ];
}
