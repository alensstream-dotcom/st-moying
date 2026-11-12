/**
 * 一次性道具 / 手持物识别。
 *
 * 问题现场：剧情里「刀架在脖子上」「用手把她按住」，模型会在角色 tag 里写
 * `knife at neck`、`collar`、`handcuffs`。这几样一旦被当成服装记进账本，
 * 就会永远留在人身上——刀变成脖子上的挂件、手铐变成饰品。
 *
 * 判定口径：
 * - 纯道具（刀枪绳铐鞭伞书杯…）一律不算服装，也不进「上镜外貌」；
 * - 只有本楼正文还提到它时才在锚点里出现，离开情节就自然消失；
 * - 例外：`wrist cuffs` / `ankle cuffs` / `<颜色> collar` 这类是真饰品，
 *   交给服装词表按原样处理（见 `isPropToken` 里先排掉它们）。
 */

/** 明确道具词。命中即视为临时在画面里的东西。 */
const PROP_WORD =
  /\b(?:knife|kunai|dagger|sword|katana|blade|spear|lance|halberd|bow|arrow|gun|pistol|handgun|revolver|rifle|shotgun|whip|chain|chains|shackles?|handcuffs?|leash|rope|staff|wand|scepter|umbrella|parasol|tray|teacup|cup|mug|bottle|book|notebook|phone|smartphone|tablet|basket|bag|handbag|backpack|suitcase|fan|feather fan|lantern|candle|cigarette|pipe|syringe|stethoscope)\b/i;

/** 真正的饰品写法：即使含 cuffs/collar 也要当服装留着。 */
const ACCESSORY_EXCEPTION = /\b(?:wrist|ankle) cuffs?\b|\bthigh strap\b|\bcollar and leash\b/i;

/** 常驻饰品：既是衣着，又永远不该被当成一次性道具。 */
const ACCESSORY_ONLY =
  /\b(?:choker|necklace|necklace chain|earrings?|piercing|bracelet|bangle|ring|anklet|hairpin|hair ornament|tiara|circlet|glasses|mask|choker with bell)\b/i;

/** 这段 tag 是不是常驻饰品（choker、项链、耳环、腕饰…）。 */
export function isAccessoryToken(token: string): boolean {
  return ACCESSORY_ONLY.test(String(token ?? ''));
}

/**
 * 这一段 tag 是不是「临时道具」。
 *
 * `choker` 是饰品不是项圈；`wrist cuffs` 是饰品不是手铐；纯 `chain` 当锁链。
 */
export function isPropToken(token: string): boolean {
  const value = String(token ?? '').trim();
  if (!value) return false;
  if (ACCESSORY_EXCEPTION.test(value)) return false;
  if (!PROP_WORD.test(value)) return false;
  // 「silver necklace chain」是饰品；单独的 `chain` / `chain leash` 是道具。
  if (ACCESSORY_ONLY.test(value)) return false;
  return true;
}

/** 道具词 → 正文里可能对应的中文写法，用来判断这一楼还在不在用它。 */
const PROP_PROSE: Array<[RegExp, RegExp]> = [
  [/knife|kunai|dagger|blade/i, /刀|匕首|刃/],
  [/sword|katana/i, /剑|刀/],
  [/spear|lance|halberd/i, /枪|矛|戟/],
  [/bow|arrow/i, /弓|箭/],
  [/gun|pistol|handgun|revolver|rifle|shotgun/i, /枪|手枪|步枪/],
  [/whip/i, /鞭/],
  [/handcuffs?|shackles?/i, /手铐|镣铐|铐/],
  [/chain|leash|rope/i, /锁链|链子|铁链|绳子|绳|牵引绳|牵绳/],
  [/staff|wand|scepter/i, /法杖|魔杖|权杖|杖/],
  [/umbrella|parasol/i, /伞/],
  [/tray/i, /托盘/],
  [/teacup|cup|mug|bottle/i, /杯|茶|酒|瓶/],
  [/book|notebook/i, /书|册/],
  [/phone|smartphone|tablet/i, /手机|电话/],
  [/basket|bag|handbag|backpack|suitcase/i, /篮|包|箱/],
  [/fan\b|feather fan/i, /扇/],
  [/lantern|candle/i, /灯笼|烛/],
  [/cigarette|pipe/i, /烟/],
  [/syringe|stethoscope/i, /针|听诊/],
];

/**
 * `collar` 这类词既是真事项圈/颈环，也是「被控制」时模型随手加的错觉。
 * 用单独的判定：只有本楼正文写了颈部饰品才当真的。
 */
const COLLAR_TOKEN = /(?:^|[,\s])(?:(?:metal|black|silver|leather|red|gold|studded|white|blue)\s+)?collars?(?:$|[,\s])/i;

/** 这是不是一条「裸 collar」写法（`collared shirt`、`sailor collar` 不算）。 */
export function isCollarToken(token: string): boolean {
  const value = String(token ?? '').trim();
  if (!value || /\bcollared\b/i.test(value)) return false;
  if (/sailor collar|high collar|fur collar|stand collar|lapel/i.test(value)) return false;
  return COLLAR_TOKEN.test(' ' + value + ' ');
}

/** 本楼正文是否提到了颈部饰品。 */
export function storyMentionsCollar(story: string): boolean {
  return /项圈|颈环|颈圈|项坠|项链|颈链|颈饰|镣铐|手铐|锁链/.test(String(story ?? ''));
}

/** 本楼正文是否还提到这个道具。提到才在锚点里保留，否则当作已经放下。 */
export function storyMentionsProp(token: string, story: string): boolean {
  const value = String(token ?? '');
  if (!value) return false;
  const text = String(story ?? '');
  if (!text.trim()) return false;
  for (const [tag, prose] of PROP_PROSE) if (tag.test(value)) return prose.test(text);
  return false;
}
