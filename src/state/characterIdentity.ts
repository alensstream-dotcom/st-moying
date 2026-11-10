import { reactive } from 'vue';
import { getContext } from '@/st/context';
import { stripImageTags } from '@/st/imageTagRegex';
import type { CharTagEntry } from './charTags';
import type { ImageInsertion } from '@/autoTag/protocol';

export type IdentityGender = 'female' | 'male' | 'unknown';
export interface IdentityClaim {
  name: string;
  gender: IdentityGender;
  heroine: boolean;
  background?: boolean;
  aliases?: string[];
  source: 'story' | 'card' | 'worldbook' | 'book';
  evidence: string;
  reason: string;
}
export interface IdentityFact extends Omit<IdentityClaim, 'source'> {
  source: IdentityClaim['source'] | 'manual';
  conflict?: string;
}
export interface IdentitySources {
  story: string;
  card: string;
  worldbook: string;
  book: Array<{ name: string; gender?: string }>;
}
export const IDENTITY_EXTRA_KEY = 'moying_identity_evidence_v1';
const KEY = 'moying_identity_review_v1';
interface ReviewData {
  v: 1;
  manual: IdentityFact[];
  audit?: { revision: string; facts: IdentityFact[] };
  undo: Array<{ manual: IdentityFact[]; audit?: ReviewData['audit'] }>;
}
export const identityUi = reactive({ revision: 0, busy: false, feedback: '' });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 1000) : '');
export function identityHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
export const identityStoryHash = (value: string) => identityHash(stripImageTags(value).replace(/\s+/g, ''));
export function identityContextHash(): string {
  const ctx = getContext();
  const card = ctx?.characters?.[Number(ctx?.characterId)] as Record<string, unknown> | undefined;
  const data = card?.data as Record<string, unknown> | undefined;
  const fields = [
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'creator_notes',
    'character_book',
  ];
  // last_chat/date_last_chat may change on save; they are not identity-setting edits.
  return identityHash(
    JSON.stringify([ctx?.characterId, ctx?.groupId, fields.map((k) => [card?.[k], data?.[k]])]),
  );
}
export function identityAuditRevision(): string {
  return identityHash(
    identityContextHash() +
      JSON.stringify(getContext()?.chat.map((m) => [m.swipe_id ?? 0, identityStoryHash(m.mes)]) ?? []),
  );
}
function reviewData(): ReviewData {
  const raw = getContext()?.chatMetadata?.[KEY] as ReviewData | undefined;
  return raw?.v === 1 && Array.isArray(raw.manual) && Array.isArray(raw.undo)
    ? copy(raw)
    : { v: 1, manual: [], undo: [] };
}
export function identityManualRevision(): string {
  return JSON.stringify(reviewData().manual);
}
export function parseIdentityClaims(raw: unknown): IdentityClaim[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 150).flatMap((v): IdentityClaim[] => {
    if (!v || !text(v.name)) return [];
    return [
      {
        name: text(v.name),
        gender: ['male', 'female'].includes(v.gender) ? v.gender : 'unknown',
        heroine: v.heroine === true,
        background: v.background === true,
        source: ['story', 'card', 'worldbook', 'book'].includes(v.source) ? v.source : 'story',
        evidence: text(v.evidence),
        reason: text(v.reason),
        aliases: Array.isArray(v.aliases) ? v.aliases.map(text).filter(Boolean).slice(0, 20) : [],
      },
    ];
  });
}
export function structuredGender(value: unknown): IdentityGender {
  return /^(?:男|男性|男人|male|man|boy)$/i.test(text(value))
    ? 'male'
    : /^(?:女|女性|女人|female|woman|girl)$/i.test(text(value))
      ? 'female'
      : 'unknown';
}
const MALE =
  '(?:男性|男人|男子|男孩|男生|男修|男主角|男主|男学生|男高中生|男大学生|男老师|公子|少爷|师兄|父亲|儿子|丈夫|哥哥|弟弟|male|man|boy|男)';
const FEMALE =
  '(?:女性|女人|女子|女孩|女生|女修|女主角|女主|女学生|女高中生|女大学生|女老师|女教师|女仆|少女|师姐|母亲|女儿|妻子|姐姐|妹妹|夫人|太太|female|woman|girl|女)';
function subjectGender(name: string, quote: string, structured = false): IdentityGender {
  // A quote mentioning a woman next to a man is not evidence of the man's gender.
  // Require a direct assertion, structured label, or adjacent gendered apposition.
  if (
    /不是|并非|非男|非女|假如|假设|梦境|回忆中|女扮|男扮|伪装|变身|变成|disguis|transform|dream|not a|isn't/i.test(
      quote,
    )
  )
    return 'unknown';
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bound = (gender: string) => {
    const label = structured
      ? `${n}\\s*[:：,，(（\\[]\\s*(?:性别\\s*[:：]?\\s*)?${gender}(?:角色|之一|本人)?(?=$|[\\s)）\\],，;；·。.])|`
      : '';
    return new RegExp(
      `(?:${label}${n}\\s*(?:是|为|乃|作为|is|was)\\s*(?:(?:一名|一位|一个|个|位|年轻的|俊美的|长发的|美丽的|a|an)\\s*){0,4}${gender}(?:角色|之一|本人)?(?=$|[\\s,，。.;；])|${gender}\\s*${n}(?=$|[\\s,，。.;；]))`,
      'i',
    ).test(quote);
  };
  const labelled = (gender: string) =>
    new RegExp(
      `${n}\\s*(?:[\\r\\n,，;；]\\s*)?(?:性别|gender|sex)\\s*[:：]\\s*${gender}(?=$|[\\s,，。.;；])`,
      'i',
    ).test(quote);
  const male = bound(MALE) || labelled(MALE),
    female = bound(FEMALE) || labelled(FEMALE);
  return male === female ? 'unknown' : male ? 'male' : 'female';
}
export function assessIdentityClaims(claims: IdentityClaim[], sources: IdentitySources): IdentityFact[] {
  const facts: IdentityFact[] = [];
  for (const role of sources.book) {
    const gender = structuredGender(role.gender);
    if (gender !== 'unknown')
      facts.push({
        name: role.name,
        gender,
        heroine: false,
        source: 'book',
        evidence: `${role.name}: 性别=${role.gender}`,
        reason: '柏宝书结构化性别字段；女主资格另行判断',
      });
  }
  for (const c of claims) {
    const book = sources.book.find((r) => r.name === c.name),
      bookGender = structuredGender(book?.gender);
    const origin = c.source === 'book' ? '' : sources[c.source];
    const verified =
      bookGender !== 'unknown'
        ? bookGender
        : c.source === 'book'
          ? bookGender
          : c.evidence && origin.includes(c.evidence)
            ? subjectGender(c.name, c.evidence, c.source !== 'story')
            : 'unknown';
    const gender = bookGender === 'male' ? 'male' : verified;
    if (gender === 'unknown' || c.gender !== gender) {
      facts.push({
        ...c,
        aliases: [],
        gender: 'unknown',
        heroine: false,
        reason: '没有可验证且明确归属于该人物的性别依据；绘图标签、长相、女装不能作为依据',
      });
    } else
      facts.push({
        ...c,
        gender,
        heroine: gender === 'female' && c.heroine && c.reason.length >= 4,
        aliases:
          c.source !== 'book' &&
          origin.includes(c.evidence) &&
          c.evidence.includes(c.name) &&
          /又名|别名|也叫|亦称|也称|原名|alias|also known|aka/i.test(c.evidence)
            ? (c.aliases ?? []).filter((a) => c.evidence.includes(a) && a !== c.name)
            : [],
        ...(bookGender !== 'unknown'
          ? { source: 'book' as const, evidence: `${c.name}: 性别=${book?.gender}` }
          : {}),
      });
  }
  return mergeIdentityFacts(facts);
}
export function mergeIdentityFacts(facts: IdentityFact[]): IdentityFact[] {
  const groups = new Map<string, IdentityFact[]>();
  for (const f of facts) if (f?.name) groups.set(f.name, [...(groups.get(f.name) ?? []), f]);
  return [...groups.values()].map((list) => {
    const aliases = [...new Set(list.filter((f) => f.gender !== 'unknown').flatMap((f) => f.aliases ?? []))];
    const manual = list.filter((f) => f.source === 'manual').at(-1);
    if (manual) return { ...copy(manual), aliases };
    const males = list.filter((f) => f.gender === 'male'),
      females = list.filter((f) => f.gender === 'female');
    if (males.length)
      return {
        ...males[males.length - 1],
        aliases,
        heroine: false,
        ...(females.length ? { conflict: '存在男女身份冲突，已暂停自动女性档案，等待核对' } : {}),
      };
    if (females.length)
      return { ...females[females.length - 1], aliases, heroine: females.some((f) => f.heroine) };
    return copy(list[list.length - 1]);
  });
}
export function currentIdentityFacts(): IdentityFact[] {
  const ctx = getContext(),
    contextHash = identityContextHash(),
    facts: IdentityFact[] = [];
  for (const message of ctx?.chat ?? []) {
    const raw = message.extra?.[IDENTITY_EXTRA_KEY] as
      | { v?: number; swipe?: number; sourceHash?: string; contextHash?: string; facts?: IdentityFact[] }
      | undefined;
    if (
      raw?.v === 1 &&
      raw.swipe === (message.swipe_id ?? 0) &&
      raw.sourceHash === identityStoryHash(message.mes) &&
      raw.contextHash === contextHash &&
      Array.isArray(raw.facts)
    )
      facts.push(...raw.facts);
  }
  const data = reviewData();
  if (data.audit?.revision === identityAuditRevision()) facts.push(...data.audit.facts);
  return mergeIdentityFacts([...facts, ...data.manual]);
}
export function identityFactFor(name: string, facts = currentIdentityFacts()): IdentityFact | undefined {
  const exact = facts.find((f) => f.name === name);
  if (exact) return exact;
  const aliases = facts.filter((f) => f.aliases?.includes(name));
  return aliases.length === 1 ? aliases[0] : undefined;
}
export function isMaleIdentity(name: string, facts = currentIdentityFacts()): boolean {
  return identityFactFor(name, facts)?.gender === 'male';
}
export function identityEntrySuspended(entry: CharTagEntry, facts = currentIdentityFacts()): boolean {
  if (entry.source === 'manual') return false;
  const fact = identityFactFor(entry.name, facts);
  return !!fact && (fact.gender === 'male' || (fact.source === 'manual' && !fact.heroine));
}
export function eligibleIdentityEntries(
  entries: CharTagEntry[],
  facts = currentIdentityFacts(),
): CharTagEntry[] {
  return entries.filter((e) => !identityEntrySuspended(e, facts));
}
export function mayCreateHeroine(name: string, facts: IdentityFact[]): boolean {
  const fact = identityFactFor(name, facts);
  const unnamed =
    /^(?:路人|女路人|路人女|无名|不知名|某个?|一名|一个|女服务员|女店员|女学生|少女|女子|女人|女孩|女生|女性)(?:[甲乙丙丁A-Z0-9一二三四五]*)$/i.test(
      name.trim(),
    );
  return (
    fact?.gender === 'female' &&
    !fact.background &&
    !unnamed &&
    !fact.conflict &&
    !(fact.source === 'manual' && !fact.heroine)
  );
}
function saveReview(next: ReviewData): void {
  const ctx = getContext();
  if (!ctx?.chatMetadata) throw new Error('请先打开聊天');
  ctx.chatMetadata[KEY] = next;
  ctx.saveMetadataDebounced?.();
  identityUi.revision++;
}
function withUndo(): ReviewData {
  const data = reviewData();
  data.undo.push(copy({ manual: data.manual, audit: data.audit }));
  data.undo = data.undo.slice(-20);
  return data;
}
export function confirmCharacterIdentity(name: string, gender: IdentityGender, heroine: boolean): void {
  const known = identityFactFor(name),
    canonical = known?.name ?? name;
  const data = withUndo();
  data.manual = data.manual.filter((f) => f.name !== canonical);
  data.manual.push({
    name: canonical,
    aliases: known?.aliases ?? [],
    gender,
    heroine: gender === 'female' && heroine,
    source: 'manual',
    evidence: '用户确认',
    reason: '用户明确确认人物身份与女主资格',
  });
  saveReview(data);
}
export function applyIdentityAudit(facts: IdentityFact[], revision: string): void {
  if (identityAuditRevision() !== revision)
    throw new Error('检查期间聊天、正文或角色卡已变化，本次没有保存审核结果');
  const data = withUndo();
  data.audit = { revision, facts };
  saveReview(data);
}
export function undoIdentityReview(): void {
  const data = reviewData(),
    prior = data.undo.pop();
  if (!prior) return;
  data.manual = prior.manual;
  data.audit = prior.audit;
  saveReview(data);
}
/** Stop an old auto-created female profile from being forced into a known man's request. */
export function enforceKnownMaleIdentity(
  image: ImageInsertion,
  entries: CharTagEntry[],
  facts = currentIdentityFacts(),
  independent = true,
): string[] {
  const notes: string[] = [];
  for (const c of image.characters) {
    if (!isMaleIdentity(c.name, facts)) continue;
    const entry = entries.find((e) => e.name === c.name);
    if (entry?.source === 'manual') {
      notes.push(`${c.name}: 剧情身份为男性，保留用户手动绘图形象，请核对冲突`);
      continue;
    }
    const old = new Set(
      entry
        ? Object.entries(entry.fields)
            .filter(([k]) => k !== 'outfit')
            .flatMap(([, v]) => v.split(',').map((t) => t.trim().toLowerCase()))
            .filter(Boolean)
        : [],
    );
    c.tag = [
      '1boy',
      'faceless male',
      ...c.tag
        .split(',')
        .map((t) => t.trim())
        .filter(
          (t) =>
            t &&
            !old.has(t.toLowerCase()) &&
            !/\b(?:girls?|woman|women|female|breasts|bust|pussy|vagina|hair|eyes|bangs|ponytail|braids?|petite|voluptuous)\b/i.test(
              t,
            ) &&
            !/^\d+(?:girl|boy)s?$/i.test(t) &&
            !/\s+\\?\([^)]*\)/.test(t),
        ),
    ].join(', ');
    c.nl = c.nl
      .split(/(?<=[.!?])\s+/)
      .filter(
        (s) => !/^(?:she|the girl|the woman|a girl|a woman)\b|\b(?:female|breasts|hair|eyes)\b/i.test(s),
      )
      .join(' ');
    notes.push(`${c.name}: 男性身份已确认，跳过错误自动女性档案`);
  }
  if (
    notes.length &&
    image.characters.every(
      (c) =>
        identityFactFor(c.name, facts)?.gender &&
        identityFactFor(c.name, facts)?.gender !== 'unknown' &&
        entries.find((e) => e.name === c.name)?.source !== 'manual',
    )
  ) {
    const counts = (['female', 'male'] as const).flatMap((g) => {
      const count = image.characters.filter((c) => identityFactFor(c.name, facts)?.gender === g).length;
      return count ? [`${count}${g === 'female' ? 'girl' : 'boy'}${count > 1 ? 's' : ''}`] : [];
    });
    image.tag = [
      ...counts,
      ...image.tag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => !/^\d+(?:girl|boy)s?$/i.test(t)),
    ].join(', ');
  }
  if (
    notes.length &&
    image.characters.length === 1 &&
    entries.find((e) => e.name === image.characters[0].name)?.source !== 'manual'
  ) {
    image.tag = image.tag
      .split(',')
      .map((t) => t.trim())
      .filter(
        (t) =>
          !/\b(?:girls?|woman|female|breasts|hair|eyes|bangs|voluptuous)\b/i.test(t) &&
          !/\s+\\?\([^)]*\)/.test(t),
      )
      .join(', ');
    if (!independent)
      image.tag = [
        ...new Set([
          ...image.tag
            .split(',')
            .map((t) => t.trim())
            .filter((t) => !/^\d+(?:girl|boy)s?$/i.test(t)),
          ...image.characters[0].tag.split(',').map((t) => t.trim()),
        ]),
      ].join(', ');
  }
  return notes;
}

export const IDENTITY_PROTOCOL = `人物入库审核：最终 JSON 增加 identities:[{name,gender:"female|male|unknown",heroine:true/false,background:true/false,source:"story|card|worldbook|book",evidence,reason,aliases:[]}]。
为本节新建档候选、明确男性和已有档案中出现身份冲突的人报告。女性有明确姓名、稳定身份或可持续识别的称谓，首次出场即建档，不要求主要女主、持续参与或多楼观察。background=true 仅用于无名路人、背景群众、一次性泛称人物；具名女性配角也要建档。heroine 字段兼容旧格式，表示可入女性角色库而非主角地位。
evidence 必须逐字引用真实设定/正文中直接归属于该人物的性别说明，包含原文姓名。柏宝书结构化 gender 字段可用 source=book。长发、漂亮、女装、身体外观、1girl、素材、旧绘图档案和图片都不是性别证据。
张明看着她不证明张明是女性；同段出现“女子”不能证明其他人物是女性。伪装、假设、梦境、变身不改变现实身份。没有可靠依据填 unknown，照常为本张图写角色块，但不写 changes.new。
aliases 只填原文明确说明的同一人别名，并把“又名/别名/也叫”等证明连同性别依据引用到 evidence；外形相似或同姓称谓不能作为别名依据。
已验证女性、具有可识别身份且 background!=true 时，当次必须输出 changes.new（即使本节没有为她安排图片），外貌缺项合理补全；不要等待下一楼。明确男性即便有名有姓也不进入女主库。手动绘图形象不用于推断身份，不改动用户手动同人选择。禁止根据相似长相认人。`;
