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
 * 紧缩契约的完整文本（3.x 系 Gemini 专用：连解剖词都不许写）。
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
 * 4 系 Gemini（4-argon / 4-hydrogen）用的宽松版。
 *
 * 与严格版只差一件事:**不禁止**身体部位与衣物状态词。
 * 理由是实测的:4-argon 对解剖词几乎不拦(带 `nude` / `breasts out` 仍是 80%),
 * 而把它按 3.8 那套「连器官名都不许写」去压,画面会变得明显更保守——
 * 用户抱怨的「NSFW 剧情出 SFW 图」有一半就是这条造成的。
 *
 * 仍然禁的:成段的自然语言描写(`nl`)、体液长句。那些才是真正被斩断的东西。
 */
export const COMPACT_PLAN_CONTRACT_LOOSE = `【本轮输出格式（唯一的一种）】
只输出这一个对象，不要有任何其他键：
{"images":[{"position":"P#","after":"正文原句","tag":"英文 tag","characters":[{"name":"档案里的规范名","tag":"该角色的英文 tag"}]}]}
不要输出 nl、identities、outfitChanges、costumeContexts —— 程序会按档案与服装账本在本地补齐这些字段。
不要写任何自然语言句子。

【tag 写法】
tag 与 characters[].tag 用英文短词、逗号连接，每张图 18~30 个。
按正文如实写：人数（1girl / 1boy / 2girls）、景别与机位、姿态、场景、光线、表情、
头发，以及正文里确实发生的身体状态与动作（nude / topless / breasts out / panties aside /
spread legs / sweat / cum 等）与衣物状态（open shirt / skirt lift / panties down）。
写成 danbooru 风格的短词，不要写成句子，不要写体液与器官的成段描写。`;

/**
 * 按模型挑契约文本。
 *
 * 3.x 系给严格版（它认字就斩），4 系给宽松版（它对解剖词宽容，压太狠只会更保守）。
 */
export function compactContractFor(model?: string): string {
  return bansExplicitWords('gemini', model) ? COMPACT_PLAN_CONTRACT : COMPACT_PLAN_CONTRACT_LOOSE;
}

/**
 * 这次请求是否该用紧缩契约。
 *
 * 只在 gemini 档启用:其它档位(strong/max/off 与本地小模型)没有这个过滤问题,
 * 砍字段只会白白降低提示词质量。
 */
export function useCompactContract(jailbreakTier: string | undefined): boolean {
  return jailbreakTier === 'gemini';
}

/**
 * 这一档是否**完全不许写裸露/性行为词**。
 *
 * 拆成两档是因为两个 Gemini 代际的过滤口径差得很远(实测,同一份请求各 8 次):
 * - gemini-3.8-flash:裸模型 80% 通过;带上露骨词就掉到 33%。压缩字段后回到 80%。
 *   它认得出「胸」「私处」这类词就直接斩断,所以这一档连器官名都不能写。
 * - gemini-4-argon:裸模型只有 40%,但对**构图白名单**几乎不拦(80%)。
 *   它对解剖词宽容得多——把 `nude` / `breasts out` 一起禁掉反而画出更保守的图。
 *
 * 换句话说:3.8 要「少写字」,4-argon 要「只写该写的」。
 * 一刀切成同一档,3.8 会漏拦、4-argon 会被过度阉割——用户看到的「NSFW 剧情出 SFW 图」
 * 有一半是后者造成的。
 */
export function bansExplicitWords(jailbreakTier: string | undefined, model?: string): boolean {
  if (jailbreakTier !== 'gemini') return false;
  // 模型名缺失时按严的一档走(宁保守不砍图)。
  if (!model) return true;
  const bare = model.replace(/^(?:假流式-|抗截断-)+/, '').toLowerCase();
  // 4 系(4-argon / 4-hydrogen / 4-carbon)不锁解剖词;只有 3.x 系锁。
  return !/gemini-4[-.]/.test(bare);
}
