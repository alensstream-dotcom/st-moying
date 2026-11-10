import { wardrobeChoiceRevision, suitNote } from '@/state/wardrobeChoice';
import { renderAppearanceOverrides } from '@/state/appearancePolicy';
import { lookSettings, fingerprint } from '@/state/characterStudio';
import { getThumb } from '@/data/loreThumbs';
import { prepareCharacterReference } from '@/backends/characterReference';
import { costumeConflicts, removeUnbackedCostume, type CostumeContext } from '@/autoTag/costumeContext';
import {
  readClothingFloor,
  clothingRevision,
  enforceClothing,
  clothingBefore,
} from '@/autoTag/outfitTimeline';
import { getContext } from '@/st/context';
import { currentIdentityFacts, enforceKnownMaleIdentity, isMaleIdentity } from '@/state/characterIdentity';
/**
 * 「一次出图」的共用中段 —— 楼层卡片与公开接口的唯一生成入口。
 *
 * 原本这段活全写在 Card.vue 的 generate() 里,与槽位运行态(beginGen/failGen)、
 * 落盘(saveImageResult)、重水合(hydrateMessage)缠在一起。公开接口要让第三方
 * 「自己决定图显示在哪」,要的恰恰是**掐头去尾的中段**:
 *
 *   前(调用方):登记运行态 / 校验参数
 *   ★ 中(本模块):NAI 闸门 → 按 backend 分派 → 拿到图
 *   后(调用方):落盘、显示、收尾埋点
 *
 * **闸门不可绕过**,这是本模块存在的首要理由:直接调 backends/nai.ts 的
 * generateNaiImage 会跑在 floor/genQueue.ts 的并发闸门与全局节奏之外,0.2.0 整版的
 * NAI 限流自愈(429 全局冷却、相邻请求最小间隔、退避重试)当场失效。第三方并发调用
 * 是常态,绕过去的症状是用户 NAI 账号吃一串密集 429 —— 而用户只会认为墨影坏了。
 * 故公开接口与卡片共用本函数,闸门在这里包死。
 *
 * 本模块**刻意不碰**:楼层坐标、genState、extra、水合、请求历史埋点。
 * 埋点留给调用方是有意为之:一条历史记录的「成功」判据各家不同——楼层卡片要等
 * saveImageResult 落盘成功才算成,还要把「图拿到了却因任务被取代而丢弃」记成已取消;
 * 本模块只知道请求本身的成败,替调用方下结论会把那两种情形谎报成成功。
 * 故 decideSeed 单独导出:调用方先定种子(埋点需要它)、再把它显式传进来。
 */

import type { ImageCharacterPrompt } from '@/autoTag/protocol';
import {
  comfySimpleParams,
  composeNegative,
  composePositive,
  validateSimpleConfig,
  type SimpleGenValues,
} from '@/backends/comfyTemplates';
import { generateComfyImage, randomSeed, type ComfyImageResult } from '@/backends/comfyui';
import {
  generateNaiImage,
  naiRandomSeed,
  naiSupportsCharacterPrompts,
  naiArtistPrompt,
  naiQualityTags,
  fullNegativePrompt,
} from '@/backends/nai';
import { effectiveOrientation, parseSize, pickSize, type Orientation } from '@/backends/size';
import { acquireNaiSlot } from '@/floor/genQueue';
import type { GenerationMeta } from '@/generationMeta';
import {
  activeComfyPreset,
  activeNaiEndpoint,
  activeOrientationLock,
  effectiveComfyConn,
  effectiveNai,
  settings,
  type BackendId,
} from '@/state/settings';
import { applyPresetToNaiConn, genPresetById } from '@/state/genPresets';
import { allCharacterRecords, charTagLib, isManualFandom } from '@/state/charTags';
import { enforceAppearance, isAppearanceDescription } from '@/autoTag/appearanceLock';

/** 一次生成的输入。与协议层 ImageInsertion 同形,但不含正文位置信息。 */
export interface GenerateInput {
  suppressCharacterReference?: boolean;
  /** Explicit per-request portrait override; never mutates channel settings. */
  naiPortraitResolution?: string;
  /** Exact saved story frame; omitted for free-form APIs and material previews. */
  storyFrame?: { floor: number; tag: string };
  /** 正向 danbooru 短 tag。 */
  prompt: string;
  /** 自然语言部分(可空)。 */
  nl?: string;
  /** 本画面动态负面(可空)。ComfyUI 走 %negative_prompt%;NAI 的负面取渠道配置,不吃这个。 */
  negative?: string;
  /** NAI 4.5/V5 原生多角色提示;ComfyUI 不支持(见 charactersApplied)。 */
  characters?: ImageCharacterPrompt[];
  /**
   * 画幅方向;缺省竖屏。具体像素取渠道配置里的横竖尺寸。
   * 渠道锁定了方向(activeOrientationLock)时一律按锁定方向出,这里传什么都不算数。
   */
  size?: Orientation;
  /** 本次种子。由调用方经 decideSeed() 先行确定(埋点要在发请求前拿到它)。 */
  seed: number;
  /**
   * 只对本次请求生效的后端覆盖(留空 = 用渠道默认)。
   *
   * 素材缩略图必须钉死 NAI:缩略图的提示词是 danbooru tag 串,拿去 ComfyUI 的
   * SD 模型会出拼贴状碎片;而「跟随渠道当前模型」在用户把默认渠道设成 ComfyUI
   * 时正好会踩这个坑。
   */
  backend?: BackendId;
  /**
   * 只对本次请求生效的 NAI 模型覆盖(留空 = 用渠道配置)。素材缩略图用它走
   * `nai-diffusion-4-curated-preview` 这类不占额度的模型,免得为预览烧 Anlas。
   */
  naiModel?: string;
  /**
   * 只对本次请求生效的生图配置预设(留空 = 用渠道当前参数)。
   *
   * 素材库配图走这条:用户把「素材库配图」那套预设标成 forLore 之后,预览图按那套出,
   * 不跟主出图参数走,也就不必为了配预览先把主配置改一遍。
   */
  genPresetId?: string;
}

/** 生成过程中的进度上报(卡片用它显示排队位置与退避进度)。 */
export interface GenerateProgress {
  /** 已取得闸门槽位、请求即将发出(NAI 从「排队中」进入「生成中」的时机)。 */
  onStart?: () => void;
  /** ComfyUI 服务端队列里前面还有几个;null = 未知。 */
  onQueue?: (ahead: number | null) => void;
  /** NAI 限流退避进度;传 null 表示已不在退避中。 */
  onRetry?: (retry: { attempt: number; max: number } | null) => void;
}

export interface GenerateOutput {
  result: ComfyImageResult;
  /** 本次实际使用的种子(原样回传,调用方不必自己记)。 */
  seed: number;
  /** 本次实际出图的画幅方向(渠道锁定时即锁定方向,可能与入参 size 不同)。 */
  size: Orientation;
  backend: BackendId;
  /**
   * characters 是否真的发给了后端。
   * ComfyUI 链路**不支持**多角色提示(comfyui.ts / comfyTemplates.ts 全程不读该字段),
   * 传了也是静默丢弃 —— 故显式回报,调用方据此决定要不要提示用户换后端。
   * 不在这里「降级拼进 prompt」:那正是 0.2.3 修掉的重叠躯干问题(一张图里多份完整外貌)。
   */
  charactersApplied: boolean;
  /**
   * 本次实际使用的画师串 / vibe / 采样参数 / 模型，供落盘随图记录（见 generationMeta.ts）。
   * NAI 的画师串与 vibe 不在 tag 文本里，不在这里冒泡出去就只能永久丢失。
   */
  meta: GenerationMeta;
}

/** 后端就绪状态。 */
export interface BackendStatus {
  backend: BackendId;
  configured: boolean;
  /** NAI 为模型名;ComfyUI 为当前工作流预设名。 */
  model: string;
  /** 当前后端是否支持 characters(NAI 4.5/V5 为 true,ComfyUI 恒 false)。 */
  supportsCharacters: boolean;
  /** configured=false 时的人话原因;已就绪为空串。 */
  reason: string;
}

/**
 * 当前后端能不能出图。**唯一判据**,卡片(configured)与公开接口共用。
 *
 * ComfyUI 要按模式分别校验(custom 要工作流 JSON;simple 要模型/VAE/CLIP 选齐,
 * 与出图组装同一口径 validateSimpleConfig,避免「卡片能点、出图才报错」);NAI 要 url + key。
 */
export function backendStatus(backend: BackendId = settings.defaultBackend): BackendStatus {
  if (backend === 'nai') {
    const model = settings.nai.model;
    // 支持与否只看模型,与配没配齐无关:第三方要在出图前就知道该不该传 characters
    const supportsCharacters = naiSupportsCharacterPrompts(model);
    const base = { backend, model, supportsCharacters };
    // 地址与 key 取**当前接入点**那一份(见 effectiveNai);渠道级 nai.url/nai.key 是存量字段。
    // reason 里刻意**不带接入点名字**:它会经 getBackendStatus 原样递给第三方,而名字是用户
    // 自己敲的——有人就拿站点域名当名字,带上等于把地址漏进公开返回值(见 public/api.ts 白名单)。
    // 少了名字也不难定位:面板下拉里选中的就是这条。
    const conn = activeNaiEndpoint();
    if (!conn.url.trim()) {
      return {
        ...base,
        configured: false,
        reason: '当前 NAI 接入点未填写服务地址',
      };
    }
    if (!conn.key.trim()) {
      return {
        ...base,
        configured: false,
        reason: '当前 NAI 接入点未填写 API Key',
      };
    }
    return { ...base, configured: true, reason: '' };
  }

  if (backend === 'comfyui') {
    const preset = activeComfyPreset();
    const base = { backend, model: preset.name, supportsCharacters: false };
    if (!settings.comfyui.url.trim()) {
      return { ...base, configured: false, reason: '未填写 ComfyUI 服务地址' };
    }
    if (preset.mode === 'simple') {
      const invalid = validateSimpleConfig(preset.simple);
      if (invalid) return { ...base, configured: false, reason: invalid };
      return { ...base, configured: true, reason: '' };
    }
    if (!preset.workflow.trim()) {
      return {
        ...base,
        configured: false,
        reason: '当前工作流预设未填写工作流 JSON',
      };
    }
    return { ...base, configured: true, reason: '' };
  }

  // webui 只剩存量类型(设置迁移会把它归一成 comfyui/nai),真出现就是「没选后端」
  return {
    backend,
    configured: false,
    model: '',
    supportsCharacters: false,
    reason: '出图后端未选择,请在墨影「渠道」页选择出图渠道',
  };
}

/**
 * 定本次种子。**必须在发请求前定好**:一是部分采样器节点不接受 -1 自动随机,
 * 二是埋点与落盘(entry.seed)都要记下它,事后「同种子再来一张」才有依据。
 *
 * 口径:显式指定 > NAI 面板固定种子(>0)> 随机。
 * NAI 与 ComfyUI 的随机上界不同(各自协议的合法范围),故分开取。
 */
/**
 * 决定这一张的种子。
 *
 * `fresh` 为重绘场景:面板里写死的种子在重绘时必须让位,否则每点一次「重新生成」
 * 都拿同一个 seed 求同一张图,用户会以为按钮坏了。
 */
export function decideSeed(backend: BackendId, override?: number, fresh = false): number {
  if (!fresh && override !== undefined && Number.isFinite(override) && override > 0)
    return Math.floor(override);
  if (backend === 'nai') return !fresh && settings.nai.seed > 0 ? settings.nai.seed : naiRandomSeed();
  return randomSeed();
}

/**
 * 按当前设置出一张图。**楼层卡片与公开接口的唯一生成路径。**
 *
 * 不负责落盘、不负责显示、不登记运行态、不做埋点 —— 那些是调用方的事。
 * signal 一路透传到 fetch/轮询;取消时抛 AbortError(DOMException)。
 *
 * 闸门纪律(见 floor/genQueue.ts):NAI 路径必须持槽发请求,release 放在 finally,
 * 漏一格就永久少一格并发。
 */
let lastFandomConfigWarning = '';
export async function generateImage(
  input: GenerateInput,
  signal?: AbortSignal,
  progress: GenerateProgress = {},
): Promise<GenerateOutput> {
  const target = input.backend ?? settings.defaultBackend;
  const status = backendStatus(target);
  // 兜底:卡片侧已用 configured 拦在按钮上,公开接口侧也会先报 not_configured。
  // 真漏到这里说明上游判据漂了,宁可明说也别发一个注定 401/404 的请求。
  if (!status.configured) throw new Error(status.reason || '出图后端未配置');

  const isNai = status.backend === 'nai';
  const renderOverrides = renderAppearanceOverrides(charTagLib.entries);
  const manualFandoms = [
    ...new Map(
      [...charTagLib.entries.filter(isManualFandom), ...renderOverrides].map((e) => [e.name, e]),
    ).values(),
  ].filter((e) => input.characters?.some((c) => c.name === e.name));
  let appearanceNotes: string[] = [];
  if (input.storyFrame && input.characters?.length) {
    const chat = getContext()?.chat ?? [];
    const saved = readClothingFloor(
      chat[input.storyFrame.floor],
      clothingRevision(chat, input.storyFrame.floor),
    );
    const frame = saved?.frames.find((f) => f.tag === input.storyFrame!.tag);
    if (frame?.appearance?.length) {
      const image = {
        position: '',
        sourceLine: frame.sourceLine,
        charOffset: frame.charOffset,
        tag: input.prompt,
        nl: input.nl || '',
        negative: input.negative || '',
        size: input.size || ('portrait' as const),
        characters: input.characters.map((c) => ({ ...c })),
      };
      appearanceNotes.push(
        ...enforceAppearance(
          image,
          frame.appearance,
          !!input.nl || image.characters.some((c) => !!c.nl),
          status.supportsCharacters,
        ),
      );
      input = { ...input, prompt: image.tag, nl: image.nl, characters: image.characters };
    }
  }

  if (manualFandoms.length && input.characters?.length) {
    const image = {
      position: '',
      sourceLine: 0,
      charOffset: 0,
      tag: input.prompt,
      nl: input.nl ?? '',
      negative: input.negative ?? '',
      size: input.size ?? ('portrait' as const),
      characters: input.characters.map((c) => ({ ...c })),
    };
    appearanceNotes.push(
      ...enforceAppearance(
        image,
        manualFandoms,
        !!input.nl || image.characters.some((c) => !!c.nl),
        status.supportsCharacters,
      ),
    );
    appearanceNotes.push(
      ...manualFandoms.map(
        (e) =>
          `用户外貌覆盖：${e.name} → ${e.fields.fandom || Object.values(e.fields).filter(Boolean).join(', ')}`,
      ),
    );
    input = {
      ...input,
      prompt: image.tag,
      nl: image.nl,
      characters: image.characters,
    };
  }
  const identityFacts = currentIdentityFacts();
  if (input.characters?.some((c) => isMaleIdentity(c.name, identityFacts))) {
    const image = {
      position: '',
      sourceLine: 0,
      charOffset: 0,
      tag: input.prompt,
      nl: input.nl ?? '',
      negative: input.negative ?? '',
      size: input.size ?? ('portrait' as const),
      characters: input.characters.map((c) => ({ ...c })),
    };
    appearanceNotes.push(
      ...enforceKnownMaleIdentity(image, allCharacterRecords(), identityFacts, status.supportsCharacters),
    );
    input = {
      ...input,
      prompt: image.tag,
      nl: image.nl,
      characters: image.characters,
    };
  }
  let costumeContext: CostumeContext | undefined;
  if (input.storyFrame) {
    const chat = getContext()?.chat ?? [],
      floor = input.storyFrame.floor;
    const saved = readClothingFloor(chat[floor], clothingRevision(chat, floor));
    const frame = saved?.frames.find((f) => f.tag === input.storyFrame!.tag);
    if (frame?.costume) {
      costumeContext = frame.costume;
      const state = new Map(frame.entries.map((e) => [e.name, e]));
      const image = {
        position: '',
        sourceLine: frame.sourceLine,
        charOffset: frame.charOffset,
        tag: input.prompt,
        nl: input.nl ?? '',
        negative: input.negative ?? '',
        size: input.size ?? ('portrait' as const),
        characters: (input.characters ?? []).map((c) => ({ ...c })),
      };
      appearanceNotes.push(...removeUnbackedCostume(image, state, frame.costume));
      enforceClothing(
        image,
        state,
        !!input.nl || image.characters.some((c) => !!c.nl),
        status.supportsCharacters,
      );
      input = {
        ...input,
        prompt: image.tag,
        nl: image.nl,
        characters: image.characters,
      };
    }
  }
  if (input.storyFrame && input.characters?.length) {
    const chat = getContext()?.chat ?? [],
      floor = input.storyFrame.floor;
    const saved = readClothingFloor(chat[floor], clothingRevision(chat, floor));
    const frame =
      (saved?.manualChoiceRevision ?? '[]') === wardrobeChoiceRevision(chat[floor])
        ? saved?.frames.find((f) => f.tag === input.storyFrame!.tag)
        : undefined;
    const current = clothingBefore(chat, floor + 1, charTagLib.entries),
      bound = new Map();
    for (const c of input.characters) {
      const record = frame?.entries.find((e) => e.name === c.name) ?? current.get(c.name);
      if (record?.suitMode) bound.set(c.name, record);
    }
    if (bound.size) {
      const image = {
        position: '',
        sourceLine: 0,
        charOffset: 0,
        tag: input.prompt,
        nl: input.nl ?? '',
        negative: input.negative ?? '',
        size: input.size ?? ('portrait' as const),
        characters: input.characters.map((c) => ({ ...c })),
      };
      enforceClothing(
        image,
        bound,
        !!input.nl || image.characters.some((c) => !!c.nl),
        status.supportsCharacters,
      );
      appearanceNotes.push(...[...bound.values()].map((e) => e.name + '：' + suitNote(e)));
      input = { ...input, prompt: image.tag, nl: image.nl, characters: image.characters };
    }
  }
  const characters = input.characters ?? [];
  // 支持与否由后端说了算:ComfyUI 恒不支持;NAI 看模型是否 4.5/V5
  const charactersApplied = characters.length > 0 && status.supportsCharacters;

  let release: (() => void) | null = null;
  try {
    // 持槽:取到槽位后本函数内一直持有,直到 finally 释放
    if (isNai) release = await acquireNaiSlot(signal);
    progress.onStart?.();

    // 画幅锁在这里统一生效(卡片与公开接口同走本函数):只决定这一次用哪格尺寸,
    // tag 里记的方向原样不动——promptHash 吃 tag 原文,改写会让老图无辜变 stale。
    const size = effectiveOrientation(activeOrientationLock(), input.size ?? 'portrait');
    let result: ComfyImageResult;
    let meta: GenerationMeta;
    if (isNai) {
      // 单次覆盖模型:素材缩略图走 V4 试用模型(不占 Anlas),不该为此改动用户保存的渠道设置。
      // effectiveNai() 返回的是浅拷贝,改它不会污染 settings。
      const naiConn = effectiveNai();
      // 预设先套、模型覆盖后套:后者是调用方最具体的意图(naiModel 明确点名就用它)。
      const preset = input.genPresetId ? genPresetById(input.genPresetId) : null;
      if (preset) applyPresetToNaiConn(naiConn, preset);
      if (input.naiPortraitResolution) {
        const resolution = parseSize(input.naiPortraitResolution);
        if (
          !resolution ||
          resolution.width % 64 ||
          resolution.height % 64 ||
          resolution.width < 256 ||
          resolution.height < 256 ||
          resolution.width > 2048 ||
          resolution.height > 2048
        )
          throw new Error('立绘分辨率须为 256–2048 范围内的 64 倍数');
        naiConn.portraitSize = input.naiPortraitResolution;
        naiConn.landscapeSize = input.naiPortraitResolution;
      }
      if (input.naiModel) naiConn.model = input.naiModel as typeof naiConn.model;
      if (manualFandoms.some(isManualFandom)) {
        const fixed = [naiArtistPrompt(naiConn), naiQualityTags(naiConn), fullNegativePrompt(naiConn)].join(
          ', ',
        );
        const conflicts = fixed
          .split(',')
          .map((t) => t.trim())
          .filter(isAppearanceDescription);
        if (conflicts.length) {
          const warning =
            '同人锁定：公共正负面配置包含外貌词，可能影响 trigger（' +
            conflicts.join(', ') +
            '）；请自行核对，插件保留你的配置';
          appearanceNotes.push(warning);
          if (fixed !== lastFandomConfigWarning) {
            toastr.warning(warning, '墨影');
            lastFandomConfigWarning = fixed;
          }
        } else lastFandomConfigWarning = '';
      }
      const configConflicts = costumeConflicts(
        [naiArtistPrompt(naiConn), naiQualityTags(naiConn)].join(', '),
        costumeContext,
      );
      if (configConflicts.length)
        appearanceNotes.push(
          '当前 NAI 配方/质量词含与剧情服饰背景冲突的服装词（' +
            configConflicts.join(', ') +
            '），已保留用户配置；若仍出现现代服装，请检查该配方',
        );
      let characterReference: { image: string; strength: number; fidelity: number } | undefined;
      const subjectCount = [...input.prompt.matchAll(/\b(\d+)(?:girls?|boys?|others?)\b/gi)].reduce(
        (sum, m) => sum + Number(m[1]),
        0,
      );
      if (
        !input.suppressCharacterReference &&
        characters.length === 1 &&
        (subjectCount === 1 || (subjectCount === 0 && /\bsolo\b/i.test(input.prompt)))
      ) {
        const c = characters[0],
          look = lookSettings(c.name),
          entry = charTagLib.entries.find((e) => e.name === c.name);
        if (look.reference) {
          if (!naiConn.model.includes('4-5') || naiConn.vibes.some((v) => v.enabled))
            appearanceNotes.push('图片参考未启用：仅 V4.5 且不能与 Vibe 同用，使用文字定妆');
          else if (
            !entry ||
            !look.active?.image ||
            fingerprint(entry.fields) !== fingerprint(look.active.fields) ||
            entry.raw !== (look.active.raw ?? '') ||
            entry.nl !== look.active.nl
          )
            appearanceNotes.push('图片参考未启用：缺少定妆图或档案已变更');
          else {
            const record = await getThumb(look.active.image);
            if (record) {
              characterReference = {
                image: await prepareCharacterReference(record.blob),
                strength: look.strength,
                fidelity: look.fidelity,
              };
              appearanceNotes.push('已发送单角色定妆参考（约 +5 Anlas；中转接口需验证）');
            } else appearanceNotes.push('本机定妆图缺失，使用文字定妆');
          }
        }
      } else if (!input.suppressCharacterReference && characters.some((c) => lookSettings(c.name).reference))
        appearanceNotes.push('多人画面使用独立文字定妆，不发送图片参考');
      const output = await generateNaiImage(
        naiConn,
        // characters 原样透传:不支持的模型由 buildNaiParameters 自己滤掉(同一口径
        // naiSupportsCharacterPrompts),在这儿再滤一遍只会多一处会漂的判据
        {
          prompt: input.prompt,
          nl: input.nl ?? '',
          characters,
          seed: input.seed,
          size,
          characterReference,
        },
        signal,
        {
          onRetry: (info) => progress.onRetry?.({ attempt: info.attempt, max: info.max }),
        },
      );
      result = output.result;
      meta = { backend: 'nai', model: naiConn.model, ...output.usage };
    } else {
      const conn = effectiveComfyConn();
      result = await generateComfyImage(
        conn,
        {
          prompt: input.prompt,
          nl: input.nl ?? '',
          negative_prompt: input.negative ?? '',
          seed: input.seed,
          size,
        },
        signal,
        { onQueue: (ahead) => progress.onQueue?.(ahead) },
      );
      // ComfyUI 没有运行期跳过的概念，配方全在预设里，可在此直接快照。
      // 尺寸解析口径与 generateComfyImage 一致（未解析出时 0 = 用工作流自带尺寸）。
      const px = parseSize(pickSize(conn, size));
      const width = px?.width ?? 0;
      const height = px?.height ?? 0;
      const simpleValues: SimpleGenValues = {
        prompt: input.prompt,
        nl: input.nl,
        negative: input.negative,
        seed: input.seed,
        width,
        height,
      };
      meta = {
        backend: 'comfyui',
        model: status.model,
        width,
        height,
        // custom 模式的提示词由工作流里的占位符决定，无法在这里拼出全文，留空。
        positive: conn.mode === 'simple' ? composePositive(conn.simple, simpleValues) : '',
        negative: conn.mode === 'simple' ? composeNegative(conn.simple, simpleValues) : '',
        artist: null,
        vibes: [],
        params: conn.mode === 'simple' ? comfySimpleParams(conn.simple) : { mode: 'custom' },
      };
    }

    // 退避文案到此为止:图已拿到,落盘还要一会儿,不该继续显示「稍后重试」
    progress.onRetry?.(null);
    if (appearanceNotes.length) meta.continuity = [...(meta.continuity ?? []), ...appearanceNotes];
    return {
      result,
      seed: input.seed,
      size,
      backend: status.backend,
      charactersApplied,
      meta,
    };
  } finally {
    release?.();
  }
}
