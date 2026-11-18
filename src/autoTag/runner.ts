import { recoverProfileFields } from './profileRecovery';
import {
  appearancePolicyRevision,
  blocksAppearanceChange,
  appearancePolicyBlock,
} from '@/state/appearancePolicy';
import { applyWardrobeChoices, wardrobeChoiceRevision, suitNote } from '@/state/wardrobeChoice';
import {
  costumeConflicts,
  explicitCostumeEvidence,
  costumeBefore,
  resolveCostumeFloor,
  costumeAt,
  prepareCostumeRepairs,
  repairCostumeState,
  removeUnbackedCostume,
  type CostumeRequest,
} from './costumeContext';
import {
  IDENTITY_PROTOCOL,
  IDENTITY_EXTRA_KEY,
  assessIdentityClaims,
  currentIdentityFacts,
  eligibleIdentityEntries,
  femaleStoryFact,
  enforceKnownMaleIdentity,
  identityContextHash,
  identityFactFor,
  isMaleIdentity,
  identityManualRevision,
  identityStoryHash,
  mayCreateHeroine,
  mergeIdentityFacts,
  type IdentityFact,
  type IdentitySources,
} from '@/state/characterIdentity';
import { requestCompletion, requestViaMainApi, type ChatMsg } from '@/api/client';
import { repairMessages } from '@/autoTag/repair';
import { looksLikeCredentialFailure, looksLikeTimeout, looksLikeUpstreamJitter } from '@/api/modelVariant';
import { blockRetryNote, diagnoseBlock, neutralizeMessages } from '@/autoTag/blockGuard';
import { isGeminiTier } from '@/autoTag/jailbreak';
import { repairQuotes, shieldMessages, type Shielded } from '@/autoTag/geminiShield';
import { readBookMemory } from '@/autoTag/bookMemory';
import { applyPositionedCharRefs, resolveCharAnchors, type PositionedCharOp } from '@/autoTag/charAnchors';
import {
  diagnoseCast,
  diagnoseContact,
  diagnoseFemaleSubject,
  diagnosePropTarget,
  castRetryNote,
  type CastGap,
} from '@/autoTag/castCheck';
import { ensureFemaleSubjects, femaleCastNames } from '@/autoTag/femaleCast';
import { hasFemaleSignal } from '@/autoTag/femaleSignal';
import { anchorBlock, buildAnchors } from '@/autoTag/anchorLedger';
import { buildShotLedger, shotLedgerBlock } from '@/autoTag/shotLedger';
import { ensureImageProfiles } from '@/autoTag/imageProfiles';
import { diversifyLook, diversifyNewOps } from '@/autoTag/lookDiversity';
import { characterAliases, saveCharacterAliases } from '@/state/characterAliases';
import { prepareTargetText } from '@/autoTag/clean';
import {
  buildCharReuseBlock,
  findCharAliases,
  findCharReuse,
  normalizePlanCharacters,
  resolveCanonicalCharName,
} from '@/autoTag/charReuse';
import { BBI_OUTFIT_EXTRA_KEY } from '@/autoTag/outfitState';
import { BBI_OUTCOME_EXTRA_KEY, classifyFailure, recordOutcome, type FloorOutcome } from '@/autoTag/outcome';
import { BBI_TRACE_EXTRA_KEY, buildFloorTrace, type FloorTrace } from '@/autoTag/trace';
import {
  BBI_FACTS_EXTRA_KEY,
  factsAcrossSceneBreak,
  factsBackedByLedger,
  gateFactOwnership,
  factsToClothingChanges,
  applyFactClothing,
  rememberCompleteOutfit,
  restoreOutfitFacts,
  factsBlock,
  dedupeFacts,
  repairByFacts,
  stripExposureTokens,
  dropExposureClaims,
  inheritWearFacts,
  reconcileLedgerWithTags,
  type StoredFacts,
  type StoryFact,
} from '@/autoTag/facts';
import { storyGarments } from '@/autoTag/storyGarments';
import {
  CLOTHING_PROTOCOL,
  acceptClothingChanges,
  applyExplicitFacts,
  storyLooksLikeNewScene,
  applyTextQualifiers,
  adoptChangedClothing,
  adoptStoryClothing,
  synthesiseSceneClothing,
  unreportedClothingActions,
  clothingAt,
  clothingBefore,
  clothingBlock,
  clothingRevision,
  enforceClothing,
  garmentKind,
  initialiseClothingFromImage,
  redressForNewScene,
  narrativeHash,
  readClothingFloor,
  savedImageClothing,
  settleStaleUndress,
  type ClothingFloor,
  type ClothingState,
} from '@/autoTag/outfitTimeline';
import { enforceAppearance } from '@/autoTag/appearanceLock';
import { beginGeneration, clearGeneration, consumeGeneration } from '@/autoTag/generationGate';
import { compactContractFor, useCompactContract } from '@/autoTag/compactContract';
import { autoTagProfile, buildAutoTagMessages, flattenToSystem } from '@/autoTag/prompt';
import { rebaseImagePositions, type RebaseReport } from '@/autoTag/rebase';
import { buildSlotTaskNote } from '@/autoTag/slotPlan';
import {
  diagnoseMonotonousShots,
  diagnoseShot,
  monotonousShotRetryNote,
  repairShotDefaults,
  shotRetryNote,
} from '@/autoTag/shotCheck';
import { salvageJsonObject } from '@/autoTag/salvage';
import { applySuggestedDistance, diagnoseDistance } from '@/autoTag/shotGuide';
import { isDrawWorthy } from '@/autoTag/fallbackImage';
import { refreshWardrobeLock } from '@/st/wardrobeLock';
import {
  adjacentPositionNote,
  adjacentPositions,
  duplicatePositionNote,
  duplicatePositions,
  unanchoredIndexes,
} from '@/autoTag/positionCheck';
import { diagnoseTruncation, EMPTY_PLAN_RETRY_NOTE, truncationRetryNote } from '@/autoTag/truncation';
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
  type CharTagEntry,
  type CharTagField,
  type CharTagNewOp,
} from '@/state/charTags';
import { injectImageTags, parseImagePlan, type ImageInsertion, type ImagePlan } from '@/autoTag/protocol';
import { appendExplicitTags, explicitSentence, explicitTagsFor, mouthSide } from '@/autoTag/explicitTags';
import { actExpansion, alignMouthAct, enforceActFraming } from '@/autoTag/actTags';
import { thinDesign } from '@/data/designGuide';
import { clearAutoGenerateForFloor, consumeAutoGenerate, markForAutoGenerate } from '@/floor/autoGenerate';
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
import { getTagGenChannel, isCurrentChatExcluded, settings, type ApiChannel } from '@/state/settings';

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
  if (report.drifted) parts.push(`顺延到后方段落 ${report.drifted}`);
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

export function planChangeOps(
  plan: ImagePlan,
  source: string,
  notes: string[],
  entries: CharTagEntry[] = [],
): PositionedCharOp[] {
  const ops: PositionedCharOp[] = [];
  for (const change of plan.changes) {
    if (blocksAppearanceChange(change.name, change.field)) {
      notes.push(change.name + ': 用户绘图覆盖已阻止 ' + change.field + ' 剧情变更');
      continue;
    }
    if (change.field !== 'new') {
      const lines = source.replace(/\r\n?/g, '\n').split('\n');
      const preceding = [
        ...lines.slice(0, change.sourceLine),
        (lines[change.sourceLine] ?? '').slice(0, change.charOffset || undefined),
      ].join('\n');
      if (
        !change.evidence ||
        !preceding.includes(change.evidence) ||
        !change.evidence.includes(change.name)
      ) {
        notes.push(`${change.name}: 未采纳 ${change.field} 变更，缺少有效原文证据`);
        continue;
      }
      const existing = entries.find((e) => e.name === change.name);
      const description: Record<string, RegExp> = {
        hair: /头发|发丝|发型|长发|短发|马尾|辫|披发|刘海|秀发|hair|ponytail|braid/i,
        eyes: /眼|瞳|眸|eyes|iris/i,
        skin: /肤|skin/i,
        body: /身材|体型|身高|胸|纤细|苗条|高挑|娇小|figure|body|stature/i,
        extra: /脸|眉|鼻|唇|耳|痣|疤|轮廓|face|eyebrow|lips|jaw|ears/i,
        age: /岁|年龄|年纪|years old|age/i,
      };
      const tokens = (v: string) =>
        v
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
      const oldTokens = tokens(existing?.fields[change.field as CharTagField] || '');
      const nextTokens = new Set(tokens(change.value));
      const supplement =
        existing &&
        existing.source !== 'manual' &&
        description[change.field]?.test(change.evidence) &&
        (!existing.fieldEvidence?.[change.field as CharTagField] ||
          oldTokens.every((t) => nextTokens.has(t)));
      const action =
        /染|剪|剃|长大|长高|成长|变身|变成|变为|留下.{0,6}疤|受伤|恢复|治愈|永久|dye|cut|shav|grow|transform|scar|heal|permanent/i;
      if (
        (!action.test(change.evidence) && !supplement) ||
        change.field === 'fandom' ||
        change.field === 'sex' ||
        change.field === 'outfit'
      ) {
        notes.push(`${change.name}: 未采纳 ${change.field} 变更，不能自动重写身份或把当前穿搭写进外貌库`);
        continue;
      }
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
    if (op?.kind === 'set') op.evidence = change.evidence;
    if (
      op?.kind === 'new' &&
      change.evidence &&
      source.includes(change.evidence) &&
      change.evidence.includes(change.name)
    ) {
      const hints: Partial<Record<CharTagField, RegExp>> = {
        hair: /发|辫|马尾|hair|braid|ponytail/i,
        eyes: /眼|瞳|眸|eyes/i,
        skin: /肤|skin/i,
        body: /体型|身材|胸|身高|figure|body/i,
        extra: /脸|眉|鼻|唇|痣|疤|face|eyebrow|lips/i,
        age: /岁|年龄|age/i,
      };
      op.fieldEvidence = Object.fromEntries(
        Object.entries(hints)
          .filter(
            ([key, re]) => op.kind === 'new' && op.fields[key as CharTagField] && re.test(change.evidence!),
          )
          .map(([key]) => [key, change.evidence!]),
      );
    }
    if (op) ops.push({ op, sourceLine: change.sourceLine, charOffset: change.charOffset });
  }
  return ops.sort(
    (left, right) => left.sourceLine - right.sourceLine || (left.charOffset ?? 0) - (right.charOffset ?? 0),
  );
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
    abort(floor, 'already-has-image-tag', opts.manual, '本楼已有生图 tag，没有确认重新生成，本次未改动');
    if (!opts.manual) console.debug(`[墨影] 第 ${floor} 楼已经含有 bbi_image tag，跳过自动分析`);
    return;
  }
  // 分析一律基于剔除旧 tag 后的正文。写回时 replace 让旧 tag 随之消失,
  // slot 按 seq 原位替换——别的 tag 在写回基底里原样保留(写回用的是 currentText,不是这里)。
  //
  // 以前只有 replace/slot 才剔 tag,普通自动分析沿用带 tag 的原文,于是两套坐标系并存:
  // preparedTarget 的段落落点按「含 tag 的行」算,而模型引用的句子来自去掉 tag 的文本;
  // 更糟的是旧 tag 里的 `<characters>[{"name":…}]</characters>` 会被当成正文段落,
  // 场景推断于是把「两个人倒在床上…」判给了 tag 里最后出现的那个名字。
  // 实测第 68 楼(夜里)两条脱衣事件的 sourceLine 全变成 4、两张图都取到「穿好睡衣」。
  const source = stripImageTags(rawSource);
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
  // 同一楼、同一份正文之前提取过的事实时，本轮直接沿用：模型不用从零再猜一遍，
  // 重试也少写一段输出（首字延迟只付一次，输出量也小）。
  const storedFacts = (message.extra?.[BBI_FACTS_EXTRA_KEY] ?? null) as StoredFacts | null;
  // 上一楼的事实表：上一楼已确立的状态在下一楼仍然成立，一开始就下发，
  // 而不是等重试才补上。上一楼没提取过就是空。
  const previousFloorFacts = (context.chat[floor - 1]?.extra?.[BBI_FACTS_EXTRA_KEY] ?? null) as StoredFacts | null;
  const previousFacts: StoryFact[] =
    previousFloorFacts?.v === 1 ? dedupeFacts(previousFloorFacts.facts ?? []) : [];
  const cachedFacts: StoryFact[] =
    storedFacts && storedFacts.v === 1 && storedFacts.hash === textHash(source) ? storedFacts.facts : [];
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
    const structuredFacts = assessIdentityClaims([], {
      story: '',
      card: '',
      worldbook: '',
      book: memory?.roles ?? [],
    });
    const knownIdentities = mergeIdentityFacts([...currentIdentityFacts(), ...structuredFacts]);
    const entriesBefore = eligibleIdentityEntries(libraryAtStart, knownIdentities);
    /**
     * 空楼跳过：本楼通篇没有女性线索时，直接按「无需插图」收工，不上传历史也不请求模型。
     *
     * 批量跑几十楼时这是最大的一笔浪费——用户并不知道哪一楼有女角，插件却为每一楼
     * 付一次完整的上下文分析费，最后还因为「没有女性主体」把图丢掉。判据故意放宽
     * （见 femaleSignal.ts）：漏判一楼该出的图，比多花一次 token 严重得多。
     *
     * 只在前台手动点按钮时跳过闸门：那是用户对着这一楼按下去的，要给他一个交代，
     * 不能悄悄什么都不做。阅读器批量(manual+headless)属于自动流水线，照跳。
     */
    if (!slot && !(opts.manual && !opts.headless)) {
      const signalNames = femaleCastNames(entriesBefore, knownIdentities, source);
      if (!hasFemaleSignal(source, signalNames, entriesBefore)) {
        diagnostic('runForFloor:skip', { floor, reason: 'no-female-signal', sourceLength: source.length });
        console.debug(`[墨影] 第 ${floor} 楼没有女性角色线索，跳过分析`);
        opts.onNoImages?.();
        return;
      }
    }
    // 锁定名(全局库 ⊖ 本聊天基线):AI 的 changes 对这些名字一律无效,库文本里带 [locked] 标记
    const lockedNames = lockedCharTagNames();
    // 纯本地渲染:建档由主请求在同一次输出里完成(changes 的 field="new")
    const anchors = resolveCharAnchors(entriesBefore, lockedNames);
    // 上镜锚点:上一张图里她实际被写成什么样。与上面同名的 anchors 区分开——
    // 那个是角色库文本,这个是画面事实。只留这会儿还在楼里的角色:名字出现在目标正文,
    // 或本来就是已建档角色(离场的人继续注入只会把镜头往空处带)。
    const anchorLedger = anchorBlock(
      buildAnchors(
        context.chat,
        floor,
        (name) => source.includes(name) || entriesBefore.some((entry) => entry.name === name),
        // 传本楼正文:道具(刀/手铐/绳)只有这里还提到才继续挂着
        source,
        entriesBefore,
      ),
      entriesBefore.map((entry) => entry.name),
    );
    // 已出过的画面:上下文窗口之外的楼层模型看不见,同一体位与机位会被反复画。
    // 与上镜锚点同源(读 frames 里实际下发过的 tag),只多抽一层「动作签名」。
    const shotLedger = shotLedgerBlock(
      buildShotLedger(context.chat, floor, (target) => context.chat[target]?.mes ?? ''),
    );
    // 单槽重写:协议强制「恰好 1 张」,并把该槽位当前提示词与其余槽位摘要带给模型
    // (锚住同一个画面、别抢别人的画面)。min/max 要同时覆盖 build 的规则文案与下面的
    // parse 校验,只改一处会自相矛盾。
    const promptOptions = slot ? { ...settings.autoTag, minImages: 1, maxImages: 1 } : settings.autoTag;
    // gemini 档改发紧缩契约(见 compactContract.ts 的实测表)。整轮请求固定一次:
    // 验收、建档 nl 校验、重试都必须看同一份口径,中途改动会让前后不一致。
    // gemini 档只留 slimContract 一份契约：再叠一份紧凑契约会给出互相打架的
    // 字段口径（一份要 after 写原句、一份要 after 写 P 编号；一份说器官由插件补、
    // 一份说不要写器官），模型夹在中间只能瞎猜。实测第 0 楼因此被判「引句不锚定」重试。
    const compact = isGeminiTier(promptOptions.jailbreakTier) ? false : useCompactContract(promptOptions.jailbreakTier);
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
    const expectedWardrobeChoice = wardrobeChoiceRevision(message),
      expectedAppearancePolicy = appearancePolicyRevision();
    const wardrobeBaseline = new Map([...wardrobe].map(([name, entry]) => [name, JSON.stringify(entry)]));
    // 本楼的衣柜选择也要按主名归一：clothingBefore 只处理 floor 之前的楼层。
    applyWardrobeChoices(wardrobe, message, undefined, entriesBefore);
    // 当前这一楼自己的翻篇证据也要先算进去：clothingBefore 只逐楼处理「已经发生」
    // 的楼层，本楼的「第二天/出门」在账本下发前没被处理过，模型看到的就是上一楼
    // 的「掀衣露胸」，于是照着画一张她露着胸走过走廊的图。
    settleStaleUndress(wardrobe, rawSource);
    const wardrobeRevision = clothingRevision(context.chat, floor);
    const expectedStory = narrativeHash(rawSource);
    const savedWardrobe = readClothingFloor(message, wardrobeRevision);
    const slotWardrobe =
      slot && expectedWardrobeChoice !== (savedWardrobe?.manualChoiceRevision ?? '[]')
        ? new Map<string, import('./outfitTimeline').ClothingRecord>(
            JSON.parse(JSON.stringify([...wardrobe])),
          )
        : slot && savedWardrobe && savedWardrobe.frames[slot.seq]?.tag === slotRawTag
          ? new Map(savedWardrobe.frames[slot.seq].entries.map((e) => [e.name, e]))
          : slot && slotRawTag
            ? savedImageClothing(
                { ...parseImageTagContent(slotRawTag), position: '', sourceLine: 0, charOffset: 0 },
                wardrobe,
                entriesBefore,
              )
            : null;
    const outfitBlock = clothingBlock(slotWardrobe ?? wardrobe);
    const costumeRequest: CostumeRequest = { inherited: costumeBefore(context.chat, floor) };
    const channel = getTagGenChannel();
    // 当前实际请求的渠道。梯队换过模型后它指向新模型,契约文案要跟着变
    // (3.x 用严格版、4 系用宽松版,见 compactContract.ts)。
    let activeChannel = channel;
    /**
     * 组装一次请求历史。
     *
     * `lean` 是「上一次被截断」时的降载版:思考清单换成十行版、契约里略去长解释。
     * 用同一个函数而不是另存一份文案,是因为世界书/角色卡/记忆/账本这些上下文也都要
     * 跟着一起重取——只替换契约而留着旧上下文,等于两份口径打架。
     */
    const assemble = async (lean: boolean, flatten = false) => {
      const built = await buildAutoTagMessages(
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
        costumeRequest,
        anchorLedger,
        lean,
        shotLedger,
        // 破限词的口径必须与下面的紧缩契约同源(见 jailbreak.ts 的 geminiWantsExplicitWords):
        // `gemini`(自动)档在 4 系上要发宽松版,否则「档位文本禁器官词 + 契约允许器官词」自相矛盾。
        activeChannel?.model,
        previousFacts.filter((fact) => fact.confidence !== 'unknown'),
      );
      built.push({
        role: 'system',
        content:
          CLOTHING_PROTOCOL +
          '\n' +
          appearancePolicyBlock() +
          '\n用户套装的部件 ID 和款式不允许随意重选；style 允许有证据的穿脱，明确整套换装可退出；always 不接受任何自动服装变更。',
      });
      // gemini 档:把契约压成「只留 images + tag 白名单」的紧缩形态(见 compactContract.ts)。
      //
      // 位置与取舍都来自实测,别凭直觉改:
      // - 紧缩契约必须压在所有其它 system **之后**(实测的 8/8 就是「完整请求 + 末尾追加」)。
      // - 但 IDENTITY_PROTOCOL 必须**整条不发**:它 1106 个字符,正文就是「增加 identities:
      //   [{name,gender,…}]」——和紧缩契约里「不要输出 identities」正面打架。带着它,
      //   裸 3.8-flash 实测 0/6 全被拦;去掉之后同一份请求 4/6 过。模型没有理由在
      //   「必须写 identities」和「不许写 identities」之间挑前者再被截断。
      if (!compact) {
        built.push({
          role: 'system',
          content:
            IDENTITY_PROTOCOL + '\n已核实身份（旧绘图档案不是性别证据）：' + JSON.stringify(knownIdentities),
        });
      }
      if (compact) {
        // 3.x 系给严格版(连解剖词都不许写)、4 系给宽松版(允许 nude/breasts out 这类状态词)。
        // 一刀切用严格版会把 4-argon 压成 SFW —— 实测它本来对解剖词几乎不拦。
        built.push({ role: 'system', content: compactContractFor(promptOptions.jailbreakTier, activeChannel?.model) });
      }
      return flatten ? flattenToSystem(built) : built;
    };
    const messages = await assemble(false);
    costumeRequest.story = source;
    // 只打用户选的那一个模型,不建梯队、不再自动换名。
    //
    // 旧版在这里建一条 `fallbackModels` 梯队,失败后逐级替换 model 重发。它解决过问题
    // (2026-11 之前 agy 池确实存在「裸模型被拦、抗截断变体放行」),但代价是:
    //   ① 用户手选的模型被悄悄换掉,选渠道与选模型失去意义;
    //   ② 成功/失败无法归因到底是谁过的,「破限到底行不行」永远说不清;
    //   ③ 自建站上的备用名大多是 404/400,等于白花重试额度(实测 odyfree 整站如此)。
    // 真正的修法是把**这一份请求**改到能过(见下面 leanOnce / blockedOnce / retryNote),
    // 而不是换名字赌运气。梯队只在用户完全没选模型时用作兜底(不会发生:UI 必填)。
    const modelLadder: string[] = [];
    let ladderStep = 0;
    const identitySources: IdentitySources = {
      story: source,
      card: messages
        .filter((m) => m.role === 'system' && /^【(?:角色设定|主角设定)/.test(m.content))
        .map((m) => m.content)
        .join('\n'),
      worldbook: messages
        .filter((m) => m.role === 'system' && m.content.startsWith('【世界设定'))
        .map((m) => m.content)
        .join('\n'),
      book: memory?.roles ?? [],
    };
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
    // 空计划只纠一次：这一楼有没有可画画面本质上是模型判断，硬纠 5 次换不来更好的结果，
    // 只会把「这一段没画面」拖成 600 秒（第 1 楼实测 5 次 / 667 秒仍 0 张）。
    let emptyPlanRetried = false;
    let baseNlRetried = false;
    let localRepairDone = false;
    // 局部修复只做一次：把被挡掉的那一格单独重写，已经合格的图不动。
    // 上一次 attempt 是否被判为「被截断」:是则后续重试改发降载版历史(精简思考清单 +
    // 略去长解释的契约)。降载必须换掉整份历史而不是只追加一句「写短点」——思考清单
    // 本身就是思考长度的来源,只在末尾恳求,模型照旧逐条自证。
    let leanOnce = false;
    // 上一次是否被渠道侧拦过:是则后续重试改发「兼容版」提示词(露骨示例词换成中性占位),
    // 并只保留最小结构要求。过滤发生在模型看到请求之前,加授权话术没用,只能把请求改淡。
    let blockedOnce = false;
    // 「换模型再试」不占用户设的重试次数:retryCount 是「同一份请求再花一次钱」的上限,
    // 而「被拦」之后原样重发同一个模型只是白花——换梯队里下一个模型是一次**不同**的尝试,
    // 每换一级补一次机会。总请求数上限仍是 retries+1+梯队长度,不会失控。
    let granted = retries + 1;
    // 上游网关抖动(502 / Unexpected end of JSON input)的额外重发次数上限。
    // 这类失败重发同一份请求就能过,不该消耗用户设的重试额度,也不该换掉手选的好模型;
    // 但也不能无限重发,封顶 2 次(实测连续 3 次抖动基本等于渠道真的挂了)。
    let jitterRetries = 0;
    // 这条渠道的上游号池有没有可用凭据。一次就够:凭据是账号侧的事实,重发不会变,
    // 换模型名也不会变(实测 agy 整站 16 个模型名全回同一句 agy_credential_missing)。
    // 一旦命中就直接结束循环,把「换渠道」这句话交给用户,而不是白烧 5 次重试。
    let credentialDead = false;
    const nlOriginal = new Map<string, { nl: string; characters: Array<{ name: string; nl: string }> }>();
    let restoredNames: string[] = [];
    // 结局记录要用的两笔计数:发了几次、丢了几张。都在循环外累计,
    // 因为写盘那一步已经出了循环,循环里的 attempt 变量拿不到。
    let attemptsUsed = 0;
    let droppedImages = 0;
    for (let attempt = 0; attempt < granted && !plan; attempt++) {
      attemptsUsed = attempt + 1;
      if (controller.signal.aborted) {
        processed.delete(identity);
        return;
      }
      if (attempt > 0 && cachedFacts.length) retryNote = [retryNote, factsBlock(cachedFacts)].filter(Boolean).join('\n\n');
      // 被拦过一次之后改发「user 只留一句指令」的布局:实测把正文与账本挪进 system 后
      // 同一份内容从 0/4 翻成 4/4。原样重发只会再被拦一次,还多花一次钱。
      const baseMessages =
        blockedOnce ? await assemble(leanOnce, true) : leanOnce ? await assemble(true) : messages;
      const attempted: ChatMsg[] = retryNote
        ? [...(blockedOnce ? neutralizeMessages(baseMessages) : baseMessages), { role: 'system', content: retryNote }]
        : blockedOnce
          ? neutralizeMessages(baseMessages)
          : baseMessages;
      // gemini 档:这条通道会在**提交阶段**拦「连着的露骨词」(blockReason: PROHIBITED_CONTENT),
      // 模型连正文都没看到。所以整份请求先过一次屏蔽器。
      // story 要留着——模型看到的引文是屏蔽后的字面,校验时得靠它还原成原文,
      // 否则服装账本的 evidence 永远匹配不上,换装又会静默失效。
      const shielded = isGeminiTier(promptOptions.jailbreakTier) ? shieldMessages(attempted) : null;
      const attemptMessages: ChatMsg[] = shielded ? shielded.messages : attempted;
      const story: Shielded | null = shielded?.story ?? null;
      try {
        // parsed 用对象壳装着:validate 闭包写入,await 之后读取——请求成功 + 验收通过才非空。
        // (直接 let 会被 TS 收窄成 null:闭包内的赋值控制流分析看不见。)
        const parsed: { plan: ImagePlan | null } = { plan: null };
        const validate = async (raw: string, meta?: { finishReason?: string | null }) => {
          // 渠道拦截先判:它和「截断」的表现很像(空、半截、一段客气话),但修法相反——
          // 截断要压输出,拦截要把请求本身改淡。判错方向会让重试打在错的地方。
          const block = diagnoseBlock(raw, meta?.finishReason);
          if (block.blocked) {
            blockedOnce = true;
            retryNote = blockRetryNote(isGeminiTier(promptOptions.jailbreakTier));
            throw new Error(`被渠道内容过滤拦下(${block.reason})`);
          }
          const verdict = diagnoseTruncation(raw, meta?.finishReason);
          // gemini 档:模型只看得见屏蔽后的正文,它引用的 after/evidence 也是屏蔽后的字面。
          // 先把这些引用映射回原文,后续的逐字定位、服装证据比对、scene.quote 才有意义。
          let text = story ? repairQuotes(raw, story) : raw;
          let salvaged = 0;
          if (verdict.truncated) {
            const repaired = salvageJsonObject(text);
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
              // 同时置 leanOnce:下一次改发精简契约与精简思考清单,把思考本身压下来。
              leanOnce = true;
              retryNote = truncationRetryNote(Math.max(1, promptOptions.minImages));
              throw new Error(`输出被截断(${verdict.reason})`);
            }
            console.warn(`[墨影] 第 ${floor} 楼输出被截断(${verdict.reason}),已救回可闭合的部分继续`);
          }
          const candidate = parseImagePlan(
            text,
            preparedTarget.segments,
            salvaged ? 0 : promptOptions.minImages,
            promptOptions.maxImages,
            source,
          );
          // 称呼归并与外貌兜底:模型若在 characters[].name 或 changes[].name 里写了已建档角色的
          // 别称/尊称/简称(如把「风千华」写成「风阿姨」「千华」),先唯一归并回档案主名,
          // 并在因换称呼漏抄固定外貌时把档案核心外貌字段补进 character.tag。
          let candidateFacts = mergeIdentityFacts([
            ...knownIdentities,
            ...assessIdentityClaims(candidate.identities ?? [], identitySources, knownIdentities),
          ]);
          // 模型的性别证据常被改写成非逐字引用，assessIdentityClaims 判 unknown 后
          // changes.new 被丢掉，女主永远进不了角色库，同楼每张图只能各自现编外貌。
          // 这里用正文原句再做一层保守取证：名字所在句只出现「她」等女性指代即入档。
          if (!slot) {
            const tagsByName = new Map<string, string>();
            for (const image of candidate.images)
              for (const character of image.characters)
                tagsByName.set(
                  character.name,
                  `${tagsByName.get(character.name) ?? ''} ${character.tag ?? ''} ${character.nl ?? ''}`,
                );
            const names = new Set<string>([
              ...candidate.changes.filter((change) => change.field === 'new').map((c) => c.name),
              ...tagsByName.keys(),
            ]);
            const recovered: IdentityFact[] = [];
            for (const name of names) {
              if (!name || isMaleIdentity(name, candidateFacts)) continue;
              if (identityFactFor(name, candidateFacts)?.gender === 'female') continue;
              // 模型自己把角色块写成男性描述时不再追加女性事实，避免把男配拉进库。
              const tags = tagsByName.get(name) ?? '';
              if (/\b(?:\d+\s*boys?|boys?|man|men|male)\b/i.test(tags) && !/\b(?:girls?|women?|female)\b/i.test(tags))
                continue;
              const guess = femaleStoryFact(name, source);
              if (guess) recovered.push(guess);
            }
            if (recovered.length) candidateFacts = mergeIdentityFacts([...candidateFacts, ...recovered]);
          }
          for (const change of candidate.changes)
            if (change.field === 'new' && !candidate.identities?.some((c) => c.name === change.name)) {
              (candidate.identities ??= []).push({
                name: change.name,
                gender: 'unknown',
                heroine: false,
                source: 'story',
                evidence: '',
                reason: '未提供新角色身份审核依据',
              });
            }
          candidate.changes = candidate.changes.filter(
            (c) => c.field !== 'new' || mayCreateHeroine(c.name, candidateFacts),
          );
          // A confirmed named woman must not disappear merely because the LLM
          // supplied a character block but forgot changes.new.
          if (!slot)
            for (const image of candidate.images)
              for (const character of image.characters) {
                const fact = identityFactFor(character.name, candidateFacts);
                const name = fact?.name || character.name;
                if (
                  !mayCreateHeroine(name, candidateFacts) ||
                  entriesBefore.some((e) => e.name === name) ||
                  candidate.changes.some((c) => c.field === 'new' && c.name === name)
                )
                  continue;
                const fields = diversifyLook(
                  recoverProfileFields(character.tag),
                  entriesBefore,
                  source,
                ).fields;
                candidate.changes.push({
                  name,
                  field: 'new',
                  value: JSON.stringify(fields),
                  nl: Object.values(fields).filter(Boolean).join(', '),
                  reason: '已确认女性：从本次具名角色块补建遗漏档案',
                  position: image.position,
                  sourceLine: image.sourceLine,
                  charOffset: image.charOffset,
                });
              }
          if (!slot)
            for (const fact of candidateFacts) {
              if (
                !source.includes(fact.name) ||
                !mayCreateHeroine(fact.name, candidateFacts) ||
                entriesBefore.some((e) => e.name === fact.name) ||
                candidate.changes.some((c) => c.field === 'new' && c.name === fact.name)
              )
                continue;
              const position = preparedTarget.segments[0];
              if (!position) continue;
              const fields = diversifyLook(recoverProfileFields(), entriesBefore, source).fields;
              candidate.changes.push({
                name: fact.name,
                field: 'new',
                value: JSON.stringify(fields),
                nl: 'female',
                reason: '本节已确认具名女性首次出场；外貌资料待补全，不因未入选图片而漏档',
                position: position.id,
                sourceLine: position.sourceLine,
                charOffset: position.charOffset,
              });
            }
          const candidateEntries = eligibleIdentityEntries(entriesBefore, candidateFacts);
          for (const image of candidate.images)
            for (const character of image.characters) {
              const fact = identityFactFor(character.name, candidateFacts);
              if (fact && fact.gender !== 'male' && candidateEntries.some((e) => e.name === fact.name))
                character.name = fact.name;
            }
          normalizePlanCharacters(
            candidate.images,
            candidateEntries,
            new Set(
              candidateFacts
                .filter((f) => f.gender === 'male')
                .flatMap((f) => [f.name, ...(f.aliases ?? [])]),
            ),
          );
          if (entriesBefore.length) {
            const existingNames = new Set(entriesBefore.map((e) => e.name.trim()));
            candidate.changes = candidate.changes.filter((change) => {
              const canonical = isMaleIdentity(change.name, candidateFacts)
                ? change.name
                : resolveCanonicalCharName(change.name, candidateEntries, candidateFacts);
              if (canonical !== change.name) {
                if (change.field === 'new' && existingNames.has(canonical)) return false;
                change.name = canonical;
              }
              return true;
            });
          }
          for (const change of candidate.outfitChanges ?? []) {
            if (!isMaleIdentity(change.name, candidateFacts))
              change.name = resolveCanonicalCharName(change.name, candidateEntries, candidateFacts);
          }
          // Clothing verification is per-event. It must never reject an otherwise
          // valid floor image plan or force repeated paid analysis of a random jump.
          // 单槽重写忽略本次 changes,不校验建档 nl —— 校验它会为一份会被丢弃的
          // changes 白白消耗重试次数。NAI 关了自然语言时协议不要 nl,也就不验。
          // gemini 档用紧缩契约时模型被明确要求不写 nl,这条校验必须同步放行 ——
          // 否则每次建档都会被自己的验收判失败,重试到次数用尽(实测过,会连报三轮)。
          if (
            !slot &&
            profile.naiCharPrompts &&
            profile.nl &&
            // 精简契约（gemini 档）里 changes 不带 nl —— 外貌只靠 tag 与档案字段，
            // 这条校验若照旧生效，每次建档都会被自己判失败，重试到次数用尽仍不落图。
            !isGeminiTier(promptOptions.jailbreakTier) &&
            candidate.changes.some((change) => change.field === 'new' && !change.nl?.trim())
          ) {
            throw new Error('NAI 4.5/V5 建档必须附带 nl 外貌描述');
          }
          // 空 images:协议上算正常返回,旧版直接放行,于是模型一句「没有值得插图的画面」
          // 就能让整楼不生、阅读器干等超时。这里在还有重试次数时把它当可纠错误,
          // 换一套口径逼它落到具体画面上;changes 非空(有建档要落)时不算空。
          // 只有当这一楼**确实有可画的画面**时，空 images 才算可纠错误。
          // 反例是第 1 楼：整段是李斌一个人在心里幻想，正文里没有任何女性在画面里，
          // 模型给空数组是对的；旧逻辑照样重试 5 次、耗掉 667 秒，最后还是 0 张。
          // 另一种空计划：模型写了事实表（她穿着什么、身体在哪），却没给任何画面。
          // 这不是「这一楼没画面」，而是它读懂了却没落到镜头上——事实里有 wear/body/action
          // 这类属于具体人物的条目时纠一次；只有 place 的事实（她不在场）不纠。
          const concreteFact = (candidate.facts ?? []).some(
            (fact) => fact.subject !== 'scene' && /^(?:wear|body|action)$/.test(fact.kind),
          );
          if (
            !slot &&
            attempt < retries &&
            !candidate.images.length &&
            !candidate.changes.length &&
            !candidate.identities?.length &&
            !emptyPlanRetried &&
            (isDrawWorthy(source) || concreteFact)
          ) {
            emptyPlanRetried = true;
            retryNote = EMPTY_PLAN_RETRY_NOTE;
            throw new Error('返回了空 images');
          }
          // 「这一楼没有值得画的瞬间」是正常结果，不再是失败：不再自己拼一张默认图。
          // 兜底图会替模型决定「这楼该有画面」，而它连 nl 都是空的——等于代码编剧情。
          // 该楼的 changes/outfitChanges 照常落盘，只是不落图。
          // Base nl 缺失:模型偶尔只写 tag 不写 nl(实测第 7/8 楼)。
          // nl 是「这一格的空间与瞬间」唯一载体,缺了就只剩一堆标签,
          // 画面靠概率拼。还有重试次数时纠一次，不要每楼都重跑。
          if (!slot && attempt < retries && !baseNlRetried && profile.nl) {
            const bare = candidate.images.filter((image) => !image.nl?.trim());
            if (bare.length) {
              baseNlRetried = true;
              retryNote = [
                '<retry_base_nl>',
                '上一次有图片的 Base nl 是空的。Base nl 是这张图「这一刻在发生什么」的唯一说明，不是可选字段。',
                '用一句完整英文补上：谁在做什么、在什么地方、光从哪来——不超过 20 词，句号结尾。',
                '不要复述 tag 里已经写过的人数、景别、服装名词。',
              ].join('\n');
              throw new Error('Base nl 缺失');
            }
          }
          // 引句锚定:after 必须是本楼正文里逐字存在的原句(纯 P 编号例外)。编出来的
          // 引句意味着画面也是编的(第 12 楼正文只有李斌在书房计划,模型却画了温岚坐
          // 沙发喝奶茶)。这是事实门槛，不再随重试次数失效：不锚定的那一张直接丢，
          // 其余照常落位；一张不剩就是「本楼无可画瞬间」，属正常结果，不补图。
          if (!slot) {
            const loose = unanchoredIndexes(candidate.images, preparedTarget.promptText);
            // 先把被挡掉的原图留一份：过滤之后就找不到它的 position / 定场信息了。
            const looseImages = loose.map((index) => candidate.images[index]).filter(Boolean);
            if (loose.length) {
              const dropped = looseImages.map((image) => image.afterQuote ?? '').filter(Boolean);
              candidate.images = candidate.images.filter((_, index) => !loose.includes(index));
              droppedImages += loose.length;
              console.warn(`[墨影] 丢弃 ${loose.length} 张引句不在正文里的图：${dropped.join(' / ')}`);
            }

            // 只重写被挡掉的那一格，已经合格的图不动：整楼重跑 10 分钟起，
            // 还会把本来对的几张一起重掷。这里一次、只带这一格的段落与错误。
            if (loose.length && candidate.images.length && !localRepairDone && activeChannel) {
              localRepairDone = true;
              for (const bad of looseImages) {

                const segment = bad ? preparedTarget.segments.find((item) => item.id === bad.position) : null;
                if (!segment) continue;
                try {
                  const raw = await requestCompletion(
                    activeChannel,
                    repairMessages({
                      segment: segment.text,
                      position: segment.id,
                      badQuote: bad.afterQuote,
                      error: 'after 不是原文里逐字存在的句子（这一格因此被挡掉）。',
                      frameAction: bad.frameAction,
                      focus: bad.focus,
                    }),
                    { signal: controller.signal, source: '局部修复这一格' },
                  );
                  const retryPlan = parseImagePlan(raw, [segment], 0, 1, source);
                  const fixed = retryPlan.images[0];
                  if (fixed && !unanchoredIndexes([fixed], segment.text).length) {
                    candidate.images.push({ ...fixed, position: segment.id });
                    console.warn(`[墨影] 局部修复成功：${segment.id}`);
                  }
                } catch (error) {
                  console.warn('[墨影] 局部修复失败，按原计划丢弃这一格', error);
                }
              }
            }
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
          //
          // 不再受重试次数限制:下游的处理是**直接改写 tag**(applySuggestedDistance),
          // 不重新请求模型,也不占重试预算。旧版把它包在 attempt < retries 里,
          // 用户把重试次数设成 0 时这条修正就整个失效,废片照出。
          {
            const segmentText = new Map(preparedTarget.segments.map((item) => [item.id, item.text]));
            const prevSegText = (pos: string): string => {
              const m = /^P(\d+)$/i.exec(pos.trim());
              if (!m) return '';
              const n = Number.parseInt(m[1], 10);
              return n > 1 ? (segmentText.get(`P${n - 1}`) ?? '') : '';
            };
            const seenGap = new Set<string>();
            const farGaps = candidate.images
              .map((image) => {
                const gap = diagnoseDistance(
                  segmentText.get(image.position) ?? '',
                  image.tag,
                  (image.characters ?? []).map((character) => character.tag),
                  prevSegText(image.position),
                );
                if (!gap) return null;
                const key = `${image.position}\u0000${gap.suggest}`;
                if (seenGap.has(key)) return null;
                seenGap.add(key);
                return { position: image.position, ...gap };
              })
              .filter((gap): gap is NonNullable<typeof gap> => !!gap);
            // 景别过远不再重试：直接按建议改写这一张的取景。
            // 重试要再付一次分析费，而且模型下次未必改对；改 tag 是确定性的。
            if (farGaps.length) {
              for (const image of candidate.images) {
                const text = segmentText.get(image.position) ?? '';
                const gap = diagnoseDistance(
                  text,
                  image.tag,
                  (image.characters ?? []).map((character) => character.tag),
                  prevSegText(image.position),
                );
                if (!gap) continue;
                image.tag = repairShotDefaults(applySuggestedDistance(image.tag, gap.suggest));
                diagnostic('distance:auto-fix', { floor, position: image.position, to: gap.suggest });
              }
            }
          }
          // 画面事实闭环:人数与道具落点。
          // 「两个男的一个女的」画成一个人长双头肉棒、「毛笔在阴部写字」只画毛笔不画落点,
          // 都是可判定的确定错,而且这类错图一眼废。排在构图缺项之前(缺项只是画面平)。
          // 单槽重写不改画面事实,跳过。
          if (!slot && attempt < retries) {
            const segmentText = new Map(preparedTarget.segments.map((item) => [item.id, item.text]));
            const castGaps: CastGap[] = [];
            const seenCast = new Set<string>();
            // 女性名单用于判定「画面里到底有没有女的」：库性别优先，正文指代兜底。
            const femaleNames = femaleCastNames(
              entriesBefore,
              knownIdentities,
              source,
              candidate.images.flatMap((image) => (image.characters ?? []).map((c) => c.name)),
            );
            for (const image of candidate.images) {
              const text = segmentText.get(image.position) ?? '';
              const aliasPresent = findCharAliases(entriesBefore, text).map((hit) => hit.name);
              const present = [
                ...new Set([
                  ...[...entriesBefore].map((entry) => entry.name).filter((name) => text.includes(name)),
                  ...aliasPresent,
                ]),
              ];
              const charTagList = (image.characters ?? []).map((character) => character.tag);
              const found = [
                ...diagnoseCast(text, image.tag, image.characters ?? [], present, profile.naiCharPrompts, femaleNames),
                ...diagnosePropTarget(text, image.tag, charTagList),
                ...diagnoseContact(text, image.tag, charTagList),
                ...diagnoseFemaleSubject(text, image, femaleNames),
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
              throw new Error(`画面事实不符(${castGaps.map((gap) => gap.kind).join('、')})`);
            }
          }
          // 服装账本:衣服明明没变,穿脱程度却跳了(半脱→全裸、已脱→又穿回),
          // 或者正文没写换装,整套衣服被换成另一套。
          // 这条最伤连续性,而且模型自己看不出来——它没有上一层的画面。
          // 构图缺项:只在还有重试次数时纠一次。没次数了就放行——
          // 交一张景别平庸的图,好过因为「没写机位」整楼不生。
          if (attempt < retries) {
            // 先补默认构图词再判缺项：缺景别/机位属于「画面会平」，不该烧掉重试次数。
            for (const image of candidate.images)
              image.tag = repairShotDefaults(image.tag, (image.characters ?? []).map((character) => character.tag));
            const gaps = [
              ...new Set(
                candidate.images
                  .map((image) =>
                    diagnoseShot(
                      image.tag,
                      (image.characters ?? []).map((character) => character.tag),
                    ),
                  )
                  .filter((diag) => !diag.softOnly)
                  .flatMap((diag) => diag.missing),
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
                  `构图雷同(${monoGaps.map((g) => `${g.positions.join('/')} 均为 ${g.signature}`).join('、')})`,
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
        if (activeChannel) {
          await requestCompletion(activeChannel, attemptMessages, {
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
        // 出口清洗会改 nl（去复述、去 tag 串），先留一份原文，
        // 诊断里才能分清「模型写得差」与「被后处理改坏」。
        if (plan)
          for (const image of plan.images)
            nlOriginal.set(image.position, {
              nl: image.nl ?? '',
              characters: (image.characters ?? []).map((character) => ({ name: character.name, nl: character.nl ?? '' })),
            });
        // 跨场景时丢掉继承来的露点事实：昨天敞着怀，不代表今天出门还敞着。
        // 只丢继承的，正文真写了（explicit）照留。
        if (plan) {
          const before = plan.facts?.length ?? 0;
          const exposed = (name: string) => {
            const record = wardrobe.get(name);
            return !!record?.pieces.some(
              (piece) =>
                piece.state?.exposure === 'bare' ||
                piece.state?.exposure === 'partial' ||
                ['lifted', 'pulled_aside'].includes(String(piece.state?.arrangement ?? '')),
            );
          };
          // 归属闸门放最前：模型常把别人的衣物记到女主身上（「小姨子的内裤」），
          // 这类事实一旦进账本，下一楼就会把她画成全裸。
          const ownedFacts = gateFactOwnership(plan.facts ?? [], [
            ...[...entriesBefore.keys()].map(String),
            ...(plan.facts ?? []).map((fact) => fact.subject).filter((name) => name && name !== 'scene'),
          ]);
          if (ownedFacts.length < (plan.facts?.length ?? 0))
            console.warn(`[墨影] 丢掉 ${(plan.facts?.length ?? 0) - ownedFacts.length} 条归属不是她的事实`);
          plan.facts = factsBackedByLedger(
            factsAcrossSceneBreak(ownedFacts, storyLooksLikeNewScene(source)),
            exposed,
          );
          if ((plan.facts.length ?? 0) < before) {
            console.warn(`[墨影] 跨场景丢掉 ${before - plan.facts.length} 条继承的露点事实`);
            for (const image of plan.images)
              for (const character of image.characters ?? []) {
                const cleaned = stripExposureTokens(character.tag);
                if (cleaned !== character.tag) {
                  console.warn(`[墨影] ${image.position} ${character.name} 的 tag 去掉了跨场景继承的露点词`);
                  character.tag = cleaned;
                  const prose = dropExposureClaims(character.nl);
                  if (prose !== character.nl) character.nl = prose;
                }
              }
          }
        }
        // 事实表只做减法：这楼有「她穿着某件衣服」的明确事实、又没有裸露事实时，
        // 把她 tag 里的裸体词摘掉。新增内容仍归模型，这里不改写别的字段。
        if (plan) {
          for (const image of plan.images) {
            const repaired = repairByFacts(image, plan.facts ?? []);
            if (repaired.length)
              console.warn(`[墨影] ${image.position} 事实表否定了裸体断言：${repaired.join('；')}`);
          }
        }
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
          retryNote = blockRetryNote(isGeminiTier(promptOptions.jailbreakTier));
        }
        // 换模型这一步已经删掉(见上面 modelLadder 的注释)。模型名不存在/400 现在由
        // 失败提示直接告诉用户,不再自动跳到别的名字试。
        // 降载与改淡(leanOnce / blockedOnce / retryNote)仍然生效:下一次用**同一个**
        // 渠道与模型,发一份更短、更淡、格式更窄的请求。
        const timedOut = looksLikeTimeout(lastError);
        // 凭据失效:渠道号池空了。这是**账号侧**的事实,不是这一次请求的问题——
        // 实测 agy 号池挂掉时,同一个 key 对 16 个模型名一律回 429
        // `no valid AGY credential available` / `agy_credential_missing`,
        // 而 429 本来落在抖动判据里,于是插件把它当限流原样重发,白耗 5 次
        // (每次约 30 秒),用户看到的是「卡很久然后全失败」。
        // 这里一次就停,并把原因写进失败提示:能救的只有换渠道,不是换模型名。
        if (looksLikeCredentialFailure(lastError)) {
          credentialDead = true;
          console.warn('[墨影] 渠道上游没有可用凭据，停止重试', { model: activeChannel?.model ?? channel?.model });
          break;
        }
        // 上游抖动(502 / `Unexpected end of JSON input` / 网关炸了):同一份请求重发就过。
        // 这里只补一次机会,让这次抖动不花用户设的重试额度(实测这类抖动重发成功率很高)。
        const jitter = looksLikeUpstreamJitter(lastError) && jitterRetries < 2;
        if (jitter) {
          jitterRetries += 1;
          granted += 1;
          console.info('[墨影] 上游网关抖动，原样重发同一级模型', { model: activeChannel?.model ?? channel?.model });
          // 断流/502 往往发生在网关刚切换号的瞬间，立刻再撞大概率还是同一条坏连接。
          // 退避 1.5s、3s 再发，实测能把「连撞三次全失败」变成「第二次就过」。
          await new Promise((resolve) => setTimeout(resolve, 1500 * jitterRetries));
        }
        /**
         * 不在重试里换模型、也不换渠道。
         *
         * 用户选的是哪个渠道的哪个模型,就只打那一个 —— 自动换名会把「用户手选的最优档」
         * 换成同名兄弟、把成功归因搞乱,还会让「我选渠道和模型还有什么意义」这个问题
         * 无解。破限该做的是**把这一份请求改到能过**,而不是赌另一个名字。
         *
         * 所以这里只做两件事:
         *   ① 抖动 → 原样重发(上面);
         *   ② 被拦/超时/输出不守协议 → 改请求本身(leanOnce / blockedOnce / retryNote
         *      已在上面按错误类型设好),下一次用同一渠道同一模型重发。
         * 换模型这件事留给用户:失败提示里会明确写出该换什么。
         */
        void timedOut;
        void modelLadder;
        void ladderStep;
        console.warn(`[墨影] 第 ${floor} 楼第 ${attempt + 1}/${granted} 次生成 tag 失败`, error);
      }
    }
    if (!plan) {
      // 重试耗尽:允许同一正文在后续重新渲染后再试
      processed.delete(identity);
      // 超时与「渠道持续不可用」各给一句人话:用户看到的是一句上游回执,
      // 不知道该干什么。实测根因几乎总是「这个模型名/这条渠道撑不住本插件的长请求」。
      const hint = credentialDead
        ? `：渠道「${channel?.name ?? '未知'}」的上游号池没有可用凭据（agy_credential_missing / access_terminated / 当前无可用模型）。重发与换模型名都不会好，只能换一条渠道，或等这条渠道补号。`
        : looksLikeTimeout(lastError)
          ? '：该模型承载不了本插件的长请求，请在渠道里换一个变体（实测名字里带「防外审」的最稳）'
          : looksLikeUpstreamJitter(lastError)
            ? `：渠道「${channel?.name ?? '未知'}」连续回网关错误 —— 这不是破限或截断的问题，是这条渠道/这个模型现在不可用。请用「say hi」单独试一次该渠道；若非流式失败而流式能过，把渠道的「流式」打开。`
            : '';
      if (credentialDead) {
        toastr.error(
          `${lastError}${hint}`,
          '墨影自动 tag 失败',
          { timeOut: 20000, extendedTimeOut: 10000 },
        );
      } else {
        toastr.error(
          `${lastError}${hint}${retries > 0 ? `(已自动重试 ${retries} 次)` : ''}`,
          '墨影自动 tag 失败',
        );
      }
      // 失败也要落一笔结局：界面据此显示「这楼没画面」而不是「失败」，
      // 用户才不会把正常的空镜头当成故障去反复重试。
      const verdict = classifyFailure(lastError || 'tag 分析未通过校验');
      await recordOutcome(floor, swipeId ?? null, chatId, {
        v: 1,
        status: verdict.status,
        reason: verdict.reason,
        images: 0,
        dropped: droppedImages,
        attempts: attemptsUsed,
        at: Date.now(),
      });
      if (opts.headless) throw new Error(lastError || 'tag 分析未通过校验');
      return;
    }

    // 单槽重写不落 changes:首次全量分析已为整楼建过档,这里再应用一次只会产生
    // 重复的建档/变更记录;库文本已含本楼增量(见上面 entriesBefore),AI 照抄即可。
    const assessedIdentities = assessIdentityClaims(plan.identities ?? [], identitySources, knownIdentities);
    const planIdentities = mergeIdentityFacts([...knownIdentities, ...assessedIdentities]);
    const safeEntries = eligibleIdentityEntries(entriesBefore, planIdentities);
    const appearanceChangeNotes: string[] = [];
    const planOps = slot ? [] : planChangeOps(plan, source, appearanceChangeNotes, safeEntries);
    // 锁定角色(全局库)不接受 AI changes:丢弃,不写入楼层、不参与 @替换。
    // 重放侧 applyCharTagOps 也会按锁定名再拦一次(旧消息里可能已存这类 ops)。
    const effectiveOps = lockedNames.size
      ? planOps.filter((item) => !lockedNames.has(item.op.name))
      : planOps;
    // 同人角色保护:角色库只填了 fandom、hair/eyes/skin/body 全空时,长相由同人 tag 决定。
    // 用户把那几个字段清空是刻意为之,AI 从正文抄回的发色瞳色写进去会和同人 tag 打架。
    const fandomGuarded = new Set(
      anchors.entries
        .filter(
          (entry) =>
            entry.fields.fandom.trim() &&
            !entry.fields.hair.trim() &&
            !entry.fields.eyes.trim() &&
            !entry.fields.skin.trim() &&
            !entry.fields.body.trim(),
        )
        .map((entry) => entry.name),
    );
    const guardedOps = fandomGuarded.size
      ? effectiveOps.filter((item) => {
          const op = item.op;
          if (op.kind !== 'set') return true;
          if (FANDOM_GUARD_FIELDS.has(op.field)) return !fandomGuarded.has(op.name);
          return true;
        })
      : effectiveOps;
    // 男性不建档:同上,规则之外再兜一次,把 sex 明确是男性的 new 直接丢掉。
    const maleGuarded = guardedOps.filter((item) => {
      const op = item.op;
      if (isMaleIdentity(op.name, planIdentities)) {
        appearanceChangeNotes.push(`${op.name}: 男性身份已确认，不自动建档或更新女主外貌`);
        return false;
      }
      if (op.kind !== 'new') return true;
      const accepted = mayCreateHeroine(op.name, planIdentities) && !MALE_SEX_RE.test(op.fields.sex.trim());
      if (!accepted)
        appearanceChangeNotes.push(
          `${op.name}: 暂不自动入库，需要可验证的女性身份，且不是无名路人；本张仍可正常出镜`,
        );
      if (accepted) op.fields.sex = '1girl';
      return accepted;
    });
    // 同一楼里模型自己报的几个 new 之间也要岔开形象：planChangeOps 只拿库当参照，
    // 本楼新建的人谁都还没进库，于是同一楼两三个新女主常常是同一头黑发同一双蓝眼。
    // 只岔空着的与撞车的特征，正文写过的词不动（口径同 lookDiversity）。
    if (!slot) {
      const fresh = maleGuarded
        .map((item) => item.op)
        .filter((op): op is CharTagNewOp => op.kind === 'new')
        .map((op) => ({ name: op.name, fields: op.fields, op }));
      diversifyNewOps(fresh, safeEntries, source, appearanceChangeNotes);
      for (const item of fresh) item.op.fields = item.fields;
    }
    // Fill only absent face dimensions on new original profiles, then persist them.
    // Existing appearances and manual fandom choices are never rerolled here.
    const faceOptions = [
      ['tsurime', 'thin eyebrows', 'oval face'],
      ['tareme', 'thick eyebrows', 'round face'],
      ['narrow eyes', 'thin eyebrows', 'angular face'],
      ['tsurime', 'thick eyebrows', 'round face'],
      ['tareme', 'thin eyebrows', 'oval face'],
      ['narrow eyes', 'thick eyebrows', 'oval face'],
    ];
    const usedFaces = new Set(safeEntries.map((e) => e.fields.extra));
    for (const item of maleGuarded) {
      const op = item.op;
      if (op.kind !== 'new' || op.fields.fandom) continue;
      let index = [...op.name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % faceOptions.length;
      for (let n = 0; n < faceOptions.length && usedFaces.has(faceOptions[index].join(', ')); n++)
        index = (index + 1) % faceOptions.length;
      op.fields.extra = op.fields.extra.replace(
        /\b(?:beautiful|gorgeous|perfect|pretty|detailed) face\b/gi,
        '',
      );
      const parts = op.fields.extra
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const all = [op.fields.eyes, op.fields.extra].join(', ');
      const patterns = [
        /tsurime|tareme|narrow eyes|wide eyes|eye shape|almond/i,
        /eyebrows/i,
        /face|jaw|chin|cheek/i,
      ];
      faceOptions[index].forEach((tag, i) => {
        if (!patterns[i].test(all)) parts.push(tag);
      });
      op.fields.extra = [...new Set(parts)].join(', ');
      usedFaces.add(op.fields.extra);
    }
    const floorOps = maleGuarded.map((item) => item.op);
    const previousDelta = readCharTagFloorDelta(message);

    plan.images.sort((a, b) => a.sourceLine - b.sourceLine || a.charOffset - b.charOffset);
    if (!slot) {
      // 女性主体兜底:模型偶尔会交只有男主/纯背景的图。这一段里能点名到女性就补进
      // characters;实在没有女性的图直接丢掉——没有女主的插图对用户没有价值。
      const guard = ensureFemaleSubjects(
        plan.images,
        preparedTarget.segments,
        safeEntries,
        planIdentities,
        source,
      );
      if (guard.attached.length) diagnostic('female-cast:attached', { floor, notes: guard.attached });
      if (guard.dropped.length) {
        plan.images = guard.images;
        console.warn('[墨影] 跳过没有女性主体的图片:', guard.dropped.join('；'));
        toastr.warning(`已跳过 ${guard.dropped.length} 张没有女性角色的图`, '墨影');
      }
      // 出图即建档：画面里出现的女角色本楼就要有一条库档案，哪怕这一刻还没有
      // 名字（先建「无名女子N」占位，后面认出真名再 rename），哪怕特征只有一半。
      // 这样同楼后续图片和以后楼层都有同一份外貌可锁，而不是模型每张现编。
      const profiles = ensureImageProfiles(plan.images, safeEntries, planIdentities, floor, source, {
        locked: lockedNames,
      });
      for (const item of profiles.items) {
        maleGuarded.push(item);
        floorOps.push(item.op);
      }
      if (profiles.notes.length) {
        appearanceChangeNotes.push(...profiles.notes);
        diagnostic('profiles:auto', { floor, notes: profiles.notes });
      }
      if (profiles.aliases.length) {
        try {
          const names = safeEntries.map((entry) => entry.name);
          for (const [canonical, alias] of profiles.aliases) {
            const current = characterAliases(canonical, planIdentities);
            if (current.includes(alias)) continue;
            saveCharacterAliases(canonical, [...current, alias].join('、'), names);
          }
        } catch (error) {
          console.warn('[墨影] 记录角色别名失败', error);
        }
      }
    }
    const activeEntries = applyCharTagOps(safeEntries, floorOps, floor, lockedNames);
    const costumeNotes: string[] = [];
    const costume =
      slot && savedWardrobe?.costume
        ? savedWardrobe.costume
        : resolveCostumeFloor(plan.costumeContexts, costumeRequest, preparedTarget.segments, costumeNotes);
    for (const change of plan.outfitChanges ?? [])
      if (change.operation === 'init' && !change.evidence) {
        change.evidence = explicitCostumeEvidence(
          change.name,
          change.pieces.map((p) => p.design).join(', '),
          costumeAt(costume, change.sourceLine, change.charOffset),
          source,
          change.sourceLine,
          change.charOffset,
        );
      }
    // 模型只写 facts：服装变更由事实翻译而来，与人工干预走同一条校验管线。
    // 模型自己的 outfitChanges 不再写账本（两条自由通道正是「谁写进去的」追不出来的原因）。
    const factFacts = plan.facts ?? [];
    const inheritedFacts = slot ? [] : inheritWearFacts(factFacts, wardrobe);
    if (inheritedFacts.length) plan.facts = [...factFacts, ...inheritedFacts];
    // 模型这一楼只写了场景/动作、没写穿着时，用正文里点名的衣物补一条事实：
    // 不补，账本只能退回「从 tag 反推」，而 tag 是模型随手写的短词（white shirt），
    // 白色、短袖这些从正文能读出来的属性就永久丢了。
    if (!slot) {
      const described: string[] = storyGarments(source).slice(0, 6);
      // 覆盖判据按「衣物类别」而不是按人：她上一楼的胸罩/内裤是继承来的，
      // 这一楼正文明明写了白衬衣与牛仔短裤，却被「这个人已经有 wear 事实」挡掉，
      // 账本里就只剩内衣——正是「她只穿内衣站在楼梯口」的来源。
      const coveredKind = (name: string) => {
        const kinds = new Set(
          (plan.facts ?? [])
            .filter((f) => f.kind === 'wear' && f.subject === name && f.confidence !== 'inherited')
            .map((f) => garmentKind(f.value)),
        );
        return kinds;
      };
      // 只补给画面里的女性：男主的西装外套不是她的，补进去等于把别人的衣服记到她账上。
      const female = new Set<string>();
      for (const image of plan.images)
        for (const character of image.characters)
          if (!/\b1boy\b|faceless male/i.test(character.tag)) female.add(character.name);
      const names = [...female];
      if (described.length && names.length)
        plan.facts = [
          ...(plan.facts ?? []),
          ...names.flatMap((name) => {
            const kinds = coveredKind(name);
            return described
              .filter((design) => !kinds.has(garmentKind(design)))
              .map((design) => ({
                subject: name,
                kind: 'wear' as const,
                value: design,
                evidence: '（本楼正文里写到的穿着）',
                confidence: 'explicit' as const,
              }));
          }),
        ];
    }
    // 跨场景恢复（第二包）：跨天/换地点时，人不会光着出门。这里把「最近一次完整穿搭」
    // 变成显式事实，和别的 wear 事实走同一条写入口——不直接改账本，也不按整楼关键词
    // 给所有人无差别复位（那会把「她正被撩着」也一起洗掉）。
    if (!slot && storyLooksLikeNewScene(source)) {
      const restored = restoreOutfitFacts(wardrobe, '跨场景：按最近一次完整穿搭复原');
      if (restored.restored.length) {
        plan.facts = [...(plan.facts ?? []), ...restored.facts];
        restoredNames = [...restored.restored];
        console.warn(`[墨影] 跨场景复原 ${restored.restored.length} 人：${restored.restored.join('、')}`);
      }
    }
    const modelClothingChanges = slot ? [] : factsToClothingChanges(plan.facts ?? [], preparedTarget.segments, source);
    if (!slot && plan.outfitChanges?.length)
      console.warn(`[墨影] 忽略模型自报的 ${plan.outfitChanges.length} 条服装变更（服装只从 facts 进账本）`);
    const accepted = acceptClothingChanges(
      slot
        ? []
        : [],
      source,
      wardrobe,
      activeEntries,
    );
    // facts 走自己的校验（归属闸门 + 人名白名单 + 状态白名单 + 件名归一），
    // 不再过 acceptClothingChanges：那套闸门要求「动作动词 + 可定位原文」，而事实是
    // 「她穿着白衬衫」这种陈述句，每一条都会被判「穿脱动作没落在她身上」再拒掉，
    // 账本就只能退回从 tag 反推（design 退化成 white shirt、location 变成 unknown）。
    // 模型自报的 outfitChanges 已经在上面被整条忽略，没有第二条自由通道。
    if (modelClothingChanges.length) {
      const appliedFacts = applyFactClothing(wardrobe, modelClothingChanges);
      if (appliedFacts.length)
        console.warn(`[墨影] 账本按事实更新 ${appliedFacts.length} 件：${appliedFacts.slice(0, 6).join('、')}`);
    }
    // 用这一楼真正要画的 tag 校准账本：facts 会漏（她穿白衬衣没写进 facts）、
    // 也会错（把别人的内裤写成她脱下）。tag 是画面事实，两者不一致时以 tag 为准——
    // 否则会出现「tag 穿着衬衣、账本说她一丝不挂，下一楼沿用裸奔」。
    // 事实表是账本的上游证据之一：模型在 facts 里明确写了「她穿着白衬衫」时，
    // 账本里记着脱下的同一件衣服就该恢复穿着——explicit 的事实高于继承来的状态。
    if (!slot && plan.facts?.length)
      for (const line of applyExplicitFacts(wardrobe, plan.facts))
        console.warn(`[墨影] 事实表把账本改回穿着：${line}`);

    const scope = `${chatId}|${floor}|${swipeId ?? 0}|${expectedStory}`;
    if (!slot) {
      // 正文自己点名了换装（「换上了睡衣」「只剩一件白色泳衣」「穿着黑吊带」）时，
      // 不依赖模型是否把新衣服写进 tag —— 旧链路只从图片 tag 取新衣物，
      // 模型没画那件就整段落空，账本停在白天那套。
      //
      // 顺序很重要：必须排在场景推断**之前**。场景推断按「当前账本有什么部件」去改状态，
      // 账本还停在白衬衫长裙时，它会把「泳衣肩带滑落、胸口露出大半」记到已经不存在的
      // shirt_story/bra_story 上（patch 找不到部件 → 静默失效），
      // 结果画面里泳衣穿得整整齐齐，正文写的走光和没有一样。
      const storyWear = adoptStoryClothing(source, activeEntries, wardrobe);
      if (storyWear.changes.length) {
        accepted.changes.push(...storyWear.changes);
        accepted.rejected.push(...storyWear.notes);
      }
      // 上面这些事件按位置生效之后，才是「这张图那一刻身上到底是什么」。
      const stateBeforeScene = clothingAt(wardrobe, accepted.changes, scope);
      // 剧情场景补账本：洗澡/全裸/亲密情节即使没逐件写脱衣，也按常识落状态，
      // 否则旧账本会把画面按「全套穿着」强行覆盖回去。
      const scene = synthesiseSceneClothing(source, activeEntries, stateBeforeScene, accepted.changes);
      accepted.changes.push(...scene.changes);
      accepted.rejected.push(...scene.notes);
      // 场景翻篇（换天/出门）时把上一段脱掉的衣物自动穿回：账本里的 removed 是永久的，
      // 不复位就会出现「第二天日常剧情女主还光着上半身出场」。只在本楼没有脱衣动作时触发。
      const redress = redressForNewScene(source, activeEntries, clothingAt(wardrobe, accepted.changes, scope));
      if (redress.changes.length) {
        accepted.changes.push(...redress.changes);
        accepted.rejected.push(...redress.notes);
      }
      // 剧情明确换装但模型只写了 patch/漏报时，采纳图片里的新衣物，避免画面停在旧套装。
      for (const image of plan.images) {
        const stateAtImage = clothingAt(
          wardrobe,
          accepted.changes,
          scope,
          image.sourceLine,
          image.charOffset,
        );
        const adopted = adoptChangedClothing(image, stateAtImage, source, activeEntries);
        accepted.changes.push(...adopted.changes);
        accepted.rejected.push(...adopted.notes);
      }
      accepted.changes.sort((a, b) => a.sourceLine - b.sourceLine || a.charOffset - b.charOffset);
    }
    if (!slot)
      accepted.rejected.push(
        ...unreportedClothingActions(source, accepted.changes, activeEntries, wardrobe).map(
          (note) => '待核对的穿脱动作：' + note,
        ),
      );
    if (accepted.rejected.length) {
      diagnostic('outfit:rejected', { floor, notes: accepted.rejected.slice(0, 12) });
      toastr.warning(
        '部分服装变化无法确认，已记录原因并保留既有状态；本楼继续生成图片。可在图片说明中核对。',
        '墨影',
      );
    }
    const costumeRepairs = await prepareCostumeRepairs(
      slotWardrobe ?? wardrobe,
      accepted.changes,
      plan.images,
      costume,
      costumeRequest.setting ?? '',
      controller.signal,
      source,
      activeEntries,
    );
    if (controller.signal.aborted) return;
    // Repair a request-local copy; historical floors stay intact. States and garment IDs never change.
    repairCostumeState(wardrobe, costume.initial, costumeRepairs);
    for (const record of wardrobe.values())
      for (const p of record.pieces)
        if (
          !p.costume &&
          !['unknown', 'mixed'].includes(costume.initial.era) &&
          !costumeConflicts(p.design, costume.initial).length
        )
          p.costume = { ...costume.initial };
    for (const c of accepted.changes) {
      if (c.operation === 'patch') continue;
      for (const p of c.pieces) {
        p.evidence = c.evidence;
        p.costume = { ...costumeAt(costume, c.sourceLine, c.charOffset) };
      }
      const eventState = new Map([
        [c.name, { name: c.name, outfitId: '', pieces: c.pieces, source: c.evidence }],
      ]);
      repairCostumeState(eventState, costumeAt(costume, c.sourceLine, c.charOffset), costumeRepairs);
    }
    const frames: ClothingFloor['frames'] = [];
    const completion: ClothingState = new Map();
    const visualNotes: string[] = [
      ...accepted.rejected,
      ...appearanceChangeNotes,
      ...costumeNotes,
      ...costumeRepairs.notes,
      // 首次建档 / 明确换装做出来的新套装如果只有 white shirt, black skirt 这种密度，
      // 画出来就是一块布。只提示不改账本——账本是模型写的，程序补不出他没有的剪裁。
      ...(slot
        ? []
        : accepted.changes
            .filter((c) => c.operation === 'change' || c.operation === 'init')
            .flatMap((c) =>
              c.pieces
                .filter((p) => p.design.trim() && thinDesign(p.design))
                .map((p) => `服装偏薄：${c.name} 的「${p.design.trim()}」缺剪裁/材质，画出来没有轮廓`),
            )),
    ];
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
        lockedNames,
        image.charOffset,
      );
      if (tagRes.text) image.tag = tagRes.text;
      if (image.nl) {
        const nlRes = applyPositionedCharRefs(
          image.nl,
          anchors.entries,
          maleGuarded,
          image.sourceLine,
          'nl',
          lockedNames,
          image.charOffset,
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
          lockedNames,
          image.charOffset,
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
            lockedNames,
            image.charOffset,
          );
          character.nl = charNl.text;
          for (const n of charNl.unknown) unknownNames.add(n);
        }
      }
      for (const n of tagRes.unknown) unknownNames.add(n);
      const entriesAt = applyCharTagOps(
        safeEntries,
        maleGuarded
          .filter(
            (o) =>
              o.op.kind === 'new' ||
              o.sourceLine < image.sourceLine ||
              (o.sourceLine === image.sourceLine && (o.charOffset ?? 0) <= image.charOffset),
          )
          .map((o) => o.op),
        floor,
        lockedNames,
      );
      visualNotes.push(
        ...enforceAppearance(image, entriesAt, profile.nl, profile.naiCharPrompts, planIdentities),
      );
      visualNotes.push(
        ...enforceKnownMaleIdentity(image, libraryAtStart, planIdentities, profile.naiCharPrompts),
      );
      const at =
        slotWardrobe ?? clothingAt(wardrobe, accepted.changes, scope, image.sourceLine, image.charOffset);
      for (const [name, entry] of completion) if (!at.has(name)) at.set(name, entry);
      const frameCostume =
        (slot && savedWardrobe?.frames[slot.seq]?.costume) ||
        costumeAt(costume, image.sourceLine, image.charOffset);
      initialiseClothingFromImage(image, at, source, activeEntries);
      for (const record of at.values())
        if (/旧版记录/.test(record.source) && !wardrobe.has(record.name)) {
          const evidence = explicitCostumeEvidence(
            record.name,
            record.pieces.map((p) => p.design).join(', '),
            frameCostume,
            source,
            image.sourceLine,
            image.charOffset,
          );
          if (evidence) {
            record.source = evidence;
            for (const p of record.pieces) p.evidence = evidence;
          }
        }
      repairCostumeState(at, frameCostume, costumeRepairs);
      for (const record of at.values())
        for (const p of record.pieces) if (!p.costume) p.costume = { ...frameCostume };
      visualNotes.push(...removeUnbackedCostume(image, at, frameCostume, activeEntries));
      for (const [name, entry] of at)
        if (!wardrobe.has(name) && !accepted.changes.some((c) => c.name === name))
          completion.set(name, entry);
      enforceClothing(image, at, profile.nl, profile.naiCharPrompts, activeEntries, source);
      // 受控枚举:模型选 act,这里展开成 danbooru 复合 tag(器官/体位/反应)+ 兜底构图。
      // 老路径(模型没给 act)继续走下面的正则词表,两条通道互不否定——多补只会更准,
      // 去重由 appendExplicitTags 统一处理。
      // 方向以正文为准:模型的枚举选择也会错(第 18 节「男含女」被选成 mouth-on-him),
      // 但正文里「嘴落在谁身上」有确定答案——动词最近的那个器官就是宾语。
      // 模型整个漏掉 act 时也用同一个判据补一次:嘴上动作是本插件唯一能从原文
      // 100% 判定方向的行为,补上比交给词表猜稳。
      {
        const mouth = mouthSide(explicitSentence(source, image.sourceLine, image.charOffset));
        const inferred = mouth === 'on-her' ? 'mouth-on-her' : mouth === 'on-him' ? 'mouth-on-him' : null;
        image.act = alignMouthAct(image.act, mouth) ?? image.act ?? inferred;
      }
      // 插入类行为模型经常整个漏掉（只写「按住腰」），画面就只剩一个握腰的手。
      // 正文里「插进去/进入/抽送」是确定事实，按它补 act，行为和器官由枚举表补齐。
      if (!image.act) {
        const sentence = explicitSentence(source, image.sourceLine, image.charOffset);
        if (/插入|插进|进入|挺进|抽送|顶进|操进|没入/.test(sentence)) {
          image.act = /后入|背后|趴着|撅着|背对/.test(sentence) ? 'rear' : 'front';
        }
      }
      if (image.act) {
        const expansion = actExpansion(image.act);
        if (expansion.base.length) image.tag = appendExplicitTags(image.tag, expansion.base);
        // 需要有男方在场的行为，人数 tag 必须写出来：只写 `1girl` 时模型会把
        // `penis`、`his hand` 画到她身上，或者干脆画成她自己。
        if (expansion.needsMale && !/\b1boy\b/i.test(image.tag)) image.tag = `${image.tag}, 1boy`;
        // 承受方 = 非男性角色块。`self`/`toy` 没有 source 段,男性块什么都不加。
        for (const character of image.characters) {
          // 男性判定不能只靠 planIdentities：模型常不给男主建档，`isMaleIdentity` 认不出，
          // 于是把承受方标签（moaning/arched back/spread legs）塞进男主块，画出一个张腿的男人。
          const receiving =
            !/\b1boy\b|faceless male/i.test(character.tag) &&
            !isMaleIdentity(character.name, planIdentities);
          const extra = receiving ? expansion.target : expansion.source;
          if (extra.length) character.tag = appendExplicitTags(character.tag, extra);
        }
      }
      // 构图兜底**不依赖枚举**:模型没给 act 时,`pov + all fours + looking back`
      // 照样会把观看者的下体画成屁股后面一根黑柱;看点在下体的图也照样会被裁成大头照。
      image.tag = enforceActFraming(image.tag, image.act);
      // gemini 档让模型只写「可拍摄的构图」,性器官/性行为/体液这些词由这里按原文补。
      // 其它档不补:模型本来就写了,重复追加只会让 tag 更长、稀释主体。
      if (isGeminiTier(promptOptions.jailbreakTier)) {
        const extra = explicitTagsFor(
          explicitSentence(source, image.sourceLine, image.charOffset),
          image.tag,
          image.act,
        );
        if (extra.length) image.tag = appendExplicitTags(image.tag, extra);
      }
      // 账本与档案都按主名记，快照筛选也要归一，否则模型写别称时这帧的
      // appearance/entries 是空的，出图时二次锁定就没了依据。
      const castNames = new Set(
        image.characters.map((c) => (activeEntries.length ? resolveCanonicalCharName(c.name, activeEntries) : c.name)),
      );
      // 最后一道：袖长等修饰语必须落在写回楼层的 tag 上（外貌层会重建 tag，前面补的会被冲掉）。
      applyTextQualifiers(image, source, wardrobe, plan.facts ?? []);
      frames.push({
        tag: serializeImageTag(image),
        sourceLine: image.sourceLine,
        charOffset: image.charOffset,
        appearance: entriesAt.filter((e) => castNames.has(e.name)).map((e) => ({ ...e, history: [] })),
        entries: JSON.parse(JSON.stringify([...at.values()].filter((e) => castNames.has(e.name)))),
        costume: frameCostume,
      });
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
    if (
      !plan.images.length &&
      !floorOps.length &&
      !accepted.changes.length &&
      !assessedIdentities.length &&
      !costume.events.length &&
      costume.initial.era === 'unknown' &&
      !previousDelta
    ) {
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
    // 校准必须发生在 clothingAt 之后：clothingAt 是「基线 + 本楼变更」重算出来的
    // 新表，改 wardrobe 的副本会被它整份覆盖（实机第 12 楼 tag 画着短裙、
    // 账本 finalWardrobe 里却没有——正是先校准后重算丢掉的）。
    const reconciled = reconcileLedgerWithTags(
      finalWardrobe,
      plan.images.flatMap((image) => image.characters.map((character) => ({ name: character.name, tag: character.tag }))),
    );
    if (reconciled.length)
      console.warn(`[墨影] 账本按 tag 校准 ${reconciled.length} 处：${reconciled.slice(0, 6).join('、')}`);
    repairCostumeState(finalWardrobe, costume.final, costumeRepairs);
    const completedOutfits = rememberCompleteOutfit(finalWardrobe, floor);
    if (completedOutfits.length)
      console.warn(`[墨影] 记下完整穿搭：${completedOutfits.join('、')}`);
    // 本楼画面里出场（或被换装事件点名）的角色：这些人的账本必须完整落盘，
    // 不能因为「与基线相同」被 delta 滤掉，否则下一楼拿到空账本整段停摆。
    const touchedByFrame = new Set<string>([
      ...accepted.changes.map((c) => c.name),
      ...plan.images.flatMap((i) =>
        i.characters.map((c) => (activeEntries.length ? resolveCanonicalCharName(c.name, activeEntries) : c.name)),
      ),
    ]);
    const previousWardrobe = message.extra?.[BBI_OUTFIT_EXTRA_KEY] as Partial<ClothingFloor> | undefined;
    const nextWardrobe: ClothingFloor = {
      v: 2,
      swipe: swipeId ?? 0,
      sourceHash: expectedStory,
      upstreamHash: wardrobeRevision,
      costume,
      delta: true,
      manualChoiceRevision: expectedWardrobeChoice,
      // 全量写：只写「本楼有变更/出场」的条目会在 no_frame 楼层断链——没有图也没有
      // 变更时 entries 成空数组，下一楼读到空账本，睡裙与外套全丢（实测第 1/2 楼）。
      // 账本每个角色只有几件、每件只存四个状态键，全量写的体积可以接受。
      start: JSON.parse(JSON.stringify([...wardrobe.values()])),
      // delta 只写「与基线不同」的条目时，会出现一条断链：某楼的账本是从旧楼层
      // 图片 tag 反推出来的（legacy，状态全是 unknown），本楼新建出来的条目与它
      // 逐字节相同 → 被判「没变化」不写进 extra → 下一楼读到的是 delta 楼 + 空 entries，
      // 于是整个账本变成空的，洗澡/脱衣全部推断不出来（实测第 44 楼就是这样，
      // 第 45 楼直接 return）。所以把本楼画面里出现的角色一并强制写下来。
      entries: [...finalWardrobe.values()],
      changes: accepted.changes,
      rejected: visualNotes,
      frames,
      legacyBackup: previousWardrobe?.v === 2 ? previousWardrobe.legacyBackup : previousWardrobe,
    };
    const rewrittenWardrobe =
      slot && savedWardrobe && savedWardrobe.frames[slot.seq]?.tag === slotRawTag
        ? {
            ...savedWardrobe,
            frames: savedWardrobe.frames.map((frame, index) =>
              index === slot.seq && plan.images[0]
                ? {
                    ...frame,
                    tag: serializeImageTag(plan.images[0]),
                    entries: frames[0]?.entries ?? frame.entries,
                    appearance: frames[0]?.appearance ?? frame.appearance,
                    costume: frames[0]?.costume ?? frame.costume,
                  }
                : frame,
            ),
          }
        : null;
    if (visualNotes.length) diagnostic('continuity:resolved', { floor, notes: visualNotes });
    const result = await applyMessageText(
      floor,
      (currentText) => {
        if (
          appearancePolicyRevision() !== expectedAppearancePolicy ||
          wardrobeChoiceRevision(getContext()?.chat[floor]) !== expectedWardrobeChoice
        )
          return null;
        if (
          controller.signal.aborted ||
          narrativeHash(currentText) !== expectedStory ||
          clothingRevision(getContext()?.chat ?? [], floor) !== wardrobeRevision ||
          JSON.stringify(charTagsBeforeFloor(slot ? floor + 1 : floor)) !== expectedLibrary ||
          identityManualRevision() !== identityRevision
        )
          return null;
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
        ? rewrittenWardrobe
          ? [{ key: BBI_OUTFIT_EXTRA_KEY, value: rewrittenWardrobe }]
          : undefined
        : [
            {
              key: IDENTITY_EXTRA_KEY,
              value: {
                v: 1,
                swipe: swipeId ?? 0,
                sourceHash: identityStoryHash(rawSource),
                contextHash: identityContextHash(),
                facts: assessedIdentities,
              },
            },
            {
              key: BBI_CHAR_EXTRA_KEY,
              value: makeCharTagFloorDelta(floorOps, swipeId ?? 0),
            },
            {
              key: BBI_OUTFIT_EXTRA_KEY,
              value: nextWardrobe,
            },
            {
              key: BBI_FACTS_EXTRA_KEY,
              value: {
                v: 1,
                hash: textHash(source),
                at: Date.now(),
                facts: plan.facts ?? [],
              } satisfies StoredFacts,
            },
            {
              key: BBI_TRACE_EXTRA_KEY,
              value: buildFloorTrace({
                floor,
                facts: plan.facts,
                restored: restoredNames,
                images: plan.images,
                original: nlOriginal,
                wardrobe: finalWardrobe,
                segmentOf: (position) =>
                  preparedTarget.segments.find((segment) => segment.id === position)?.text ?? '',
              }) satisfies FloorTrace,
            },
            {
              key: BBI_OUTCOME_EXTRA_KEY,
              value: {
                v: 1,
                status: plan.images.length ? 'success' : 'no_frame',
                images: plan.images.length,
                dropped: droppedImages,
                attempts: attemptsUsed,
                at: Date.now(),
              } satisfies FloorOutcome,
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
  await runForFloor(floor, {
    manual: true,
    headless: true,
    onNoImages: () => {
      noImages = true;
    },
  });
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
  context.eventSource.on(events.GENERATION_STARTED, (type: unknown, options: unknown, dryRun: unknown) => {
    const chatId = getContext()?.getCurrentChatId?.() ?? '';
    const eligible = Boolean(
      chatId && !dryRun && typeof type === 'string' && type !== 'quiet' && type !== 'impersonate',
    );
    diagnostic('GENERATION_STARTED', { chatId, type, dryRun, eligible, options });
    // 写正文之前把着装账本注入上下文：模型知道她穿着什么，才不会自己换衣服。
    if (eligible) refreshWardrobeLock();
    beginGeneration(chatId, type, dryRun);
  });
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
    refreshWardrobeLock();
  });
}
