import { IDENTITY_PROTOCOL, IDENTITY_EXTRA_KEY, assessIdentityClaims, currentIdentityFacts, eligibleIdentityEntries, enforceKnownMaleIdentity, identityContextHash, identityFactFor, isMaleIdentity, identityManualRevision, identityStoryHash, mayCreateHeroine, mergeIdentityFacts, type IdentitySources } from '@/state/characterIdentity';
import { requestCompletion, requestViaMainApi, type ChatMsg } from '@/api/client';
import { BLOCK_RETRY_NOTE, diagnoseBlock, neutralizeMessages } from '@/autoTag/blockGuard';
import { readBookMemory } from '@/autoTag/bookMemory';
import {
  applyPositionedCharRefs,
  resolveCharAnchors,
  type PositionedCharOp,
} from '@/autoTag/charAnchors';
import {
  diagnoseCast,
  diagnoseContact,
  diagnosePropTarget,
  castRetryNote,
  type CastGap,
} from '@/autoTag/castCheck';
import { prepareTargetText } from '@/autoTag/clean';
import {
  buildCharReuseBlock,
  findCharAliases,
  findCharReuse,
  normalizePlanCharacters,
  resolveCanonicalCharName,
} from '@/autoTag/charReuse';
import { BBI_OUTFIT_EXTRA_KEY } from '@/autoTag/outfitState';
import { CLOTHING_PROTOCOL, acceptClothingChanges, clothingAt, clothingBefore, clothingBlock, clothingRevision, enforceClothing, initialiseClothingFromImage,
  narrativeHash, readClothingFloor, savedImageClothing, type ClothingFloor, type ClothingState } from '@/autoTag/outfitTimeline';
import { enforceAppearance } from '@/autoTag/appearanceLock';
import { beginGeneration, clearGeneration, consumeGeneration } from '@/autoTag/generationGate';
import { autoTagProfile, buildAutoTagMessages } from '@/autoTag/prompt';
import { rebaseImagePositions, type RebaseReport } from '@/autoTag/rebase';
import { buildSlotTaskNote } from '@/autoTag/slotPlan';
import {
  diagnoseMonotonousShots,
  diagnoseShot,
  monotonousShotRetryNote,
  shotRetryNote,
} from '@/autoTag/shotCheck';
import { salvageJsonObject } from '@/autoTag/salvage';
import { diagnoseDistance, distanceRetryNote } from '@/autoTag/shotGuide';
import {
  adjacentPositionNote,
  adjacentPositions,
  duplicatePositionNote,
  duplicatePositions,
} from '@/autoTag/positionCheck';
import {
  diagnoseTruncation,
  EMPTY_PLAN_RETRY_NOTE,
  truncationRetryNote,
} from '@/autoTag/truncation';
import {
  BBI_CHAR_EXTRA_KEY,
  CHAR_TAG_FIELDS,
  charTagsBeforeFloor,
  applyCharTagOps,
  createCharTagNewOp,
  createCharTagSetOp,
  emptyCharFields,
  lockedCharTagNames,
  makeCharTagFloorDelta,
  normalizeCharAge,
  readCharTagFloorDelta,
  recomputeCharTags,
  type CharTagAutoOp,
  type CharTagField,
} from '@/state/charTags';
import { injectImageTags, parseImagePlan, type ImageInsertion, type ImagePlan } from '@/autoTag/protocol';
import {
  clearAutoGenerateForFloor,
  consumeAutoGenerate,
  markForAutoGenerate,
} from '@/floor/autoGenerate';
import {
  cancelBackgroundFloorJobs,
  clearPreclaimedBackgroundSlots,
  preclaimBackgroundSlots,
  runBackgroundGenerations,
} from '@/floor/backgroundGen';
import { applyMessageText, type ApplyMessageResult } from '@/st/messageEdit';
import { getContext, isAiStoryMessage, type STMessage } from '@/st/context';
import {
  hasImageTagTrace,
  parseImageTagContent,
  parseImageTags,
  replaceImageTagAt,
  serializeImageTag,
  stripImageTags,
} from '@/st/imageTagRegex';
import { getTagGenChannel, isCurrentChatExcluded, settings } from '@/state/settings';

const processed = new Set<string>();
const running = new Map<string, AbortController>();
let bound = false;
const scheduled = new Set<ReturnType<typeof setTimeout>>();
const DIAGNOSTIC_PREFIX = '[BBI][AutoTagDebug]';

function diagnostic(event: string, payload: unknown = null): void {
  const seen = new WeakSet<object>();
  let detail: string;
  try {
    const json = JSON.stringify(payload, (_key, value: unknown) => {
      if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
      if (typeof value === 'bigint') return String(value);
      if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
    detail = json ?? String(payload);
  } catch (error) {
    detail = JSON.stringify({ stringifyError: error instanceof Error ? error.message : String(error) });
  }
  console.info(`${DIAGNOSTIC_PREFIX} ${event} ${detail}`);
}

/**
 * 放弃本次运行并交代原因:诊断日志照旧记全量,**手动路径必须同时给 toast**。
 *
 * 手动点击是显式意图,静默 return 在用户那里就等于「按钮点了没反应」——查不出、
 * 也没法反馈。自动路径保持安静(每层楼都弹一次没人受得了),它的去向看诊断日志。
 */
function reportAbort(
  floor: number,
  reason: string,
  manual: boolean | undefined,
  hint: string,
  payload: Record<string, unknown> = {},
): void {
  diagnostic('runForFloor:skip', { floor, reason, ...payload });
  if (manual) toastr.warning(hint, '墨影');
}

function activeSwipeId(message: STMessage): number | null {
  if (!Array.isArray(message.swipes)) return null;
  return typeof message.swipe_id === 'number' ? message.swipe_id : 0;
}

function textHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

interface RunOptions {
  headless?: boolean;
  onNoImages?: () => void;
  /** 手动触发(楼层按钮):绕过 autoTag.enabled 与 processed 去重;空结果也给出反馈。 */
  manual?: boolean;
  /** 重新生成:先把已有 tag 从正文剔除再分析/注入;旧图片保留在卡片历史里。 */
  replace?: boolean;
  /**
   * 单槽位提示词重写(卡片「AI 重写提示词」):只替换该 seq 的 tag,其余 tag 与图片一字不动。
   * **画面不变**——写回按 seq 原位替换,模型返回的 position 压根不参与写回,措辞口径见
   * slotPlan.buildSlotTaskNote。分析基底同样剔除全部旧 tag,但强制输出恰好 1 张,
   * 且忽略本次 AI 的 changes(首次全量分析已为整楼建过档)。
   */
  slot?: { seq: number };
}

/** 放弃写入的用户可读原因。文本变化已不在其中——那是正常情况,会 rebase 后照常写入。 */
const ABANDON_REASON: Partial<Record<ApplyMessageResult, string>> = {
  'chat-changed': '已切换聊天，本次没有写入生图 tag',
  'floor-changed': '该楼层已被删除或替换，本次没有写入生图 tag',
  'swipe-changed': '已切换 swipe，本次没有写入生图 tag',
  'build-failed': '楼层正文已被大幅改写或已存在生图 tag，本次没有写入',
  unavailable: '当前聊天不可写入，本次没有写入生图 tag',
};

/** 重定位结果的一行摘要;全部原位命中时返回空串(无需记日志)。 */
function describeRebase(report: RebaseReport): string {
  if (!report.remapped && !report.drifted) return '';
  const parts = [`原位 ${report.anchored}`];
  if (report.remapped) parts.push(`跟随改写句 ${report.remapped}`);
  if (report.drifted) parts.push(`顺延到上一段 ${report.drifted}`);
  return parts.join(' · ');
}

/** 把 AI 报告的 changes 转成当前楼层操作;真正写回在正文 CAS 成功时一次完成。 */
/**
 * fandom 角色不接受 AI changes 回填的字段:长相只由同人 tag 决定。
 *
 * age 刻意不在这里:年龄档不是同人 tag 的一部分(同人 tag 只给骨相和身份),
 * 剧情里「过了几年」「长大了」时它该跟着变;hair/eyes 则相反,变了就等于换人,
 * 宁可让模型照抄同人 tag,也不让它按自己记忆改。
 */
const FANDOM_GUARD_FIELDS: ReadonlySet<string> = new Set(['hair', 'eyes', 'skin', 'body', 'raw']);
/**
 * sex 字段里的男性标记。
 *
 * 建档是永久副作用:一旦入库,之后每一张图都会照抄他的长相,于是「出现过的男的」
 * 全都留在角色库里。规则已经写明男性不建档,模型仍会顺手建一条,所以在落盘前按
 * sex 再拦一次 —— 宁可丢掉一条建不准的档,也不要让库越用越脏。
 */
const MALE_SEX_RE = /^(?:1boy|boy|male|man|men|masculine|♂)/i;

function planChangeOps(plan: ImagePlan, source: string, notes: string[]): PositionedCharOp[] {
  const ops: PositionedCharOp[] = [];
  for (const change of plan.changes) {
    if (change.field !== 'new') {
      const lines = source.replace(/\r\n?/g, '\n').split('\n');
      const preceding = [...lines.slice(0, change.sourceLine), (lines[change.sourceLine] ?? '').slice(0, change.charOffset || undefined)].join('\n');
      if (!change.evidence || !preceding.includes(change.evidence) || !change.evidence.includes(change.name)) { notes.push(`${change.name}: 未采纳 ${change.field} 变更，缺少有效原文证据`); continue; }
      const action = /染|剪|剃|长大|长高|成长|变身|变成|变为|留下.{0,6}疤|受伤|恢复|治愈|永久|dye|cut|shav|grow|transform|scar|heal|permanent/i;
      if (!action.test(change.evidence) || change.field === 'fandom' || change.field === 'sex' || change.field === 'outfit') { notes.push(`${change.name}: 未采纳 ${change.field} 变更，不能自动重写身份或把当前穿搭写进外貌库`); continue; }
    }
    let op: CharTagAutoOp | null = null;
    if (change.field === 'new') {
      // value 可能是结构化字段的 JSON 串(protocol.ts 拼),也可能是整串 tag 文本
      let fields: Partial<Record<CharTagField, string>> | null = null;
      let value = '';
      if (change.value.startsWith('{')) {
        try {
          const parsed = JSON.parse(change.value) as Record<string, unknown>;
          const picked: Partial<Record<CharTagField, string>> = {};
          for (const field of CHAR_TAG_FIELDS) {
            const value = parsed[field];
            if (typeof value === 'string' && value.trim()) picked[field] = value.trim();
          }
          if (Object.keys(picked).length) fields = picked;
        } catch {
          /* 非 JSON → 当整串处理 */
        }
      }
      if (!fields && change.value) value = change.value;
      // age 一律归一到规范词:模型会把正文的「刚毕业的大学生」原样抄进来,
      // 不归一的后果是这个角色每张图年龄都不一样。
      if (fields?.age) fields.age = normalizeCharAge(fields.age);
      if (fields) fields.outfit = ''; // AI current outfits belong only to the clothing timeline.
      op = createCharTagNewOp(
        {
          name: change.name,
          fields: { ...emptyCharFields(), ...(fields ?? {}) },
          raw: value,
          nl: change.nl ?? '',
          source: 'ai',
          desc: '',
        },
        change.reason,
      );
    } else if (change.field === 'nl') {
      op = createCharTagSetOp(change.name, 'nl', change.value || change.nl || '', change.reason);
    } else {
      const next = change.field === 'age' ? normalizeCharAge(change.value) : change.value;
      op = createCharTagSetOp(change.name, change.field, next, change.reason);
    }
    if (op) ops.push({ op, sourceLine: change.sourceLine, charOffset: change.charOffset });
  }
  return ops.sort((left, right) => left.sourceLine - right.sourceLine || (left.charOffset ?? 0) - (right.charOffset ?? 0));
}

async function runForFloor(floor: number, opts: RunOptions = {}): Promise<void> {
  const abort = (...args: Parameters<typeof reportAbort>): void => {
    reportAbort(...args);
    if (opts.headless) throw new Error(args[3]);
  };
  const context = getContext();
  diagnostic('runForFloor:enter', {
    floor,
    manual: Boolean(opts.manual),
    replace: Boolean(opts.replace),
    slotSeq: opts.slot?.seq ?? null,
    chatId: context?.getCurrentChatId?.() ?? '',
    extensionEnabled: settings.enabled,
    autoTagEnabled: settings.autoTag.enabled,
  });
  if (!context) {
    abort(floor, 'missing-context', opts.manual, 'SillyTavern 还没就绪，请稍后重试');
    return;
  }
  if (!settings.enabled) {
    abort(floor, 'extension-disabled', opts.manual, '墨影已停用，请先在插件设置里开启');
    return;
  }
  if (!opts.manual && !settings.autoTag.enabled) {
    diagnostic('runForFloor:skip', { floor, reason: 'auto-tag-disabled' });
    return;
  }
  // 排除角色闸门(与柏宝书同名单):该角色名所在聊天的自动 tag 全流程停用,
  // 手动按钮也在 actionButton 层撤掉,这里做兜底(手动触发时给反馈)。
  if (isCurrentChatExcluded()) {
    abort(floor, 'chat-excluded', opts.manual, '该角色已被排除，不生成生图 tag');
    return;
  }
  const message = context.chat[floor];
  const messageDiagnostic = message
    ? {
        isUser: message.is_user,
        isSystem: message.is_system,
        textLength: typeof message.mes === 'string' ? message.mes.length : -1,
        extraType: message.extra?.type ?? null,
      }
    : null;
  // 与楼层按钮同一个谓词(st/context.ts):被 /hide 隐藏的普通楼算剧情楼,照样能跑
  if (!isAiStoryMessage(message)) {
    abort(floor, 'not-ai-story-message', opts.manual, '这一楼不是可插图的剧情楼层（用户楼 / ST 系统楼）', {
      message: messageDiagnostic,
    });
    return;
  }
  const rawSource = message.mes;
  const slot = opts.slot;
  // 单槽重写的目标:开跑时快照第 seq 条 tag 的原文,写回前用它确认 seq 指的还是同一条
  // (同提示词编辑弹窗的纪律)。正文这会儿已经没这条 tag = 期间被删/换 swipe,直接放弃。
  const slotRawTag = slot ? parseImageTags(rawSource)[slot.seq] : undefined;
  if (slot && slotRawTag === undefined) {
    abort(
      floor,
      'slot-missing',
      true,
      `第 ${slot.seq + 1} 张图片的提示词已不存在（可能已换 swipe 或被编辑），本次没有重写`,
    );
    return;
  }
  // 探测口径与按钮层同源(imageTagRegex.hasImageTagTrace):两侧漂移过一次——
  // 按钮只认开标签、这里认开也认闭,只剩 `</bbi_image>` 的楼就卡成「点了没反应」。
  // 单槽重写以「本楼已有 tag」为前提,不受此闸门拦截。
  if (hasImageTagTrace(rawSource) && !opts.replace && !slot) {
    abort(
      floor,
      'already-has-image-tag',
      opts.manual,
      '本楼已有生图 tag，没有确认重新生成，本次未改动',
    );
    if (!opts.manual) console.debug(`[墨影] 第 ${floor} 楼已经含有 bbi_image tag，跳过自动分析`);
    return;
  }
  // replace / slot:分析都基于剔除旧 tag 后的正文。写回时 replace 让旧 tag 随之消失,
  // slot 按 seq 原位替换——别的 tag 在写回基底里原样保留。
  const source = opts.replace || slot ? stripImageTags(rawSource) : rawSource;
  if (!source.trim()) {
    abort(floor, 'empty-source', opts.manual, '本楼正文是空的（或只剩生图 tag），没有可分析的内容');
    return;
  }
  const preparedTarget = prepareTargetText(source, settings.excludes.customStripTags);
  if (!preparedTarget.segments.length) {
    abort(
      floor,
      'no-target-segments',
      opts.manual,
      '本楼正文清洗后没剩下叙事内容（可能被「剔除标签」名单或思维链/注释规则全删了），没有可分析的段落',
      { sourceLength: source.length },
    );
    return;
  }

  const chatId = context.getCurrentChatId?.() ?? '';
  if (!chatId) {
    abort(floor, 'missing-chat-id', opts.manual, '当前没有打开的聊天，本次没有生成生图 tag');
    return;
  }
  const swipeId = activeSwipeId(message);
  const identity = `${chatId}\u0000${floor}\u0000${swipeId ?? 'none'}\u0000${textHash(source)}`;
  // 手动是显式意图:即使同一正文自动流程已处理过(比如结论是无需插图)也照跑,
  // 但仍写入 processed,防止自动流程随后对同一正文重复请求。
  if (!opts.manual && processed.has(identity)) {
    diagnostic('runForFloor:skip', { floor, reason: 'already-processed', chatId, swipeId, identity });
    return;
  }
  processed.add(identity);
  diagnostic('runForFloor:start', {
    floor,
    chatId,
    swipeId,
    identity,
    sourceLength: source.length,
    segmentCount: preparedTarget.segments.length,
  });

  const runKey = `${chatId}\u0000${floor}`;
  running.get(runKey)?.abort();
  const controller = new AbortController();
  running.set(runKey, controller);

  try {
    const memory = readBookMemory(floor, context.chat[floor]?.mes ?? '', context.name1);
    // 单槽重写:库文本要包含本楼已落档的增量(首次全量分析建的档),否则 AI 会把
    // 已建档角色当新人重写。charTagsBeforeFloor(floor + 1) 正好含本楼(swipe 匹配时生效)。
    const libraryAtStart = slot ? charTagsBeforeFloor(floor + 1) : charTagsBeforeFloor(floor);
    const expectedLibrary = JSON.stringify(libraryAtStart);
    const identityRevision = identityManualRevision();
    const structuredFacts = assessIdentityClaims([], { story: '', card: '', worldbook: '', book: memory?.roles ?? [] });
    const knownIdentities = mergeIdentityFacts([...currentIdentityFacts(), ...structuredFacts]);
    const entriesBefore = eligibleIdentityEntries(libraryAtStart, knownIdentities);
    // 锁定名(全局库 ⊖ 本聊天基线):AI 的 changes 对这些名字一律无效,库文本里带 [locked] 标记
    const lockedNames = lockedCharTagNames();
    // 纯本地渲染:建档由主请求在同一次输出里完成(changes 的 field="new")
    const anchors = resolveCharAnchors(entriesBefore, lockedNames);
    // 单槽重写:协议强制「恰好 1 张」,并把该槽位当前提示词与其余槽位摘要带给模型
    // (锚住同一个画面、别抢别人的画面)。min/max 要同时覆盖 build 的规则文案与下面的
    // parse 校验,只改一处会自相矛盾。
    const promptOptions = slot
      ? { ...settings.autoTag, minImages: 1, maxImages: 1 }
      : settings.autoTag;
    // 协议形态开跑时快照一次:写协议、验收与收尾同一份,用户中途拨开关也不会前后不一
    const profile = autoTagProfile();
    // 素材候选的同分摇号种子:取自 identity(聊天+楼层+swipe+正文哈希)。
    // 同一楼重试/重跑结果一致,换楼或换 swipe 就换一批同分服装/姿势候选——
    // 否则同一句「她穿着职业装」每楼都召回同一批,模型当然每楼都挑第一件,看着就是永远一套衣服。
    const loreSeed = Math.max(1, Number.parseInt(textHash(identity), 36) || 1);
    // 正文外形与库中已建档角色逐项对上的,或正文中用尊称/简称(如「风阿姨」「千华」)指代已建档角色(「风千华」)的:
    // 直接点名「这段就是她」,别让模型再编一张脸或用别称另写角色块。
    // 只在上送给主请求前的快照上判,单槽重写同样适用(它也要照抄档案)。
    const charReuse = buildCharReuseBlock(
      [], // Resemblance is a material hint, never proof of the person’s identity.
      findCharAliases(entriesBefore, preparedTarget.promptText),
    );
    // 服装现状:从前面楼层把每个人身上的衣服与穿脱程度读回来。
    // 当前楼常常一句衣着都没写,模型每层都在从零决定穿什么,衣服自然乱飘;
    // 有了这份账本它才有一个「已经发生的事实」可以继承。单槽重写也要用同一份。
    // 账本只记变化,所以还要拿档案里的固定着装垫底——角色第一次出图时账本是空的,
    // 那正是衣服最容易开始乱飘的时候。
    const wardrobe = clothingBefore(context.chat, floor, entriesBefore);
    const wardrobeRevision = clothingRevision(context.chat, floor);
    const expectedStory = narrativeHash(rawSource);
    const savedWardrobe = readClothingFloor(message, wardrobeRevision);
    const slotWardrobe = slot && savedWardrobe && savedWardrobe.frames[slot.seq]?.tag === slotRawTag
      ? new Map(savedWardrobe.frames[slot.seq].entries.map(e => [e.name, e]))
      : slot && slotRawTag ? savedImageClothing({ ...parseImageTagContent(slotRawTag), position: '', sourceLine: 0, charOffset: 0 }, wardrobe) : null;
    const outfitBlock = clothingBlock(slotWardrobe ?? wardrobe);
    const messages = await buildAutoTagMessages(
      context,
      floor,
      promptOptions,
      memory,
      preparedTarget,
      anchors.text,
      slot ? buildSlotTaskNote(rawSource, slot.seq) : '',
      profile,
      loreSeed,
      charReuse,
      outfitBlock,
    );
    const channel = getTagGenChannel();
    messages.push({ role: 'system', content: CLOTHING_PROTOCOL });
    messages.push({ role: 'system', content: IDENTITY_PROTOCOL + '\n已核实身份（旧绘图档案不是性别证据）：' + JSON.stringify(knownIdentities) });
    const identitySources: IdentitySources = { story: source,
      card: messages.filter(m => m.role === 'system' && /^【(?:角色设定|主角设定)/.test(m.content)).map(m => m.content).join('\n'),
      worldbook: messages.filter(m => m.role === 'system' && m.content.startsWith('【世界设定')).map(m => m.content).join('\n'),
      book: memory?.roles ?? [] };
    // 失败重试:请求异常与「返回无法解析/校验不通过」都视为可重试的异常(后者常见于模型没遵守协议);
    // 中止信号立即收手,不消耗重试。parseImagePlan 对坏输出抛错,「无画面」则是正常返回空数组。
    // 解析/校验放进 validate 回调:不过则请求历史如实记为失败(而非「HTTP 拿到文本」的绿色成功),
    // 错误原样抛回这里走重试——显示与行为同口径。
    const retries = Math.max(0, Math.floor(Number(settings.autoTag.retryCount) || 0));
    let plan: ImagePlan | null = null;
    let lastError = '';
    // 上一次 attempt 是否被判为「被截断」:是则下一次重发时追加降载指令。
    // 不增加重试次数(那是用户的成本上限),只让重试打在正确的点上。
    let retryNote = '';
    // 上一次是否被渠道侧拦过:是则后续重试改发「兼容版」提示词(露骨示例词换成中性占位),
    // 并只保留最小结构要求。过滤发生在模型看到请求之前,加授权话术没用,只能把请求改淡。
    let blockedOnce = false;
    for (let attempt = 0; attempt <= retries && !plan; attempt++) {
      if (controller.signal.aborted) {
        processed.delete(identity);
        return;
      }
      const baseMessages = blockedOnce ? neutralizeMessages(messages) : messages;
      const attemptMessages: ChatMsg[] = retryNote
        ? [...baseMessages, { role: 'system', content: retryNote }]
        : baseMessages;
      try {
        // parsed 用对象壳装着:validate 闭包写入,await 之后读取——请求成功 + 验收通过才非空。
        // (直接 let 会被 TS 收窄成 null:闭包内的赋值控制流分析看不见。)
        const parsed: { plan: ImagePlan | null } = { plan: null };
        const validate = (raw: string, meta?: { finishReason?: string | null }) => {
          // 渠道拦截先判:它和「截断」的表现很像(空、半截、一段客气话),但修法相反——
          // 截断要压输出,拦截要把请求本身改淡。判错方向会让重试打在错的地方。
          const block = diagnoseBlock(raw, meta?.finishReason);
          if (block.blocked) {
            blockedOnce = true;
            retryNote = BLOCK_RETRY_NOTE;
            throw new Error(`被渠道内容过滤拦下(${block.reason})`);
          }
          const verdict = diagnoseTruncation(raw);
          // 截断先尝试抢救:写完了几张图却断在下一张上,那几张是好的,补上收尾括号就能用。
          // 救得回来就少发一次请求、少丢一张图;救不动再走重试。
          let text = raw;
          let salvaged = 0;
          if (verdict.truncated) {
            const repaired = salvageJsonObject(raw);
            if (repaired) {
              try {
                // 抢救出来的图必然少于原计划(尾巴被截掉了),这里不卡下限:
                // 「给 2 张」也比「整楼没有图」好。
                parseImagePlan(repaired, preparedTarget.segments, 0, promptOptions.maxImages);
                text = repaired;
                salvaged = 1;
              } catch {
                salvaged = 0;
              }
            }
            if (!salvaged) {
              // 形态上就是被掐断的:重试要降载,而不是原样再发一遍同样长度的请求。
              // 降的是图数(输出成本的主体),单独把字写短没用——图数不减照样在同一处断。
              retryNote = truncationRetryNote(Math.max(1, promptOptions.minImages));
              throw new Error(`输出被截断(${verdict.reason})`);
            }
            console.warn(
              `[墨影] 第 ${floor} 楼输出被截断(${verdict.reason}),已救回可闭合的部分继续`,
            );
          }
          const candidate = parseImagePlan(
            text,
            preparedTarget.segments,
            salvaged ? 0 : promptOptions.minImages,
            promptOptions.maxImages,
          );
          // 称呼归并与外貌兜底:模型若在 characters[].name 或 changes[].name 里写了已建档角色的
          // 别称/尊称/简称(如把「风千华」写成「风阿姨」「千华」),先唯一归并回档案主名,
          // 并在因换称呼漏抄固定外貌时把档案核心外貌字段补进 character.tag。
          const candidateFacts = mergeIdentityFacts([...knownIdentities, ...assessIdentityClaims(candidate.identities ?? [], identitySources)]);
          for (const change of candidate.changes) if (change.field === 'new' && !candidate.identities?.some(c => c.name === change.name)) {
            (candidate.identities ??= []).push({ name: change.name, gender: 'unknown', heroine: false, source: 'story', evidence: '', reason: '未提供新角色身份审核依据' });
          }
          candidate.changes = candidate.changes.filter(c => c.field !== 'new' || mayCreateHeroine(c.name, candidateFacts));
          const candidateEntries = eligibleIdentityEntries(entriesBefore, candidateFacts);
          for (const image of candidate.images) for (const character of image.characters) {
            const fact = identityFactFor(character.name, candidateFacts);
            if (fact && fact.gender !== 'male' && candidateEntries.some(e => e.name === fact.name)) character.name = fact.name;
          }
          normalizePlanCharacters(candidate.images, candidateEntries, new Set(candidateFacts.filter(f => f.gender === 'male').flatMap(f => [f.name, ...(f.aliases ?? [])])));
          if (entriesBefore.length) {
            const existingNames = new Set(entriesBefore.map(e => e.name.trim()));
            candidate.changes = candidate.changes.filter(change => {
              const canonical = isMaleIdentity(change.name, candidateFacts) ? change.name : resolveCanonicalCharName(change.name, candidateEntries);
              if (canonical !== change.name) {
                if (change.field === 'new' && existingNames.has(canonical)) return false;
                change.name = canonical;
              }
              return true;
            });
          }
          // 单槽重写忽略本次 changes,不校验建档 nl —— 校验它会为一份会被丢弃的
          // changes 白白消耗重试次数。NAI 关了自然语言时协议不要 nl,也就不验。
          if (
            !slot &&
            profile.naiCharPrompts &&
            profile.nl &&
            candidate.changes.some(change => change.field === 'new' && !change.nl?.trim())
          ) {
            throw new Error('NAI 4.5/V5 建档必须附带 nl 外貌描述');
          }
          // 空 images:协议上算正常返回,旧版直接放行,于是模型一句「没有值得插图的画面」
          // 就能让整楼不生、阅读器干等超时。这里在还有重试次数时把它当可纠错误,
          // 换一套口径逼它落到具体画面上;changes 非空(有建档要落)时不算空。
          if (!slot && attempt < retries && !candidate.images.length && !candidate.changes.length && !candidate.identities?.length) {
            retryNote = EMPTY_PLAN_RETRY_NOTE;
            throw new Error('返回了空 images');
          }
          // 落位重复:两张图挤在同一段,画出来是同一瞬间拍两遍。仅当可选位置
          // 够分时才纠(席位数少于图数时重叠是必然的)。同样只在还有重试次数时纠。
          if (attempt < retries) {
            const dups = duplicatePositions(candidate.images, preparedTarget.segments.length);
            if (dups.length) {
              retryNote = duplicatePositionNote(dups);
              throw new Error(`落位重复(${dups.join('、')})`);
            }
          }
          // 落位紧邻:当正文句子充裕时,两张图落在紧挨着的前后两句话(如 P5 与 P6),
          // 属于同一自然段的同一瞬间,会导致插图紧贴且画面雷同。
          if (!slot && attempt < retries) {
            const adj = adjacentPositions(candidate.images, preparedTarget.segments.length);
            if (adj.length) {
              retryNote = adjacentPositionNote(adj);
              throw new Error(`落位紧邻(${adj.map(([a, b]) => `${a}-${b}`).join('、')})`);
            }
          }
          // 景别过远:正文点名了具体部位,画面却拍成远景。这条排在缺项检查之前——
          // 缺景别词只是「画面会平」,景别过远是「这张图白拍」,前者由后者一并带上。
          // 同样只在还有重试次数时纠,没次数就放行。
          if (attempt < retries) {
            const segmentText = new Map(preparedTarget.segments.map(item => [item.id, item.text]));
            const prevSegText = (pos: string): string => {
              const m = /^P(\d+)$/i.exec(pos.trim());
              if (!m) return '';
              const n = Number.parseInt(m[1], 10);
              return n > 1 ? (segmentText.get(`P${n - 1}`) ?? '') : '';
            };
            const seenGap = new Set<string>();
            const farGaps = candidate.images
              .map(image => {
                const gap = diagnoseDistance(
                  segmentText.get(image.position) ?? '',
                  image.tag,
                  (image.characters ?? []).map(character => character.tag),
                  prevSegText(image.position),
                );
                if (!gap) return null;
                const key = `${image.position}\u0000${gap.suggest}`;
                if (seenGap.has(key)) return null;
                seenGap.add(key);
                return { position: image.position, ...gap };
              })
              .filter((gap): gap is NonNullable<typeof gap> => !!gap);
            if (farGaps.length) {
              retryNote = distanceRetryNote(farGaps);
              throw new Error(
                `景别过远(${farGaps.map(gap => `${gap.position} 应 ${gap.suggest}`).join('、')})`,
              );
            }
          }
          // 画面事实闭环:人数与道具落点。
          // 「两个男的一个女的」画成一个人长双头肉棒、「毛笔在阴部写字」只画毛笔不画落点,
          // 都是可判定的确定错,而且这类错图一眼废。排在构图缺项之前(缺项只是画面平)。
          // 单槽重写不改画面事实,跳过。
          if (!slot && attempt < retries) {
            const segmentText = new Map(preparedTarget.segments.map(item => [item.id, item.text]));
            const castGaps: CastGap[] = [];
            const seenCast = new Set<string>();
            for (const image of candidate.images) {
              const text = segmentText.get(image.position) ?? '';
              const aliasPresent = findCharAliases(entriesBefore, text).map(hit => hit.name);
              const present = [
                ...new Set([
                  ...[...entriesBefore].map(entry => entry.name).filter(name => text.includes(name)),
                  ...aliasPresent,
                ]),
              ];
              const charTagList = (image.characters ?? []).map(character => character.tag);
              const found = [
                ...diagnoseCast(
                  text,
                  image.tag,
                  image.characters ?? [],
                  present,
                  profile.naiCharPrompts,
                ),
                ...diagnosePropTarget(text, image.tag, charTagList),
                ...diagnoseContact(
                  text,
                  image.tag,
                  charTagList,
                ),
              ];
              for (const gap of found) {
                const key = `${image.position}\u0000${gap.detail}`;
                if (seenCast.has(key)) continue;
                seenCast.add(key);
                castGaps.push(gap);
              }
            }
            if (castGaps.length) {
              retryNote = castRetryNote(castGaps);
              throw new Error(`画面事实不符(${castGaps.map(gap => gap.kind).join('、')})`);
            }
          }
          // 服装账本:衣服明明没变,穿脱程度却跳了(半脱→全裸、已脱→又穿回),
          // 或者正文没写换装,整套衣服被换成另一套。
          // 这条最伤连续性,而且模型自己看不出来——它没有上一层的画面。
          // 构图缺项:只在还有重试次数时纠一次。没次数了就放行——
          // 交一张景别平庸的图,好过因为「没写机位」整楼不生。
          if (attempt < retries) {
            const gaps = [
              ...new Set(
                candidate.images
                  .map(image =>
                    diagnoseShot(
                      image.tag,
                      (image.characters ?? []).map(character => character.tag),
                    ),
                  )
                  .filter(diag => !diag.softOnly)
                  .flatMap(diag => diag.missing),
              ),
            ];
            if (gaps.length) {
              retryNote = shotRetryNote(gaps);
              throw new Error(`构图缺项(${gaps.join('、')})`);
            }
            if (!slot) {
              const monoGaps = diagnoseMonotonousShots(candidate.images);
              if (monoGaps.length) {
                retryNote = monotonousShotRetryNote(monoGaps);
                throw new Error(
                  `构图雷同(${monoGaps.map(g => `${g.positions.join('/')} 均为 ${g.signature}`).join('、')})`,
                );
              }
            }
          }
          parsed.plan = candidate;
        };
        // 有重试时给 source 带上第几次,历史里两条记录一眼看出是重试关系
        const source = slot
          ? `重写提示词(第 ${floor} 楼 · 第 ${slot.seq + 1} 张${retries > 0 ? ` · 第 ${attempt + 1} 次` : ''})`
          : retries > 0
            ? `自动 tag(第 ${floor} 楼 · 第 ${attempt + 1} 次)`
            : `自动 tag(第 ${floor} 楼)`;
        if (channel) {
          await requestCompletion(channel, attemptMessages, {
            signal: controller.signal,
            source,
            validate,
          });
        } else {
          await requestViaMainApi(attemptMessages, {
            signal: controller.signal,
            source,
            validate,
          });
        }
        if (controller.signal.aborted) {
          processed.delete(identity);
          return;
        }
        plan = parsed.plan;
      } catch (error) {
        if (controller.signal.aborted) {
          processed.delete(identity);
          return;
        }
        lastError = error instanceof Error ? error.message : String(error);
        // HTTP 层被拦时错误信息里带的是渠道原文(常见 400 + 「内容审核」),它进不了 validate
        // (内容为空时 client 直接抛错),所以这里补判一次。空内容同样按被拦处理:
        // 两者都要降载,判错方向的代价只是这一次重试更短,不会更差。
        if (/空内容/.test(lastError) || diagnoseBlock(lastError).blocked) {
          blockedOnce = true;
          retryNote = BLOCK_RETRY_NOTE;
        }
        console.warn(`[墨影] 第 ${floor} 楼第 ${attempt + 1}/${retries + 1} 次生成 tag 失败`, error);
      }
    }
    if (!plan) {
      // 重试耗尽:允许同一正文在后续重新渲染后再试
      processed.delete(identity);
      toastr.error(
        `${lastError}${retries > 0 ? `(已自动重试 ${retries} 次)` : ''}`,
        '墨影自动 tag 失败',
      );
      if (opts.headless) throw new Error(lastError || 'tag 分析未通过校验');
      return;
    }

    // 单槽重写不落 changes:首次全量分析已为整楼建过档,这里再应用一次只会产生
    // 重复的建档/变更记录;库文本已含本楼增量(见上面 entriesBefore),AI 照抄即可。
    const assessedIdentities = assessIdentityClaims(plan.identities ?? [], identitySources);
    const planIdentities = mergeIdentityFacts([...knownIdentities, ...assessedIdentities]);
    const safeEntries = eligibleIdentityEntries(entriesBefore, planIdentities);
    const appearanceChangeNotes: string[] = [];
    const planOps = slot ? [] : planChangeOps(plan, source, appearanceChangeNotes);
    // 锁定角色(全局库)不接受 AI changes:丢弃,不写入楼层、不参与 @替换。
    // 重放侧 applyCharTagOps 也会按锁定名再拦一次(旧消息里可能已存这类 ops)。
    const effectiveOps = lockedNames.size
      ? planOps.filter(item => !lockedNames.has(item.op.name))
      : planOps;
    // 同人角色保护:角色库只填了 fandom、hair/eyes/skin/body 全空时,长相由同人 tag 决定。
    // 用户把那几个字段清空是刻意为之,AI 从正文抄回的发色瞳色写进去会和同人 tag 打架。
    const fandomGuarded = new Set(
      anchors.entries
        .filter(
          entry =>
            entry.fields.fandom.trim() &&
            !entry.fields.hair.trim() &&
            !entry.fields.eyes.trim() &&
            !entry.fields.skin.trim() &&
            !entry.fields.body.trim(),
        )
        .map(entry => entry.name),
    );
    const guardedOps = fandomGuarded.size
      ? effectiveOps.filter(item => {
          const op = item.op;
          if (op.kind !== 'set') return true;
          if (FANDOM_GUARD_FIELDS.has(op.field)) return !fandomGuarded.has(op.name);
          return true;
        })
      : effectiveOps;
    // 男性不建档:同上,规则之外再兜一次,把 sex 明确是男性的 new 直接丢掉。
    const maleGuarded = guardedOps.filter(item => {
      const op = item.op;
      if (isMaleIdentity(op.name, planIdentities)) { appearanceChangeNotes.push(`${op.name}: 男性身份已确认，不自动建档或更新女主外貌`); return false; }
      if (op.kind !== 'new') return true;
      const accepted = mayCreateHeroine(op.name, planIdentities) && !MALE_SEX_RE.test(op.fields.sex.trim());
      if (!accepted) appearanceChangeNotes.push(`${op.name}: 暂不自动入库，需要已验证女性身份及女主资格；本张仍可正常出镜`);
      if (accepted) op.fields.sex = '1girl';
      return accepted;
    });
    const floorOps = maleGuarded.map(item => item.op);
    const previousDelta = readCharTagFloorDelta(message);

    plan.images.sort((a,b) => a.sourceLine - b.sourceLine || a.charOffset - b.charOffset);
    const activeEntries = applyCharTagOps(safeEntries, floorOps, floor, lockedNames);
    const accepted = acceptClothingChanges(plan.outfitChanges ?? [], source, wardrobe, activeEntries);
    const scope = `${chatId}|${floor}|${swipeId ?? 0}|${expectedStory}`;
    const frames: ClothingFloor['frames'] = [];
    const completion: ClothingState = new Map();
    const visualNotes: string[] = [...accepted.rejected, ...appearanceChangeNotes];
    // @占位符按正文位置替换：变化前图片用旧档，变化位置及之后用新档。
    const unknownNames = new Set<string>();
    for (const image of plan.images) {
      // 协议只要 tag 时,模型照写的 nl 一律丢掉(ComfyUI 关自然语言同一口径):
      // 留着它就会照常发送,开关等于没关。渠道锁了方向则统一改记锁定值——出图本就按锁走,
      // 这里只是让 tag 里记的方向与实际画幅一致。
      if (!profile.nl) {
        image.nl = '';
        for (const character of image.characters) character.nl = '';
      }
      if (profile.lockedSize) image.size = profile.lockedSize;
      const tagRes = applyPositionedCharRefs(
        image.tag,
        anchors.entries,
        maleGuarded,
        image.sourceLine,
        'tag',
        lockedNames, image.charOffset,
      );
      if (tagRes.text) image.tag = tagRes.text;
      if (image.nl) {
        const nlRes = applyPositionedCharRefs(
          image.nl,
          anchors.entries,
          maleGuarded,
          image.sourceLine,
          'nl',
          lockedNames, image.charOffset,
        );
        image.nl = nlRes.text;
        for (const n of nlRes.unknown) unknownNames.add(n);
      }
      for (const character of image.characters) {
        const charTag = applyPositionedCharRefs(
          character.tag,
          anchors.entries,
          maleGuarded,
          image.sourceLine,
          'tag',
          lockedNames, image.charOffset,
        );
        character.tag = charTag.text;
        for (const n of charTag.unknown) unknownNames.add(n);
        if (character.nl) {
          const charNl = applyPositionedCharRefs(
            character.nl,
            anchors.entries,
            maleGuarded,
            image.sourceLine,
            'nl',
            lockedNames, image.charOffset,
          );
          character.nl = charNl.text;
          for (const n of charNl.unknown) unknownNames.add(n);
        }
      }
      for (const n of tagRes.unknown) unknownNames.add(n);
      const entriesAt = applyCharTagOps(safeEntries, maleGuarded.filter(o => o.op.kind === 'new' || o.sourceLine < image.sourceLine
        || o.sourceLine === image.sourceLine && (o.charOffset ?? 0) <= image.charOffset).map(o => o.op), floor, lockedNames);
      visualNotes.push(...enforceAppearance(image, entriesAt, profile.nl, profile.naiCharPrompts, planIdentities));
      visualNotes.push(...enforceKnownMaleIdentity(image, libraryAtStart, planIdentities, profile.naiCharPrompts));
      const at = slotWardrobe ?? clothingAt(wardrobe, accepted.changes, scope, image.sourceLine, image.charOffset);
      for (const [name, entry] of completion) if (!at.has(name)) at.set(name, entry);
      initialiseClothingFromImage(image, at);
      for (const [name, entry] of at) if (!wardrobe.has(name) && !accepted.changes.some(c => c.name === name)) completion.set(name, entry);
      enforceClothing(image, at, profile.nl, profile.naiCharPrompts);
      frames.push({ tag: serializeImageTag(image), sourceLine: image.sourceLine, charOffset: image.charOffset, entries: [...at.values()] });
    }
    if (unknownNames.size) {
      // 模型认为这是角色、却没给它建档 —— 该角色在图里将完全没有外貌。
      // 这是漏建档唯一的确定性信号,藏进控制台等于没有,必须让用户看见。
      const names = [...unknownNames].join('、');
      console.warn('[墨影] AI 引用了库里没有的角色占位符,已剥除:', names);
      toastr.warning(`角色「${names}」没有建档，本次画面中缺少其外貌`, '墨影');
    }

    // 单槽重写没给出新提示词:保留原提示词与原图,不替换(空 images 不是错误)。
    if (slot && !plan.images.length) {
      toastr.info('模型没有给出新的提示词，本张保持原样', '墨影');
      return;
    }
    // 没有图片、没有角色变化、也没有旧楼层变化要清理时,保持原来的无写入早退。
    if (!plan.images.length) opts.onNoImages?.();
    if (!plan.images.length && !floorOps.length && !accepted.changes.length && !assessedIdentities.length && !previousDelta) {
      if (opts.manual) toastr.info('模型认为本楼没有值得插图的画面', '墨影');
      else console.debug(`[墨影] 第 ${floor} 楼无需插图`);
      return;
    }

    // 触发 MESSAGE_EDITED / MESSAGE_UPDATED,卡片水合挂载时消费标记并自动开始生成
    // (见 floor/autoGenerate.ts);写回失败则撤销标记。
    // 单槽重写是用户在卡片上的显式意图(同提示词编辑弹窗的「应用并重新生成」),
    // 不受 autoTag.autoGenerate 开关约束,一律 force 出图。
    const markSwipeId = message.swipe_id ?? 0;
    const marked = !opts.headless && plan.images.length > 0 && (settings.autoTag.autoGenerate || !!slot);
    if (!slot && opts.replace) {
      cancelBackgroundFloorJobs(chatId, floor);
    }
    if (marked) {
      if (slot) {
        markForAutoGenerate(chatId, floor, markSwipeId, slot.seq, 'force');
        preclaimBackgroundSlots(chatId, floor, markSwipeId, [slot.seq]);
      } else {
        const seqs: number[] = [];
        for (let seq = 0; seq < plan.images.length; seq++) {
          markForAutoGenerate(chatId, floor, markSwipeId, seq);
          seqs.push(seq);
        }
        preclaimBackgroundSlots(chatId, floor, markSwipeId, seqs);
      }
    }
    // 正文在 buildNext 里基于「落盘那一刻的真实正文」现算:分析期间别的插件对正文的修改
    // (翻译/润色/追加状态栏/改写句子)全部保留,tag 按叙事行重新定位后照常注入。
    let rebaseNote = '';
    // 真正落进正文的那批插入项(重定位后的),供写盘成功后转交后台出图。
    let writtenImages: ImageInsertion[] = [];
    // 全量写入同时落两笔:角色增量与本楼的服装账本。账本按「本楼实际写出的画面」冻结,
    // 下一楼读它当既成事实——没有这一笔,下一楼就又得从零猜她穿了什么、脱到哪一步。
    // 注意:applyMessageText 的实参在进入 buildNext 之前就会求值,因此账本必须用 plan.images 计算!
    const finalWardrobe = clothingAt(wardrobe, accepted.changes, scope);
    for (const [name, entry] of completion) if (!finalWardrobe.has(name)) finalWardrobe.set(name, entry);
    const previousWardrobe = message.extra?.[BBI_OUTFIT_EXTRA_KEY] as Partial<ClothingFloor> | undefined;
    const nextWardrobe: ClothingFloor = { v: 2, swipe: swipeId ?? 0, sourceHash: expectedStory, upstreamHash: wardrobeRevision,
      start: [...wardrobe.values()], entries: [...finalWardrobe.values()], changes: accepted.changes, rejected: visualNotes, frames,
      legacyBackup: previousWardrobe?.v === 2 ? previousWardrobe.legacyBackup : previousWardrobe };
    const rewrittenWardrobe = slot && savedWardrobe && savedWardrobe.frames[slot.seq]?.tag === slotRawTag
      ? { ...savedWardrobe, frames: savedWardrobe.frames.map((frame, index) => index === slot.seq && plan.images[0] ? { ...frame, tag: serializeImageTag(plan.images[0]) } : frame) } : null;
    if (visualNotes.length) diagnostic('continuity:resolved', { floor, notes: visualNotes });
    const result = await applyMessageText(
      floor,
      currentText => {
        if (controller.signal.aborted || narrativeHash(currentText) !== expectedStory || clothingRevision(getContext()?.chat ?? [], floor) !== wardrobeRevision
          || JSON.stringify(charTagsBeforeFloor(slot ? floor + 1 : floor)) !== expectedLibrary || identityManualRevision() !== identityRevision) return null;
        // 单槽重写:只替换第 seq 条 tag,正文与其它 tag 一字不动,也不需要位置重定位。
        // 模型返回的 position 在这里刻意不参与——画面钉死在原位,它只负责重写内容。
        // 开跑时快照的原文对不上 = 期间被用户/别的流程改过,放弃覆盖(同提示词编辑弹窗)。
        if (slot) {
          if (parseImageTags(currentText)[slot.seq] !== slotRawTag) return null;
          writtenImages = [plan.images[0]];
          return replaceImageTagAt(currentText, slot.seq, serializeImageTag(plan.images[0]));
        }
        // replace 路径同样以当前正文为基底剔除旧 tag,不能用旧快照
        const base = opts.replace ? stripImageTags(currentText) : currentText;
        if (!plan.images.length) return base;
        // 请求期间用户/别的插件已经贴过 tag:再注入就是重复,交回 build-failed 走放弃分支
        if (!opts.replace && hasImageTagTrace(currentText)) return null;
        const rebased = rebaseImagePositions(
          base,
          preparedTarget.segments,
          plan.images,
          settings.excludes.customStripTags,
        );
        if (!rebased) return null;
        rebaseNote = describeRebase(rebased.report);
        writtenImages = rebased.images;
        return injectImageTags(base, rebased.images);
      },
      chatId,
      swipeId,
      message,
      // 单槽不写法:本楼角色增量与其它槽位图片都不归它管,不传 extraUpdate 即保持原样。
      slot
        ? rewrittenWardrobe ? [{ key: BBI_OUTFIT_EXTRA_KEY, value: rewrittenWardrobe }] : undefined
        : [
            {
              key: IDENTITY_EXTRA_KEY,
              value: { v: 1, swipe: swipeId ?? 0, sourceHash: identityStoryHash(rawSource), contextHash: identityContextHash(), facts: assessedIdentities },
            },
            {
              key: BBI_CHAR_EXTRA_KEY,
              value: makeCharTagFloorDelta(floorOps, swipeId ?? 0),
            },
            {
              key: BBI_OUTFIT_EXTRA_KEY,
              value: nextWardrobe,
            },
          ],
      { render: !opts.headless },
    );
    if (result === 'saved') {
      // 后台直跑:写盘成功就把这批槽位交给 floor/backgroundGen.ts。
      // 它先抢标记——前台卡片若已经接手(标记被消费)它就直接让位,不会双跑;
      // 手机上切后台或阅读器静默生非视口楼层时卡片不挂载,标记没人抢,于是由它跑完并反推界面。
      //
      // 必须直接从已落盘的 message.mes 按物理出现顺序(parseImageTags)构造 BackgroundJob:
      // 1) writtenImages 保持的是模型返回的数组顺序(按重要性排序),而非 injectImageTags 按
      //    sourceLine/charOffset 重排后的物理槽位顺序,直接用 index 当 seq 会与卡片槽位错位;
      // 2) BackgroundJob.tag 必须是含 <bbi_image>…</bbi_image> 壳的完整原文(与 hydrate.ts /
      //    Card.vue / storage.ts 的 promptHash 口径完全一致),绝不能传裸 image.tag!
      if (marked && writtenImages.length) {
        const savedRawTags = parseImageTags(message.mes ?? '');
        const jobs = slot
          ? (() => {
              const rawTag = savedRawTags[slot.seq] ?? serializeImageTag(writtenImages[0]);
              const content = parseImageTagContent(rawTag);
              return [
                {
                  chatId,
                  messageId: floor,
                  swipeId: markSwipeId,
                  seq: slot.seq,
                  tag: rawTag,
                  prompt: content.tag,
                  nl: content.nl,
                  negative: content.negative,
                  characters: content.characters,
                  size: content.size,
                },
              ];
            })()
          : savedRawTags.map((rawTag, seq) => {
              const content = parseImageTagContent(rawTag);
              return {
                chatId,
                messageId: floor,
                swipeId: markSwipeId,
                seq,
                tag: rawTag,
                prompt: content.tag,
                nl: content.nl,
                negative: content.negative,
                characters: content.characters,
                size: content.size,
              };
            });
        void runBackgroundGenerations(jobs);
      }
      if (slot) {
        toastr.success(`已重写第 ${slot.seq + 1} 张的提示词，正在按新提示词出图`, '墨影');
        return;
      }
      recomputeCharTags();
      if (rebaseNote) console.info(`[墨影] 第 ${floor} 楼 tag 位置重定位:${rebaseNote}`);
      if (plan.images.length) {
        toastr.success(`已在第 ${floor} 楼插入 ${plan.images.length} 个生图 tag`, '墨影');
      } else if (opts.manual) {
        toastr.info('模型认为本楼没有值得插图的画面', '墨影');
      } else {
        console.debug(`[墨影] 第 ${floor} 楼无需插图`);
      }
      return;
    }
    if (opts.headless) throw new Error(ABANDON_REASON[result] || result);
    // 撤销标记只撤自己那一枚:clearAutoGenerateForFloor 会连累同楼其它槽位的待消费标记。
    if (marked) {
      clearPreclaimedBackgroundSlots(chatId, floor);
      if (slot) consumeAutoGenerate(chatId, floor, markSwipeId, slot.seq);
      else clearAutoGenerateForFloor(chatId, floor);
    }
    console.info(`[墨影] 第 ${floor} 楼放弃写入生图 tag：${result}`);
    // 单槽重写的放弃原因与全量不同:正文其它部分改没改不重要,关键是这一条 tag 被改过
    if (slot && result === 'build-failed') {
      toastr.warning('这张图的提示词在生成期间已被改动，本次没有覆盖它', '墨影');
    } else {
      toastr.warning(ABANDON_REASON[result] ?? '本次没有写入生图 tag', '墨影');
    }
  } catch (error) {
    // 请求失败或被切换聊天取消时允许同一正文在后续重新渲染后重试。
    processed.delete(identity);
    // 异常发生在挂标记之后时(如保存失败回滚),撤销本楼标记,不留残留。
    // 单槽只撤自己那一枚:clearAutoGenerateForFloor 会连累同楼其它槽位的待消费标记。
    clearPreclaimedBackgroundSlots(chatId, floor);
    if (slot) consumeAutoGenerate(chatId, floor, swipeId ?? 0, slot.seq);
    else clearAutoGenerateForFloor(chatId, floor);
    if (opts.headless) throw error;
    if (controller.signal.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[墨影] 第 ${floor} 楼自动生成 tag 失败`, error);
    toastr.error(message, '墨影自动 tag 失败');
  } finally {
    if (running.get(runKey) === controller) running.delete(runKey);
  }
}

function cancelAll(): void {
  diagnostic('cancelAll', { scheduled: scheduled.size, running: running.size });
  clearGeneration();
  for (const timer of scheduled) clearTimeout(timer);
  scheduled.clear();
  for (const controller of running.values()) controller.abort();
  running.clear();
}

function scheduleForGeneratedFloor(floor: number, chatId: string): void {
  diagnostic('schedule', { floor, chatId });
  const timer = setTimeout(() => {
    scheduled.delete(timer);
    const currentChatId = getContext()?.getCurrentChatId?.() ?? '';
    diagnostic('schedule:fire', { floor, chatId, currentChatId, sameChat: currentChatId === chatId });
    if (currentChatId !== chatId) return;
    void runForFloor(floor);
  }, 0);
  scheduled.add(timer);
}

/**
 * 楼层按钮的手动入口。replace=true 用于「已有 tag 重新生成」:
 * 剔除旧 tag → 分析 → 写回新 tag(旧 tag 随写回消失,旧图留在卡片历史)。
 */
export async function requestFloorTags(floor: number, opts: { replace?: boolean } = {}): Promise<void> {
  await runForFloor(floor, { manual: true, replace: opts.replace });
}

/**
 * 「AI 重写提示词」的手动入口:只重写并替换第 seq 条 tag(0-based)。
 *
 * 入口在提示词编辑弹窗里(floor/promptEditor.ts)——手改与 AI 改是同一件事的两种手段。
 * 调用方把本函数交给 floor/tagPlanState.ts 的 runTagPlan 托管:请求的生命周期归那个
 * store,**关掉弹窗不中断重写**。
 *
 * 画的仍是原来那个瞬间:写回按 seq 原位替换,模型返回的 position 不参与,措辞口径见
 * slotPlan.buildSlotTaskNote(把该槽位当前提示词喂回去当锚点)。
 * 分析基底剔除全部旧 tag(AI 不该把 tag 当正文),强制输出 1 张;本楼其它 tag 与图片
 * 一字不动,旧图留在该槽位历史里。本次 AI 输出的 changes 一律忽略(首次全量分析时已建档)。
 */
export async function requestNovelFloorTags(floor: number): Promise<{ status: 'tagged' | 'no-images' }> {
  let noImages = false;
  await runForFloor(floor, { manual: true, headless: true, onNoImages: () => { noImages = true; } });
  if (noImages) return { status: 'no-images' };
  if (!parseImageTags(getContext()?.chat[floor]?.mes || '').length) {
    throw new Error('本次没有保存有效 tag，未自动重复提交');
  }
  return { status: 'tagged' };
}

export async function requestSlotTag(floor: number, seq: number): Promise<void> {
  await runForFloor(floor, { manual: true, slot: { seq } });
}

/** 中止某楼在途的 tag 请求(全量分析与单槽重写共用同一把「每楼一把」的锁)。 */
export function cancelFloorTags(floor: number): void {
  const chatId = getContext()?.getCurrentChatId?.() ?? '';
  running.get(`${chatId}\u0000${floor}`)?.abort();
}

/** 查询某楼是否正在跑自动生图 tag 分析 */
export function isFloorTagRunning(floor: number): boolean {
  const chatId = getContext()?.getCurrentChatId?.() ?? '';
  return running.has(`${chatId}\u0000${floor}`);
}

/** Only pair automatic tagging with the final render of a real ST generation. */
export function bindAutoTagging(): void {
  if (bound) {
    diagnostic('bind:skip', { reason: 'already-bound' });
    return;
  }
  const context = getContext();
  const events = context?.eventTypes;
  if (!context?.eventSource || !events?.GENERATION_STARTED || !events.CHARACTER_MESSAGE_RENDERED) {
    diagnostic('bind:skip', {
      reason: 'missing-events',
      hasContext: Boolean(context),
      hasEventSource: Boolean(context?.eventSource),
      generationStarted: events?.GENERATION_STARTED ?? null,
      characterRendered: events?.CHARACTER_MESSAGE_RENDERED ?? null,
    });
    return;
  }
  bound = true;

  diagnostic('bind', {
    generationStarted: events.GENERATION_STARTED,
    characterRendered: events.CHARACTER_MESSAGE_RENDERED,
    generationEnded: events.GENERATION_ENDED ?? null,
    generationStopped: events.GENERATION_STOPPED ?? null,
    chatChanged: events.CHAT_CHANGED,
  });
  context.eventSource.on(
    events.GENERATION_STARTED,
    (type: unknown, options: unknown, dryRun: unknown) => {
      const chatId = getContext()?.getCurrentChatId?.() ?? '';
      const eligible = Boolean(
        chatId && !dryRun && typeof type === 'string' && type !== 'quiet' && type !== 'impersonate',
      );
      diagnostic('GENERATION_STARTED', { chatId, type, dryRun, eligible, options });
      beginGeneration(chatId, type, dryRun);
    },
  );
  context.eventSource.on(events.CHARACTER_MESSAGE_RENDERED, (messageId: unknown, type: unknown) => {
    const chatId = getContext()?.getCurrentChatId?.() ?? '';
    const matched = consumeGeneration(chatId, type);
    diagnostic('CHARACTER_MESSAGE_RENDERED', { chatId, messageId, type, matched });
    if (!matched) return;
    const floor = typeof messageId === 'number' ? messageId : Number(messageId);
    if (!Number.isInteger(floor) || floor < 0) {
      diagnostic('render:skip', { chatId, messageId, type, reason: 'invalid-floor' });
      return;
    }
    // Do not block ST finalization, and pin the deferred run to the originating chat.
    scheduleForGeneratedFloor(floor, chatId);
  });
  if (events.GENERATION_ENDED) {
    context.eventSource.on(events.GENERATION_ENDED, (...args: unknown[]) => {
      // ST may emit this before the final CHARACTER_MESSAGE_RENDERED; that render consumes the gate.
      diagnostic('GENERATION_ENDED', { args, action: 'keep-pending-until-final-render' });
    });
  }
  if (events.GENERATION_STOPPED) {
    context.eventSource.on(events.GENERATION_STOPPED, (...args: unknown[]) => {
      diagnostic('GENERATION_STOPPED', { args });
      clearGeneration();
    });
  }
  context.eventSource.on(events.CHAT_CHANGED, (...args: unknown[]) => {
    diagnostic('CHAT_CHANGED', { args, currentChatId: getContext()?.getCurrentChatId?.() ?? '' });
    cancelAll();
  });
}
