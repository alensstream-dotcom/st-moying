/**
 * 通用/匿名称呼过滤。
 *
 * 借鉴 LittleWhiteBox 的口径：路人、通用称呼（姐姐、老师、NPC、stranger…）
 * 不建档、不记锚点。这类名字一旦进了角色库或上镜锚点，之后每一张图都会照抄
 * 一套本来就没定过的外貌，反而成了噪声；同一位真角色还会被这些泛称抢走命中。
 *
 * 预编译成单一正则，建档与锚点共用同一套判定，保证两处口径一致。
 */
const GENERIC_NAME_REGEX = new RegExp(
  [
    // 中文通用/匿名
    '(?:^未知)',
    '(?:^路人)',
    '(?:^路边)',
    '(?:^陌生)',
    '(?:^无名)',
    '(?:^某[个位名女男人])',
    '(?:^女[人性孩][A-Za-z0-9]?$)',
    '(?:^男[人性孩][A-Za-z0-9]?$)',
    '(?:^少[女男年][A-Za-z0-9]?$)',
    '(?:^大[叔妈姐哥][A-Za-z0-9]?$)',
    '(?:^老[人头大妇][A-Za-z0-9]?$)',
    '(?:^[女男人]$)',
    '(?:^角色[0-9A-Za-z]*$)',
    '(?:^人物[0-9A-Za-z]*$)',
    '(?:^配角)',
    '(?:^(?:NPC|mob))',
    '(?:^[男女][0-9]+$)',
    // 中文关系/职业称呼
    '(?:^[哥姐弟妹]$)',
    '(?:^(?:哥哥|姐姐|弟弟|妹妹|老师|学长|学姐|前辈|老板|店员|医生|护士|主人|奴隶|仆人)$)',
    // 日语称呼
    '(?:^(?:お[兄姉]ちゃん|先輩|先生|マスター|お嬢様|ご主人様)$)',
    // 英文通用
    '(?:^(?:faceless|unnamed|unknown|random|stranger|passerby|bystander))',
    '(?:^(?:girl|boy|woman|man|person|male|female)\\s*[A-Za-z0-9]?$)',
    // 英文关系/职业称呼
    '(?:^(?:teacher|master|boss|doctor|nurse|brother|sister|senpai|sensei)$)',
  ].join('|'),
  'i',
);

/** 单字名字也算通用（「琳」「她」），不建档不记锚点。 */
export function isGenericCharacterName(name: string): boolean {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || trimmed.length <= 1) return true;
  return GENERIC_NAME_REGEX.test(trimmed);
}
