import { appearancePolicy, applyAppearancePolicies } from '@/state/appearancePolicy';
import { CHAR_TAG_FIELDS, charAgeBuild, isManualFandom, type CharTagEntry } from '@/state/charTags';
import { resolveCanonicalCharName } from './charReuse';
import { recoverProfileFields } from './profileRecovery';
import type { ImageInsertion } from './protocol';
import { currentIdentityFacts, isMaleIdentity, type IdentityFact } from '@/state/characterIdentity';

const split = (s: string) =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const unique = (parts: string[]) => [...new Map(parts.map((t) => [t.toLowerCase(), t])).values()].join(', ');
/**
 * 戴在身上、留在人身上的饰物。
 *
 * 它们既不是衣服（不该由服装账本管，也不该被 enforceClothing 剥掉），也不是动作，
 * 而是**这个人的固定外观**：发带、发卡、眼镜、项链、耳钉。归 extra 字段。
 */
const ORNAMENT_WORD =
  /\b(?:hair ribbon|hair band|hairband|hairpin|hair clip|hair ornament|hair stick|ribbon|glasses|round glasses|monocle|mask|earrings?|earring|piercing|necklace|pendant|choker|bracelet|bangle|anklet|beret|headband|veil|crown|tiara|circlet|headphones)\b/i;
const TRAIT =
  /\b(?:hair|eyes?|skin|face|eyebrows|eyelashes|bangs|ponytail|braid|ahoge|sidelocks|sideburns|chignon|undercut|dreadlocks|cornrows|mohawk|ringlets|bob|pixie cut|updo|hair buns?|breasts|bust|hips|stature|frame|petite|slim|slender|voluptuous|muscular|tall|flat chest|small frame|pointy ears|elf ears|tsurime|tareme|twintails|hairbun|hair bun|twin tails|fangs|lips|heterochromia|mole|scar|freckles|young adult|mature female|teenager|child)\b/i;
const EXPRESSION =
  /\b(?:closed eyes|half.closed eyes|looking|gaze|eye contact|tears|crying|smiling|smile|blush|expression|breasts out|grabbing|holding|pulling|touching|stroking)\b/i;
const FANDOM = /^[^:]*\s+\\?\([^()]+\\?\)\s*(?:::\s*)?$/;
export function isAppearanceDescription(token: string): boolean {
  token = token.replace(/_/g, ' ');
  if (
    /^(?:wet hair|messy hair|windswept hair|closed eyes|half.closed eyes|blush|smile|smiling|crying|tears|breasts out)$/i.test(
      token,
    )
  )
    return false;
  // 饰物是外观的一部分：`hair ribbon` 含 hair，但它是戴的东西，不是发色发型。
  if (ORNAMENT_WORD.test(token)) return true;
  return (
    !/^(?:looking|holding|grabbing|pulling|touching|stroking)\b/i.test(token) &&
    (TRAIT.test(token) || FANDOM.test(token.replace(/^[-+\d.]+::/, '')))
  );
}
function appearanceParts(entry: CharTagEntry): string[] {
  return appearancePartsFrom(effectiveEntry(entry));
}
/**
 * 老库/手填库常常只存了 raw 整串 tag、结构化字段全空。过去这里直接返回空，
 * 于是「明明建了档案，同楼每张图还是各画各的」。字段为空时从 raw 还原一次。
 */
function effectiveEntry(entry: CharTagEntry): CharTagEntry {
  if (Object.values(entry.fields).some((value) => value && value.trim())) return entry;
  const raw = entry.raw.trim();
  if (!raw || isManualFandom(entry)) return entry;
  return { ...entry, fields: recoverProfileFields(raw) };
}
function appearancePartsFrom(entry: CharTagEntry): string[] {
  // A manual fandom swap must not mix the previous character's physical traits into the new face.
  const p = appearancePolicy(entry.name);
  const fields = isManualFandom(entry)
    ? ([...new Set(['fandom', ...Object.keys(p?.fields ?? {})])] as (keyof typeof entry.fields)[])
    : CHAR_TAG_FIELDS.filter((k) => k !== 'outfit');
  const pinned = p && p.mode !== 'story' ? p.fields : {};
  const parts = fields.flatMap((k) =>
    split(entry.fields[k]).filter(
      (t) =>
        !Object.entries(pinned).some(
          ([field, value]) =>
            field !== k &&
            value &&
            (field === 'hair'
              ? /\b(?:hair|bangs|ponytail|braid)\b/i
              : field === 'eyes'
                ? /\beyes\b/i
                : field === 'skin'
                  ? /\bskin\b/i
                  : /$^/
            ).test(t) &&
            !split(value).some((v) => v.toLowerCase() === t.toLowerCase()),
        ),
    ),
  );
  /**
   * 年龄段要带上骨架词。
   *
   * `CHAR_AGE_BANDS` 每档都配了 build(child → short stature, small frame, flat chest)，
   * 但 `charAgeBuild` 以前**零调用**：档案里写着 child，提示词里只有 `child` 一个词，
   * 出图时高度、体量完全交给模型猜。于是同一个人一会儿小孩一会儿成人，
   * 多人同框时一大一小、女主画得跟掌心那么大。骨架词只补还没写到的那些。
   */
  const build = split(charAgeBuild(entry.fields.age));
  /**
   * 只补「骨架/体量」这一半，不补年龄段本身。
   *
   * age 字段本来就会以自己的原词进 parts（`child`、`young adult`），再拼一遍
   * build 里同名的那个词会重复成 `child, child, loli, ...`。这里只挑 build 里
   * 描述身高/骨架/胸量的 token 补进去——那才是模型缺了就乱画一气的部分。
   */
  const BODY_TOKENS = /\b(?:short stature|small frame|flat chest|slim figure|medium breasts|voluptuous|wide hips|youthful|mature face|lithe|toned|curvy)\b/i;
  const bodyBuild = build.filter((token) => BODY_TOKENS.test(token));
  if (bodyBuild.length) {
    const known = new Set(parts.map((t) => t.toLowerCase()));
    for (const token of bodyBuild) if (!known.has(token.toLowerCase())) parts.push(token);
  }
  return parts;
}

function ownsTrait(entry: CharTagEntry, token: string): boolean {
  if (!isAppearanceDescription(token)) return false;
  entry = effectiveEntry(entry);
  if (isManualFandom(entry) || entry.fields.fandom) return true;
  const f = entry.fields;
  return !!(
    (f.hair &&
      /\b(?:hair|bangs|ponytail|twintails|braid|ahoge|sidelocks|sideburns|chignon|undercut|dreadlocks|cornrows|mohawk|ringlets|bob|pixie cut|updo|hair bun)\b/i.test(
        token,
      )) ||
    (f.eyes && /\b(?:eyes?|heterochromia)\b/i.test(token)) ||
    (f.skin && /\bskin\b/i.test(token)) ||
    (f.body &&
      /\b(?:breasts|bust|hips|stature|frame|petite|slim|slender|voluptuous|muscular|tall|flat chest|small frame)\b/i.test(
        token,
      )) ||
    (f.age && /\b(?:young adult|mature female|teenager|child)\b/i.test(token)) ||
    /**
     * 年龄段也管身高与体量：档案写着 child 时，模型顺手写的 tall 必须被换掉，
     * 否则「档案一个人 + 模型另一个身高」两张图就能差出一个头。
     */
    (f.age &&
      /\b(?:tall|short|petite|slender|delicate|tiny|stature|frame|flat chest|small frame|voluptuous|wide hips)\b/i.test(
        token,
      )) ||
    (f.extra &&
      (ORNAMENT_WORD.test(token) || /\b(?:face|eyebrows|eyelashes|ears|mole|scar|freckles)\b/i.test(token)))
  );
}
function alignNaturalLanguage(entry: CharTagEntry, original: string, canonical: string[]): string {
  entry = effectiveEntry(entry);
  const locked = isManualFandom(entry);
  const plain = (s: string) => s.replace(/^[-+\d.]+::/, '').replace(/::/g, '');
  let result = original.trim();
  if (!result) return canonical.map(plain).join(', ') + '.';
  const first = (value: string, fallback: string) => plain(split(value)[0] ?? fallback);
  const colors =
    'black|white|silver|grey|gray|blond|blonde|golden|brown|auburn|red|pink|blue|navy|green|purple|violet|orange|dark|light|pale|platinum|ash|gold|ash-blonde|chestnut';
  /*
   * 发型的尾巴要一起吃掉。
   *
   * 只替换「dark hair」会留下「her long straight hair in a bun with a hairstyle」这种半截句：
   * 前半是档案值、后半是模型原句，读起来还多了个没头没尾的 hairstyle。所以 hair 后面
   * 紧跟的「in a bun / with a ribbon / tied back」这类描述也一并算进这个词组。
   */
  const STYLE_TAIL =
    '(?:\\s+(?:in|with)\\s+(?:an?\\s+|the\\s+)?(?:buns?|ponytails?|twin tails|twintails|braids?|plaits?|updo|knot|tail|bob(?: cut)?|pixie cut|hair ?band|hair ?clip|hairpin|ribbon)(?:\\s+(?:with\\s+)?(?:an?\\s+)?(?:hairstyle|hair ornament|ribbon|clip|band))?)?(?:\\s+(?:tied|pulled|gathered|tucked|pinned)\\s+(?:back|up|loose|down))?';
  // braided / braid / twin tail 这类修饰也算发型词组的一部分，否则「navy braided hair」匹配不上。
  const hair = new RegExp(
    `\\b(?:(?:${colors}|long|short|straight|curly|wavy|flowing|silky|waist-length|shoulder-length|braided|braid|tied|loose|messy)\\s+){1,5}hair\\b${STYLE_TAIL}`,
    'gi',
  );
  const hairOnce = new RegExp(hair.source, 'i');
  const eyes = new RegExp(
    `\\b(?:(?:${colors}|amber|hazel|ruby|emerald|bright|dark|light|deep)\\s+){1,3}eyes\\b`,
    'gi',
  );
  // 原句有没有写过头发：决定末尾还要不要补一句 Fixed hairstyle，写过就别重复。
  let hadHair = false;
  if (locked || entry.fields.hair) {
    // 句中只放一个泛指 hairstyle，完整档案串交给末尾那句 Fixed hairstyle：把逗号标签
    // 直接塞进句子会读成「her hairstyle, dark brown hair, single side ponytail, smiling」。
    hadHair = hairOnce.test(result);
    result = result.replace(hair, 'hairstyle');
  }
  if (locked || entry.fields.eyes)
    result = result.replace(eyes, locked ? 'eyes' : first(entry.fields.eyes, 'eyes'));
  if (locked || entry.fields.skin)
    result = result.replace(
      /\b(?:(?:pale|fair|white|tan|tanned|dark|brown|smooth|porcelain)\s+){1,3}skin\b/gi,
      locked ? 'skin' : first(entry.fields.skin, 'skin'),
    );
  // age 也进这个分支：档案只写了年龄段、没写 body 时，身高仍然必须锁住
  // （child 骨架词就是 short stature / small frame），否则模型每张图自己挑高矮。
  if (!locked && (entry.fields.body || entry.fields.age)) {
    const breast = split(entry.fields.body).find((t) => /\b(?:breasts|bust)\b/i.test(t));
    result = result.replace(
      /\b(?:large|huge|small|flat|medium|ample)\s+(?:breasts|bust)\b/gi,
      breast ? plain(breast) : 'breasts',
    );
    const figure = split(entry.fields.body).find((t) =>
      /\b(?:figure|slim|slender|voluptuous|petite|muscular|stature|frame)\b/i.test(t),
    );
    result = result.replace(
      /\b(?:slim|slender|voluptuous|petite|muscular)\s+(?:figure|body)\b/gi,
      figure ? plain(figure) : 'figure',
    );
    // 身高/体量也锁：不锁的话模型每张图自己挑「a tall woman / a petite girl」，
    // 同一个人在两张图里能差出一整个头。形容词后面常常还夹着 tanned / beautiful 一串
    // 修饰（the small tanned girl），所以中间的形容词要一并吃掉，否则换了词却没换到人。
    const build = split(charAgeBuild(entry.fields.age)).filter((t) =>
      /\b(?:stature|frame|flat chest)\b/i.test(t),
    );
    // 只换开头那个身高形容词，保留后面的人称与修饰（the small tanned girl → the slim tanned girl）。
    // 整串换掉会把 tanned 这类别的信息一起吞了；档案没写 age 时也还有体量词可顶。
    const stature = (build.join(', ').match(/\b(?:short|small|petite|tall)\b/i)?.[0] ?? '')
      || (figure ?? '').match(/^\w+/)?.[0]
      || '';
    if (stature)
      result = result.replace(
        /\b(?:tall|short|petite|slender|delicate|tiny|small)\b(?=(?:\s+\w+){0,3}\s+(?:woman|girl|figure|stature|frame)\b)/gi,
        stature,
      );
    else if (build.length)
      result = result.replace(
        /\b(?:tall|short|petite|slender|delicate|tiny|small)\s+(?:(?:tanned|tan|pale|fair|young|curvy|busty|beautiful|pretty|lovely|older|elder)\s+)*(?:woman|girl|figure|stature|frame)\b/gi,
        plain(build.join(', ')),
      );
  }
  if (locked) {
    result = result.replace(
      /\b(?:large|huge|small|flat|medium|ample|voluptuous|slender|petite|tall|short|mature|young|blonde|blond|brunette|redheaded)\s+(?=breasts|bust|figure|body|woman|girl|face)/gi,
      '',
    );
    result = result.replace(
      new RegExp(
        `\\b(?:(?:${colors}|long|short|high|low|twin|straight|curly|wavy)\\s+){0,3}(?:ponytail|twintails|twin tails|braids?|bangs)\\b`,
        'gi',
      ),
      'hairstyle',
    );
    result = result
      .replace(/\b(?:tsurime|tareme|almond.shaped|narrow|wide|round|upturned|downturned)\s+eyes\b/gi, 'eyes')
      .replace(
        /\b(?:round|oval|angular|small|sharp|delicate|beautiful|pretty)\s+(?:face|jaw|chin)\b/gi,
        'face',
      )
      .replace(/\b(?:thin|thick|arched|straight)\s+eyebrows\b/gi, 'eyebrows')
      .replace(
        /\b(?:slim|slender|voluptuous|petite|muscular|tall|short|curvy)\s+(?:figure|body|woman|girl)\b/gi,
        'person',
      )
      // 年龄段连同骨架词一起归成泛称，避免模型自己另写一套身高体型。
      .replace(
        /\b(?:child|loli|teenager|young adult|mature female)\b(?:,\s*(?:short stature|small frame|flat chest|slim figure|medium breasts|voluptuous|wide hips|youthful|mature face))*/gi,
        'person',
      );
  }
  if (!locked && entry.fields.hair) {
    // 剩下没被上面吃掉、单独出现的发型词（black ponytail 这种不带 hair 的写法）也归成
    // 泛称。
    result = result.replace(
      /\b(?:(?:short|long|straight|curly|wavy|high|low|single|twin|side|black|blonde?|brown|silver|white|red|blue|pink)\s+){0,5}(?:ponytails?|twintails|twin tails|braids?|bob(?: cut)?|pixie cut|updo|hair buns?)\b/gi,
      'hairstyle',
    );
    // 原句没写过头发时才在末尾补一句：写过就已经在上面替换掉了，重复追加会变成
    // 「Fixed hairstyle: hairstyle, dark brown hair, hairstyle」。
    if (!hadHair) result += ` Fixed hairstyle: ${entry.fields.hair}.`;
  }
  // Tags carry every fixed field. Keep the scene/action prose rather than replacing it with a profile dump.
  return result.replace(/\.{2,}/g, '.').replace(/\s+([.,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** Resolve only named blocks. Never expand @ references or impose traits on unnamed people. */
export function enforceAppearance(
  image: ImageInsertion,
  entries: CharTagEntry[],
  nl: boolean,
  independent: boolean,
  facts: IdentityFact[] = currentIdentityFacts(),
): string[] {
  entries = applyAppearancePolicies(entries);
  const managed: CharTagEntry[] = [],
    warnings: string[] = [];
  for (const prompt of image.characters) {
    // 先归一再判性别/找档案：模型写「阿沉」而库名「陆沉」时，先判 isMaleIdentity 会落空，
    // 男性角色就被当女性去套外貌档案了。
    const name = resolveCanonicalCharName(prompt.name, entries),
      entry = entries.find((e) => e.name === name);
    if (isMaleIdentity(name, facts) && entry?.source !== 'manual') continue;
    if (!entry) continue;
    const canonical = appearanceParts(entry);
    if (!canonical.length) continue;
    managed.push(entry);
    prompt.name = name;
    const known = new Set(canonical.map((t) => t.toLowerCase()));
    const dynamic = split(prompt.tag).filter(
      (t) =>
        !ownsTrait(entry, t) &&
        !known.has(t.toLowerCase()) &&
        !(entry.fields.sex && /^(?:\d+)?(?:girls?|boys?|woman|man|female|male)$/i.test(t)),
    );
    const changed = split(prompt.tag).some((t) => isAppearanceDescription(t) && !known.has(t.toLowerCase()));
    prompt.tag = unique([...canonical, ...dynamic]);
    if (nl) {
      prompt.nl = alignNaturalLanguage(entry, prompt.nl, canonical);
    } else prompt.nl = '';
    if (changed)
      warnings.push(
        `${name}: 本次人物外貌已校正为${isManualFandom(entry) ? '手动锁定的同人形象' : '人物库档案'}`,
      );
  }
  if (managed.length && independent) {
    const all = new Set(
      managed
        .flatMap(appearanceParts)
        .filter((t) => !/^\d+(?:girl|boy)s?$/i.test(t))
        .map((t) => t.toLowerCase()),
    );
    image.tag = split(image.tag)
      .filter((t) => !managed.some((e) => ownsTrait(e, t)) && !all.has(t.toLowerCase()))
      .join(', ');
    if (nl)
      image.nl = image.nl
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !TRAIT.test(s))
        .join(' ');
  } else if (managed.length && image.characters.length === 1) {
    image.tag = unique([
      ...split(image.tag).filter((t) => !isAppearanceDescription(t)),
      ...split(image.characters[0].tag),
    ]);
    if (nl) image.nl = image.characters[0].nl;
  }
  return warnings;
}
