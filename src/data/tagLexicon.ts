import lexicon from '@/data/tagLexicon.json';
import tagChinese from '@/data/tagChinese.json';

/**
 * 词表菜单。
 *
 * 素材来自「渡鸦的构图鉴」(novelai.quicktagcloud 的 raven_composition，6,633 条)：
 * 排除角色图鉴、传统服饰、秋季课堂、二创属性、招牌梗、身份设定与画风七个大类，
 * 其余按条目 path 归到下面的十类；与本仓库既有的 danbooru 词表合并时以本站词条为准。
 * 构建脚本见 tools/build-lexicon。
 * 用途只有一个：给模型一份**封闭候选**，让它挑准词，而不是拿近似 tag 凑。
 *
 * 为什么要给菜单而不是只给规则：实机 8 张图里，模型在没有精确词的时候稳定地
 * 用 `pov`、`against wall`、`hand on head` 顶上——这些词确实存在于 danbooru，
 * 于是它「合法地」选了一个语义不同的短语。给菜单把「能不能选」变成闭集，
 * 选不出就只能写 nl，画面才跟着正文走。
 */
export interface TagLexicon {
  clothing: string[];
  appearance: string[];
  body: string[];
  expression: string[];
  pose: string[];
  interaction: string[];
  scene: string[];
  light: string[];
  camera: string[];
  prop: string[];
}

export const TAG_LEXICON = lexicon as TagLexicon;

const LABELS: Array<[keyof TagLexicon, string]> = [
  ['camera', '景别与机位'],
  ['light', '光线'],
  ['scene', '场景与背景'],
  ['clothing', '服装与配饰'],
  ['appearance', '发型与眼睛'],
  ['body', '身体特征与属性'],
  ['expression', '表情与视线'],
  ['pose', '姿势与体态'],
  ['interaction', '动作与互动'],
  ['prop', '道具'],
];

/**
 * 单类上限。词表一共 4,600 余条，全量下发要吃掉三万多字符，收益远不如把
 * 「同一类里挑一个」压成闭集；服装给得最多，因为换装与穿衣细节是这条链路上
 * 最容易写错的一环，姿势/互动次之，道具只留最常出现的几十个。
 */
const LIMITS: Record<keyof TagLexicon, number> = {
  // camera / light 是**判断类**：用哪种视角、哪种光，取决于这一刻怎么拍好看、是否符合情境，
  // 不是正文里点了名的名词。所以这两类不截断，全量给模型当封闭池自选（91 + 108 条，成本可忽略）。
  camera: TAG_LEXICON.camera.length,
  light: TAG_LEXICON.light.length,
  // 菜单每一条都要模型读一遍，实测 16K 字符的菜单把单次请求拖到 2–5 分钟。
  // 截断留给「常见词」，具体款式/场景靠本楼检索补（见下），判断类不给上限。
  scene: 70,
  clothing: 150,
  appearance: 40,
  body: 24,
  expression: 60,
  pose: 80,
  interaction: 50,
  prop: 16,
};


/**
 * 本楼检索：把「正文里真的说了、但没挤进菜单」的词补到菜单尾部。
 *
 * 菜单是固定截断（服装只发 420 / 2,740），被截掉的往往是具体款式：开襟衫、吊带、
 * 水手领、灯笼裤。模型看不见这些词时只有两条路——写个近似的（把开襟衫写成 jacket），
 * 或者交给 nl。前者正是「tag 不准」的来源。
 *
 * 这里用 danbooru 中文对照表做索引：正文里出现了某个词的中文名，就把对应英文 tag
 * 追加进来。这是**检索**不是生成，词仍是词表里的原词，只是按这一楼的内容现挑。
 */
/**
 * 只参与检索的分类。
 *
 * camera / light 被排除在外：视角与光线是模型的判断（这一刻从哪个角度拍、用什么光
 * 才贴合情境），不是「正文里出现过的名词」。让它们跟着文字走，等于把构图降级成
 * 关键词命中——正文写「光从窗进来」就只给 window light，模型再也没机会选 chiaroscuro
 * 或 rim lighting。这两类走全量菜单，由模型自己决定后从表里挑。
 */
const RETRIEVABLE = LABELS.filter(([key]) => key !== 'camera' && key !== 'light');

const REVERSE: Array<{ zh: string; en: string }> = (() => {
  const known = new Set(RETRIEVABLE.flatMap(([key]) => TAG_LEXICON[key]));
  const rows: Array<{ zh: string; en: string }> = [];
  for (const [en, zh] of Object.entries(tagChinese as Record<string, string>)) {
    const tag = en.trim().toLowerCase();
    const name = String(zh ?? '').trim();
    if (!known.has(tag)) continue;
    if (name.length < 2 || name.length > 8) continue;
    rows.push({ zh: name, en: tag });
  }
  return rows.sort((a, b) => b.zh.length - a.zh.length);
})();

/**
 * 口语别名：danbooru 中文名偏书面（camisole = 无袖紧身背心、serafuku = 水手服），
 * 正文里写的是「吊带」「水手服」。这里只补常用的一小撮，映射到的英文词同样必须在词表内。
 */
const ALIASES: Array<[string, string]> = [
  ['吊带', 'camisole'], ['开衫', 'cardigan'], ['开襟', 'cardigan'],
  ['水手服', 'serafuku'], ['制服', 'school uniform'], ['校服', 'school uniform'],
  ['泳装', 'swimsuit'], ['泳衣', 'swimsuit'], ['连体泳衣', 'one-piece swimsuit'],
  ['百褶裙', 'pleated skirt'], ['格纹裙', 'plaid skirt'], ['过膝袜', 'thighhighs'],
  ['长袜', 'kneehighs'], ['领结', 'neckerchief'], ['领带', 'necktie'],
  ['衬衫', 'shirt'], ['连衣裙', 'dress'], ['背心', 'tank top'], ['短裤', 'shorts'],
  ['牛仔裤', 'jeans'], ['高跟鞋', 'high heels'], ['运动鞋', 'sneakers'],
  ['围巾', 'scarf'], ['手套', 'gloves'], ['眼镜', 'glasses'], ['马尾', 'ponytail'],
  ['双马尾', 'twintails'], ['短发', 'short hair'], ['长发', 'long hair'], ['呆毛', 'ahoge'],
  ['呆毛', 'ahoge'], ['哥特裙', 'gothic dress'], ['旗袍', 'china dress'],
];

const ALIAS_ROWS: Array<{ zh: string; en: string }> = (() => {
  const known = new Set(RETRIEVABLE.flatMap(([key]) => TAG_LEXICON[key]));
  return ALIASES.filter(([, en]) => known.has(en)).map(([zh, en]) => ({ zh, en }));
})();

/** 从本楼正文里检索词表内的词；按「命中的中文名越长越具体」排序，最多 limit 条。 */
export function retrieveLexiconWords(text: string, limit = 150): string[] {
  const body = (text ?? '').replace(/\s+/g, ' ');
  if (!body) return [];
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const { zh, en } of [...ALIAS_ROWS, ...REVERSE]) {
    if (picked.length >= limit) break;
    if (seen.has(en)) continue;
    if (!body.includes(zh)) continue;
    seen.add(en);
    picked.push(en);
  }
  return picked;
}

/** 本楼检索段；没有命中时返回空串（不占提示词）。 */
export function retrievedMenuBlock(text: string, limit = 150): string {
  const words = retrieveLexiconWords(text, limit);
  if (!words.length) return '';
  return [`[from this floor] 本楼正文提到的：${words.join(', ')}`, '这一行是按本楼正文现挑的，和上面的表同一个封闭集。'].join('\n');
}


let cached = '';

/** 渲染成一段可直接压进 system 的菜单；同一进程内只算一次。 */
export function lexiconMenuBlock(floorText = ''): string {
  if (!floorText && cached) return cached;
  const sections = LABELS.map(([key, label]) => {
    const words = TAG_LEXICON[key].slice(0, LIMITS[key]);
    return `[${key}] ${label}：${words.join(', ')}`;
  });
  const retrieved = floorText ? retrievedMenuBlock(floorText) : '';
  const block = [
    '<Menu>',
    '下面是本管线允许的 tag 词汇表，按类分组。取词规则：',
    '- 画面里要表达的东西，先在这里找；找到就用表里的原词，不要改写词形（不要 long straight hair，表里写 long hair, straight hair 就照写两词）。',
    '- 表里找不到精确说法时，把这件事写进 nl，不要挑一个近义 tag 顶替。',
    '- 表外只允许正文里实际出现的专有名词（地点、服装款式、道具），以及人数词（1girl / 1boy / 2girls）。',
    '- 表里的词只描述看得见的东西：不要拿它当剧情标签，也不要为了凑满画面把不在本楼的词堆进去。',
    '- [camera] 与 [light] 是**你判断后自选**的两类：先想这一刻从哪个角度、用什么光最能交代情境与情绪，再从这两张表里挑词；不要因为正文没写「俯视」「逆光」就省略，也不要自己另造说法。',
    '- 其余各类按正文与账本取词；找不到精确词就写 nl。',
    ...sections,
    ...(retrieved ? [retrieved] : []),
    '</Menu>',
  ].join('\n');
  if (!floorText) cached = block;
  return block;
}

/**
 * 景别的互斥组：一张图只有一个取景尺度。
 *
 * 模型会同时写 `cowboy shot` + `full body`、`upper body` + `full body`——这两个在 NAI 里
 * 不是叠加而是打架，画面最后取哪个由采样决定，于是同一段正文两次出图一大一小。
 * 这里保留模型先写的那个（顺序是它表达重点的手段），其余丢掉。
 */
const SHOT_SCALES = ['wide shot', 'full body', 'cowboy shot', 'medium shot', 'upper body', 'portrait', 'close-up'];

/** 词表全部词（小写），合成词拆分时用。 */
const KNOWN_WORDS: Set<string> = new Set(
  LABELS.flatMap(([key]) => TAG_LEXICON[key]).map((word) => word.toLowerCase()),
);

/**
 * 合成词拆分：模型爱把两个词粘成一个（`long straight hair`），NAI 读不懂这个词，
 * 只会把它当一串字符乱猜。规则是只拆「每个修饰词都能和同一个中心词组成表内词」的情况：
 *   long straight hair → long hair, straight hair
 *   black long hair   → black hair, long hair
 * 拆不动（例如 blue pleated skirt 里 blue skirt 不在表内）就原样留着，不硬猜。
 */
function splitCompound(token: string): string[] | null {
  const words = token.toLowerCase().split(' ').filter(Boolean);
  if (words.length < 3) return null;
  if (KNOWN_WORDS.has(token.toLowerCase())) return null;
  for (const headSize of [2, 1]) {
    if (words.length <= headSize) continue;
    const head = words.slice(words.length - headSize).join(' ');
    const mods = words.slice(0, words.length - headSize);
    const parts = mods.map((mod) => `${mod} ${head}`);
    if (parts.length >= 2 && parts.every((part) => KNOWN_WORDS.has(part))) return parts;
  }
  return null;
}

/**
 * 同义词家族：词表里同时存在「同一个东西的两种叫法」，模型会把它们一起写出来
 * （`white blouse, collared shirt`、`denim shorts, jean shorts`）。两个词在
 * NAI 里指向同一种衣物，等于把同一件衣服写了两遍权重，还把 prompt 撑长。
 *
 * 这里只收「确实指同一物」的组，不认同义词（shirt 与 blouse 在词表里都指衬衣，
 * 合并时保留模型先写的那个——顺序是它表达重点的手段）。
 */
const SYNONYM_FAMILIES: string[][] = [
  ['blouse', 'shirt', 'collared shirt', 'dress shirt'],
  ['jean shorts', 'denim shorts'],
  ['jeans', 'denim pants'],
  ['hair blowing', 'hair in wind', 'hair lift'],
  ['thighhighs', 'thigh highs', 'kneehighs', 'knee socks', 'socks'],
  ['panties', 'underwear'],
  ['bra', 'brassiere'],
  ['bag', 'handbag', 'school bag'],
];

const SYNONYM_OWNER = new Map<string, string>();
for (const family of SYNONYM_FAMILIES) for (const word of family) SYNONYM_OWNER.set(word, family[0]);

/**
 * 同族只留第一个：`white blouse, collared shirt` → `white blouse`。
 * 在 normaliseLexiconTag 里做，序列化与发送前都会经过，存量楼层也会被纠正。
 */
function collapseSynonyms(pieces: string[]): string[] {
  const used = new Set<string>();
  const kept: string[] = [];
  for (const piece of pieces) {
    // 词表里的家族是「中心词」，模型写的常带颜色与材质（white blouse / collared shirt），
    // 所以按后缀匹配：取这一段末尾 1–3 个词，能被家族认领就归到那个家族。
    const words = piece.toLowerCase().split(' ').filter(Boolean);
    let owner = '';
    for (let size = Math.min(3, words.length); size >= 1 && !owner; size -= 1) {
      owner = SYNONYM_OWNER.get(words.slice(words.length - size).join(' ')) ?? '';
    }
    if (owner) {
      if (used.has(owner)) continue;
      used.add(owner);
    }
    kept.push(piece);
  }
  return kept;
}

/**
 * tag 规范化：拆合成词、景别只留一个、同词去重。
 * 不改顺序（顺序＝模型表达的重点），不改词形（词表写了什么就照写）。
 */
const MALE_FEMININE_STATE = /^(?:arched back|spread legs|spread pussy|clitoris|pussy juice|blush|moaning|trembling|heavy breathing|ahegao|panties|bra|breasts|nipples|areolae|cleavage|spread arms?)$/i;

/**
 * 男主块里被塞进女性的身体状态时清掉——模型会把同一段动作的描述复制给两个人，
 * 画出来就是一个张腿呻吟的男人。男性块只保留他的动作与施动部位。
 */
export function stripMaleEcho(tag: string): string {
  const parts = tag.split(',').map((t) => t.trim()).filter(Boolean);
  if (!parts.some((t) => /^1boy$/i.test(t))) return tag;
  return parts.filter((t) => !MALE_FEMININE_STATE.test(t)).join(', ');
}

export function normaliseLexiconTag(tag: string): string {
  if (!tag) return tag;
  const pieces = tag
    .split(',')
    .map((piece) => piece.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const expanded: string[] = [];
  for (const piece of pieces) {
    const parts = splitCompound(piece);
    if (parts) expanded.push(...parts);
    else expanded.push(piece);
  }
  const seen = new Set<string>();
  const kept: string[] = [];
  let scale = '';
  for (const piece of expanded) {
    const low = piece.toLowerCase();
    if (SHOT_SCALES.includes(low)) {
      if (scale) continue;
      scale = low;
    }
    if (seen.has(low)) continue;
    seen.add(low);
    kept.push(piece);
  }
  return collapseOnepiece(collapseSynonyms(kept)).join(', ');
}

/**
 * 连体衣只留一件。
 *
 * 模型常在同一个角色块里把同一件衣服写三遍：`nightgown, white dress, short dress`
 * （实测第 0 楼）。NAI 侧这些是同一件「连衣裙/睡裙」的三个同义词，写三遍等于把
 * 这件衣服的权重乘三，画面里裙子的存在感压过其他一切，也把「短」和「白」拆散在
 * 三个词里。同格位只保留描述最充分的那一个（词数多的），其余丢掉。
 */
const ONEPIECE_TAILS = new Set([
  'dress',
  'gown',
  'nightgown',
  'nightdress',
  'pajamas',
  'pyjamas',
  'swimsuit',
  'bikini',
  'leotard',
  'bodysuit',
  'serafuku',
]);

function collapseOnepiece(pieces: string[]): string[] {
  let best = -1;
  let bestWords = 0;
  pieces.forEach((piece, index) => {
    const words = piece.toLowerCase().split(/\s+/);
    if (!ONEPIECE_TAILS.has(words[words.length - 1])) return;
    if (words.length > bestWords) {
      bestWords = words.length;
      best = index;
    }
  });
  if (best < 0) return pieces;
  return pieces.filter((piece, index) => {
    if (index === best) return true;
    const words = piece.toLowerCase().split(/\s+/);
    return !ONEPIECE_TAILS.has(words[words.length - 1]);
  });
}

/**
 * 跨块回声清理：Base 里不该再写角色块已经写过的东西。
 *
 * 单人出图时 base_caption 与 char_caption 是两份独立权重，同一个姿势写两遍
 * 就被算两次——实测第 4 楼 Base 写 `arched back, legs apart, lying on back`，
 * 角色块又原样写一遍，画面被这个姿势锁死，换机位也甩不掉。
 *
 * 保留的是 Base 真正该独占的东西：人数词、场景、机位、光线。角色块里的
 * 姿势、身体、衣着、表情一律从 Base 剥掉——那些由 char_caption 负责。
 */
const BASE_KEEP: Set<string> = new Set([
  ...TAG_LEXICON.scene,
  ...TAG_LEXICON.camera,
  ...TAG_LEXICON.light,
  '1girl',
  '2girls',
  '3girls',
  'multiple girls',
  '1boy',
  '2boys',
  'multiple boys',
  '1other',
  'solo',
  'no humans',
]);

export function stripBaseEcho(base: string, characterTags: readonly string[]): string {
  if (!base || characterTags.length !== 1) return base;
  const owned = new Set(
    characterTags[0]
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!owned.size) return base;
  const kept = base
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag) return false;
      const low = tag.toLowerCase();
      return BASE_KEEP.has(low) || !owned.has(low);
    });
  return kept.join(', ');
}

/**
 * 世界类词（机位/光线/场景）只属于 Base。
 *
 * 实测第 5 节：Base 写 `upper body`，角色块又写 `full body, front view, soft lighting,
 * window light, house` —— 同一个景别在两个 caption 里各算一次权重，画面被两份互相
 * 矛盾的机位撕开（上半身特写里塞进全身构图）。场景与光线也一样：char_caption 里的
 * `house` 会把人物单独拽回一栋房子，而不跟她所在的那个房间。
 *
 * 所以角色块只留「这个人」：身份、外貌、衣着、表情、姿势、身体。世界类一律搬回 Base。
 */
const WORLD_HEADS: Set<string> = new Set([
  ...TAG_LEXICON.camera,
  ...TAG_LEXICON.light,
  ...TAG_LEXICON.scene,
]);

const SHOT_ORDER = ['wide shot', 'full body', 'cowboy shot', 'medium shot', 'upper body', 'portrait', 'close-up'];

function splitTags(tag: string): string[] {
  return tag
    .split(',')
    .map((piece) => piece.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/**
 * 把角色块里的世界类词搬到 Base：返回搬完的两块。
 *
 * 景别特殊处理——Base 已经有景别就以 Base 为准（模型先写的那句是它想要的镜头），
 * 角色块里冲突的景别直接丢；Base 没有景别时把角色块那个搬上去，保证画面有镜头。
 */
export function separateWorldTags(
  base: string,
  characterTags: readonly string[],
): { base: string; characters: string[] } {
  if (!characterTags.length) return { base, characters: [...characterTags] };
  const basePieces = splitTags(base);
  const baseLower = new Set(basePieces.map((piece) => piece.toLowerCase()));
  const baseHasShot = basePieces.some((piece) => SHOT_SCALES.includes(piece.toLowerCase()));
  const carried: string[] = [];
  const characters = characterTags.map((tag) => {
    const kept: string[] = [];
    for (const piece of splitTags(tag)) {
      const low = piece.toLowerCase();
      if (!WORLD_HEADS.has(low)) {
        kept.push(piece);
        continue;
      }
      if (SHOT_SCALES.includes(low)) {
        // 景别只在 Base 缺席时搬一个上去
        if (!baseHasShot && !carried.some((word) => SHOT_SCALES.includes(word))) carried.push(piece);
        continue;
      }
      if (!baseLower.has(low)) {
        baseLower.add(low);
        carried.push(piece);
      }
    }
    return kept.join(', ');
  });
  const merged = [...basePieces, ...carried].join(', ');
  return { base: merged, characters };
}

/** 判断一个 tag 是否在词表内（校验用；暂不阻断，只用于诊断日志）。 */
export function inLexicon(tag: string): boolean {
  const normalized = tag.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  return LABELS.some(([key]) =>
    TAG_LEXICON[key].some((word) => word.toLowerCase() === normalized),
  );
}
// nl 不该复述 tag 已经写过的衣服：两份 caption 各算各的权重，同一件衬衫写两遍
// 只会让画面被它拽住。这里按分句删——「She wears X」这类分句整句丢，
// 剩下的分句只有在「没动作、只是在念衣服」时才丢。
const DRESS_MODIFIER = new Set([
  '1girl', '1boy', '2girls', '2boys', 'girl', 'boy', 'solo', 'white', 'black', 'blue', 'pink', 'red',
  'green', 'yellow', 'grey', 'gray', 'brown', 'purple', 'orange', 'pale', 'fair', 'dark', 'light',
  'long', 'short', 'high', 'low', 'open', 'closed', 'wet', 'damp', 'sleeve', 'sleeves', 'hair',
  'eyes', 'eye', 'skin', 'tall', 'slender', 'thin', 'she', 'her', 'his', 'he', 'and', 'with',
]);

const RESTATEMENT_ACTION = /\b(holds?|holding|rests?|resting|turns?|turning|looks?|looking|leans?|leaning|steps?|stepping|walks?|walking|stands?|standing|sits?|sitting|reaches?|reaching|raises?|raising|pulls?|pulling|pushes?|pushing|covers?|covering|glances?|tilts?|shifts?|fingers?|palm|hand|hands|shoulder|back|chest|collar)\b/i;

/** 从 nl 里删掉「复述 tag 服装」的分句；删空就返回空串。 */
const CLOTHING_DUMP = /^(?:not\s+wearing|wearing|she\s+is\s+wearing|she\s+wears)\b[^.!?]*[,;][^.!?]*\b(?:wearing|is|are)\b/i;

/** 一整段都是 tag 串（1girl 开头、或逗号远多于动词），不是句子。 */
function looksLikeTagList(text: string): boolean {
  if (/^\s*\d+\s*(?:girl|boy|other)\b/i.test(text)) return true;
  const commas = (text.match(/,/g) || []).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const hasVerb = /\b(?:is|are|was|were|wears?|wearing|holds?|holding|stands?|sits?|lies|turns?|looks?|leans?|rests?|reaches|raises|pulls?|tucks|facing|glancing|smiles?)\b/i.test(text);
  return (commas >= 4 && commas * 3 > words) || (commas >= 2 && !hasVerb);
}

/**
 * 自然语言的唯一清洗入口（序列化前调一次）。
 *
 * 以前清洗分散在三处（解析、服装层、序列化），每一处都按自己的理由删句，
 * 到最后模型写的那句话只剩残句，还分不清是哪一层删的。现在只有这里一次：
 * 1) 整段是 tag 串 → 丢弃；2) 整段是账本口径的名词堆 → 丢弃；
 * 3) 只删「纯复述服装」的整句，带动作的句子原样保留。
 */
export function cleanNaturalLanguage(text: string, ...tagTexts: string[]): string {
  const value = text.trim();
  if (!value) return '';
  if (CLOTHING_DUMP.test(value) || looksLikeTagList(value)) {
    console.warn('[墨影] nl 不是句子（是 tag 串或服装清单），整段丢弃：' + value.slice(0, 60));
    return '';
  }
  const kept = stripGarmentRestatement(value, ...tagTexts);
  // 模型常在换行处断句，产出一句没有句号的半句（实机第 0 楼：「She steps out of the
  // softly lit bathroom」）。NAI 把整段当一句话读，缺句号会把下一段接上去；这里只补
  // 终止符，不改写内容。同时把「半句没有主谓」的情况留给模型（契约里已要求完整句）。
  if (!kept) return '';
  // 只有「看起来像句子」（≥3 词）才补终止符：`left`、`upper body` 这种是给序列化当字段值的
  // 短语，补句号会把既有标签写法（`nl":"left"`）改坏。
  if (/[.!?]$/.test(kept) || kept.split(/\s+/).length < 3) return kept;
  return `${kept}.`;
}

export function stripGarmentRestatement(nl: string, ...tagTexts: string[]): string {
  const text = (nl || '').trim();
  if (!text) return '';
  const garments = new Set(
    tagTexts
      .join(', ')
      .toLowerCase()
      .split(/[^a-z0-9 ]+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 2 && !DRESS_MODIFIER.has(word)),
  );
  const pieces: string[] = [];
  for (const piece of text.split(/(?<=[.!?])\s+|,\s+(?=and\s|her\s|his\s|she\s|he\s)/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    // 「She wears X, 动作」——把穿着前缀切掉，动作后半句留下
    const wearPrefix = trimmed.match(/^(?:she|he)?\s*(?:is\s+)?(?:wears?|wearing|dressed|clad)\b[^,]*,\s*(.+)$/i);
    if (wearPrefix) {
      pieces.push(wearPrefix[1]);
      continue;
    }
    pieces.push(trimmed);
  }
  const kept = pieces.filter((piece) => {
    const trimmed = piece.trim();
    if (!trimmed) return false;
    if (/^(?:she|he)?\s*(?:is\s+)?(?:wears?|wearing|dressed|clad)\b|^the\b[^.]{0,40}\bis\s+(?:on|around)\s+the\s+(?:floor|chair|bed)\b/i.test(trimmed)) return false;
    const words = trimmed.toLowerCase().split(/[^a-z0-9 ]+/).filter(Boolean);
    const hits = words.filter((word) => garments.has(word)).length;
    if (!hits) return true;
    return RESTATEMENT_ACTION.test(trimmed);
  });
  // 什么都没删就原样返回：不要因为重排把 `A girl.\\nSecond line.` 变成逗号串，
  // 那会让摘要行丢掉句子边界。
  if (kept.length === pieces.length) return text;
  // 整句都是服装复述时不要直接留空：把衣物名词摘掉，还有动作与主语就留成一句话。
  // 空串等于这一格放弃描述（实测第 1 楼因此丢了「靠在他肩上说话」这个动作）。
  // 整句都是服装复述时只判定「它是不是一句能站住的描述」：有主语有动词就整句留下，
  // 否则整句丢掉。绝不逐词摘衣物名词——`She pinches the hem of her shirt` 里 shirt 是
  // 动作的落点，摘掉它句子就不成话了（实测出过 `She pinches the hem of her.`）。
  if (!kept.length) {
    const words = text.split(/\s+/).filter(Boolean);
    return words.length >= 5 && /\b(?:she|he|her|his)\b/i.test(text) && /\b[a-z]+(?:s|ed|ing)\b/i.test(text)
      ? text
      : '';
  }
  // 用空格接回句子：逗号接法会把两句话粘成 tag 串，模型下一轮会学着写串。
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

const GENERIC_SCENES = new Set(['house', 'indoors', 'indoor', 'outdoors', 'outdoor', 'room', 'building']);

/** 已经有具体场所（stairs / bathroom / classroom…）时，house / indoors 只会稀释画面。 */
export function dropGenericScenes(base: string): string {
  const tokens = base.split(',').map((token) => token.trim()).filter(Boolean);
  const concrete = tokens.filter((token) => {
    const lower = token.toLowerCase();
    return TAG_LEXICON.scene.includes(lower) && !GENERIC_SCENES.has(lower);
  });
  if (concrete.length < 2) return base;
  return tokens.filter((token) => !GENERIC_SCENES.has(token.toLowerCase())).join(', ');
}
