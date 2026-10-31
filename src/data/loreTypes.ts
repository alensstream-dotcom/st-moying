/**
 * 素材库(lore)公共类型:服装库 / 面相身材库 / 亲密姿势库共用一套条目形状与匹配口径。
 *
 * 设计动机(用户痛点):
 * - NovelAI 对「黑丝」这类泛词只会吐出模型里最常见的那几种版型,剧情里的衣服永远画得差不多;
 *   解决办法是把「款式指纹」写死成具体 tag 串(版型+面料+留白剪裁+袜鞋配饰),由剧情关键词命中后
 *   直接扔给模型照抄,而不是让模型自由发挥。
 * - 亲密戏的姿势储备同理:泛词 `sex` 只会出最普通的传教士,必须给出具名姿势串与机位。
 *
 * 所以每个条目 = 一组英文 tag 指纹 + 一组中文/英文触发词 + 一个 NSFW 档位。
 * 触发词只用来「召回」,最终用哪条由模型在候选里挑;这样既不会漏,也不会把不相干的衣服硬塞进去。
 */

/** 0 = 日常安全;1 = 微诱惑(露肩/贴身/短裙);2 = 情趣内衣/性暗示;3 = 明确 NSFW(露点、性行为、BDSM)。 */
export type NsfwLevel = 0 | 1 | 2 | 3;

/** 服装覆盖部位:套到角色库时按部位决定是替换 outfit 还是拼在 extra。 */
export type WardrobeSlot =
  | 'full' // 连体/整套
  | 'top' // 上衣
  | 'bottom' // 下装
  | 'underwear' // 内衣内裤
  | 'hosiery' // 袜类(丝袜/吊带袜/过膝袜)
  | 'shoes' // 鞋
  | 'accessory' // 配饰
  | 'state'; // 半脱/湿身等「状态型」着装

export interface WardrobeCategory {
  id: string;
  label: string;
  /** 一句话说明这类的选型口径,UI 悬浮提示用。 */
  hint?: string;
  /** 分类默认 NSFW 档(条目可覆盖)。 */
  nsfw?: NsfwLevel;
}

export interface LoreItemBase {
  /** 稳定 id,小写 kebab;用于持久化收藏/自定义覆盖,不得随文案改动。 */
  id: string;
  /** 中文名,UI 展示与「套到角色」时写进备注。 */
  name: string;
  /** 英文 tag 串(danbooru 口径,逗号分隔);这是最终被照抄进提示词的核心指纹。 */
  tags: string;
  /** 触发词:正文里出现任一即视为该条目的候选。中英混排,越长越具体(匹配按长度加权)。 */
  aliases: string[];
  /** NSFW 档位。 */
  nsfw: NsfwLevel;
  /** 1–5,默认 3;同等命中时数大者优先,UI 也可按它排序。 */
  quality?: number;
  /** 中文备注:适配场景/禁忌,写给模型看的补充说明(可选)。 */
  note?: string;
}

export interface WardrobeItem extends LoreItemBase {
  /** WardrobeCategory.id */
  category: string;
  slot: WardrobeSlot;
  /** 与哪些「人设气质」最搭(如 御姐/校花/人妻),用于按角色气质加权。 */
  vibe?: string[];
}

export type FaceArchetypeId =
  | 'cold' // 清冷御姐/高岭之花/恶女
  | 'gentle' // 温婉人妻/治愈熟女/知性
  | 'youth' // 纯欲校花/初恋/辣妹
  | 'ethereal' // 空灵仙女/冷艳大小姐/小恶魔
  | 'queen' // 女王/上位压迫感
  | 'tomboy' // 飒爽/英气/战斗系
  | 'succubus' // 妖娆魅魔/妖姬
  | 'gyaru'; // 明艳辣妹/浓妆派

export interface FacePreset extends LoreItemBase {
  archetype: FaceArchetypeId;
  /** 适配气质关键词(与角色 desc/身份词比对)。 */
  vibe: string[];
  /** 该面相默认配的发型词;套到角色时若角色 hair 已填,可用它补齐。 */
  hairHint?: string;
  /** 该面相默认配的瞳色词。 */
  eyeHint?: string;
}

export interface BodyPreset extends LoreItemBase {
  archetype: string;
  vibe: string[];
}

/** 同人身份 tag(anime/游戏角色),供「人物 tag 库」把原创角色换骨相用。 */
export interface FandomPreset extends LoreItemBase {
  franchise: string;
  /** 该同人角色固有发色发型(冲突检测用):如 `blue hair, long hair`。 */
  hair?: string;
  /** 固有瞳色。 */
  eyes?: string;
  /** 必须一起写的伴随词(如 blue archive 的 halo 要弱化):写成完整负面语法的提示。 */
  companion?: string;
}

export type PoseCategoryId =
  | 'foreplay' // 前戏/爱抚
  | 'oral' // 口交/深喉
  | 'vaginal' // 正常位类
  | 'rear' // 后入类
  | 'ride' // 骑乘类
  | 'side' // 侧入/抬腿
  | 'standing' // 立位/抱起
  | 'hand' // 手交/指交
  | 'breast' // 乳交/胸推
  | 'solo' // 自慰/单人
  | 'restraint' // 束缚/BDSM
  | 'climax' // 高潮/射精瞬间
  | 'afterglow' // 事后余韵
  | 'tease' // 挑逗/走光/湿身
  | 'pov' // 第一视角窥视(偷看衣领/裙底/镜中/手机屏幕)

export interface PoseEntry extends LoreItemBase {
  category: PoseCategoryId;
  /** 推荐机位/景别(直接可用的 tag 串)。 */
  camera?: string;
  /** 施受方向:决定 Base 的 POV 写法。 */
  direction?: 'heroine-active' | 'male-active' | 'mutual' | 'solo';
  /** 适配的穿脱阶段(1–5),与思维链的五阶状态机对齐。 */
  stage?: 1 | 2 | 3 | 4 | 5;
}
