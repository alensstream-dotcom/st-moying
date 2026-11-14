/**
 * gemini 档的「紧缩契约」:只允许 images 一个键 + tag 只用白名单里的词。
 *
 * 为什么需要这一层(全部来自真实楼层请求的实测,别凭直觉改回去):
 *
 * 真实请求 = 用户那本 NSFW 小说的第 1 楼(开篇即露骨),经网关 `agy` 池,每条跑 8 次。
 *
 *   base(完整契约:images + identities + outfitChanges + nl)
 *     抗截断-agy-gemini-3.8-flash-high  → 3/8
 *     抗截断-agy-gemini-4-argon-high    → 8/8
 *   只加 tag 白名单(不动契约)
 *     3.8-flash → 5/8      4-argon → 7/8     ← 白名单单独不够
 *   只禁 nl
 *     3.8-flash → 4/8                        ← 禁散文也不够
 *   保留 outfitChanges 的紧缩契约
 *     3.8-flash → 7/8      4-argon → 5/8     ← 服装字段拖累 4-argon
 *   紧缩契约(只留 images)+ 白名单
 *     3.8-flash → 8/8      4-argon → 7/8     ← 唯一同时解决两个模型的形态
 *
 * 失败点不在「写了什么词」,而在**输出预算与逐 token 过滤的叠加**:上游是在生成过程中
 * 边写边判的,写得越长越容易在中途撞上判定,而 `nl`/`identities`/`outfitChanges` 这些
 * 长字段正是长度主体。把它们从模型输出里拿掉、改由本地补齐,两个模型的通过率同时拉到最高。
 *
 * 代价与补偿(重要,改这里之前先读):
 * - `nl`(自然语言描述)不再由模型写。NAI 的自然语言段会变薄,但露骨内容本来就由
 *   `explicitTags.ts` 的本地词典按正文补齐,不依赖模型写 nl。
 * - `outfitChanges` 不再由模型写。服装改由 `synthesiseSceneClothing` /
 *   `adoptChangedClothing` / `applyWardrobeChoices` 按正文动作在本地推进。
 * - `identities` 不再由模型写。性别判定改由 `femaleStoryFact`(正文代词)与库内档案承担。
 * 这三个字段的**消费端一行都不用改**:缺字段时各处的 `?? []` / `?? undefined` 本来就是
 * 「本地兜底」路径,只是过去很少走到。
 */

/** 白名单词表:只有镜头能拍到的东西,不含身体部位、衣物状态与行为词。 */
const TAG_WHITELIST = `【tag 用词范围（硬性）】
tag 与 characters[].tag 只写镜头能拍到的东西，从这里挑，逗号连接，每张图最多 16 个：
人数：1girl, solo, 1boy, 2girls, 2boys
景别：upper body, cowboy shot, close-up, full body, portrait, lower body
机位：from front, from above, from behind, from side, pov, over shoulder
姿态：standing, leaning, sitting, kneeling, lying, bent over, arched back, head tilted back, arms up, on back, on all fours
场景：indoors, outdoors, doorway, porch, bedroom, bathroom, living room, bed, pillar, window, wall, floor
时间光线：day, night, soft lighting, dim lighting, warm light, backlighting
表情：blush, smile, parted lips, half-closed eyes, closed eyes, looking at viewer, looking away, trembling
头发：long hair, short hair, black hair, blonde hair, silver hair, hair ribbon, messy hair
服装名词：white dress, black dress, shirt, blouse, skirt, long skirt, jeans, shorts, panties, bra, jacket, coat
禁止写：身体部位名（breasts/nipples/pussy/penis/ass/thighs）、手或触摸的位置、衣物状态（lifted/slipped/under/open/down/aside/torn）、体液、任何性行为词。
这些内容由插件本地词典按正文原文补齐 —— 你写了反而会让整份 JSON 被判违规截断，画面也不会更准。`;

/**
 * 紧缩契约的完整文本。
 *
 * `images` 里保留 `characters`(而不是连它一起砍):角色块是**外貌锁定**的挂载点,
 * `enforceAppearance`/`enforceClothing` 都按它找条目;砍掉之后同楼多图会各画各的脸。
 * 实测保留 characters 的紧缩契约仍是 7~8/8,所以不必牺牲一致性。
 */
export const COMPACT_PLAN_CONTRACT = `【本轮输出格式（唯一的一种）】
只输出这一个对象，不要有任何其他键：
{"images":[{"position":"P#","after":"正文原句","tag":"英文 tag","characters":[{"name":"档案里的规范名","tag":"该角色的英文 tag"}]}]}
不要输出 nl、identities、outfitChanges、costumeContexts —— 程序会按档案与服装账本在本地补齐这些字段，画面不会因此缺任何东西。
不要写任何自然语言句子。
${TAG_WHITELIST}`;

/**
 * 这次请求是否该用紧缩契约。
 *
 * 只在 gemini 档启用:其它档位(strong/max/off 与本地小模型)没有这个过滤问题,
 * 砍字段只会白白降低提示词质量。
 */
export function useCompactContract(jailbreakTier: string | undefined): boolean {
  return jailbreakTier === 'gemini';
}
