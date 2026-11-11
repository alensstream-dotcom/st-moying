<script setup lang="ts">
import { parseImageTags, parseImageTagContent } from '@/st/imageTagRegex';
import { recoverProfileFromChat } from '@/autoTag/profileRecovery';
import { characterAliases, saveCharacterAliases } from '@/state/characterAliases';
import WardrobePanel from '@/components/WardrobePanel.vue';
import FandomLibrary from '@/components/FandomLibrary.vue';
import type { FandomMaterial } from '@/data/fandomCatalog';
import { appearancePolicy, setAppearancePolicy, type AppearanceMode } from '@/state/appearancePolicy';

import { openLightbox } from '@/floor/lightbox';
import { genPresetList } from '@/state/genPresets';
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  recomputeCharTags,
  charTagBaseNames,
  readCharTagFloorDelta,
  charTagLib,
  emptyCharFields,
  upsertCharTag,
  removeCharTag,
  findCharTag,
  type CharTagEntry,
  CHAR_TAG_FIELDS,
  CHAR_TAG_FIELD_LABELS,
  isManualFandom,
} from '@/state/charTags';
import {
  globalCharTagLib,
  copyGlobalCharTagToChat,
  upsertGlobalCharTag,
  removeGlobalCharTag,
} from '@/state/globalCharTags';
import {
  lookSettings,
  saveLook,
  adoptLook,
  fingerprint,
  loadTagChinese,
  explainTags,
  setTagChinese,
  searchTagChinese,
  type LookVersion,
} from '@/state/characterStudio';
import { getThumb, putStudioImage } from '@/data/loreThumbs';
import { getContext } from '@/st/context';
import { fetchCharCard, fetchUserPersona, fetchWorldInfo } from '@/autoTag/context';
import { readBookMemory } from '@/autoTag/bookMemory';
import { requestCompletion, requestViaMainApi } from '@/api/client';
import { settings, getTagGenChannel } from '@/state/settings';
import { generateImage, decideSeed } from '@/generate';
import { costumeBefore } from '@/autoTag/costumeContext';
import { clothingBefore } from '@/autoTag/outfitTimeline';
import { reviewAutomaticProfiles } from '@/autoTag/identityReview';
import {
  currentIdentityFacts,
  confirmCharacterIdentity,
  undoIdentityReview,
} from '@/state/characterIdentity';
let taskChat: string | undefined;
function checkTask() {
  if (controller?.signal.aborted) throw new DOMException('已取消', 'AbortError');
  if (taskChat !== getContext()?.getCurrentChatId?.()) throw new Error('聊天已切换，已停止写入');
}
const query = ref(''),
  selected = ref(''),
  tab = ref('档案'),
  busy = ref(false),
  feedback = ref(''),
  dictionaryReady = ref(false),
  showTemplates = ref(false);
const draft = ref<CharTagEntry | null>(null),
  candidate = ref<CharTagEntry | null>(null),
  portrait = ref(''),
  candidateUrl = ref('');
let candidateBlob: Blob | null = null;
let controller: AbortController | null = null;
const tagSearch = ref(''),
  tagTarget = ref<keyof CharTagEntry['fields']>('extra');
const tagMatches = computed(() => {
  dictionaryReady.value;
  return searchTagChinese(tagSearch.value);
});
function appendTag(tag: string) {
  if (!draft.value) return;
  const old = draft.value.fields[tagTarget.value];
  draft.value.fields[tagTarget.value] = [
    ...new Set([
      ...old
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      tag,
    ]),
  ].join(', ');
}
const portraitPreset = ref(''),
  portraitResolution = ref('1024x1536');
let zoomTimer: ReturnType<typeof setTimeout> | undefined;
function queuePortraitZoom(candidateImage = false) {
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => zoomPortrait(candidateImage), 260);
}
function zoomPortrait(candidateImage = false) {
  clearTimeout(zoomTimer);
  const src = candidateImage ? candidateUrl.value : portrait.value;
  if (src)
    openLightbox({
      src,
      filename: (draft.value?.name || '角色') + '立绘',
      prompt: candidateImage ? candidate.value?.nl : draft.value?.nl,
    });
}
const pendingIdentities = computed(() => {
  version.value;
  return currentIdentityFacts().filter(
    (f) =>
      f.gender === 'unknown' ||
      f.conflict ||
      (f.gender === 'female' && !charTagLib.entries.some((e) => e.name === f.name)),
  );
});
async function confirmIdentity(name: string, female: boolean) {
  try {
    confirmCharacterIdentity(name, female ? 'female' : 'male', female);
    recomputeCharTags();
    if (female && !findCharTag(name)) {
      const fields = recoverProfileFromChat(name, characterAliases(name), getContext()?.chat || []);
      if (
        !upsertCharTag({
          name,
          fields,
          source: 'manual',
          raw: '',
          nl: '',
          desc: '用户确认女性后从已有具名图片标签恢复；缺少的外貌字段可继续补全',
          history: [],
        })
      )
        throw new Error('身份已确认，但档案保存失败');
    }
    recomputeCharTags();
    version.value++;
    if (female) await select(name);
    feedback.value = female
      ? `已确认 ${name} 为女性，角色档案已显示；恢复的外貌请核对，缺项可补全`
      : `已确认 ${name} 为男性，自动女性档案已暂停使用`;
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  }
}
function undoReview() {
  undoIdentityReview();
  recomputeCharTags();
  version.value++;
  feedback.value = '已撤销身份审核结论；确认女性时补建的档案保留，可在角色库删除';
}
const aliasDraft = ref('');
function saveAliases() {
  try {
    saveCharacterAliases(
      selected.value,
      aliasDraft.value,
      charTagLib.entries.map((e) => e.name),
    );
    feedback.value = '称谓已关联到当前角色，后续分析与生图共用她的外貌和服装；旧重复档案不会自动删除';
    version.value++;
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  }
}
const appearanceMode = ref<AppearanceMode>('story'),
  protectedFields = ref<string[]>([]);
function pinEdited(field: string) {
  if (field === 'fandom') {
    appearanceMode.value = draft.value?.fields.fandom.trim() ? 'fandom' : 'manual';
    return;
  }
  if (appearanceMode.value === 'story') appearanceMode.value = 'manual';
  if (!protectedFields.value.includes(field)) protectedFields.value.push(field);
}
function persistPolicy(entry: CharTagEntry) {
  const fields: Partial<CharTagEntry['fields']> = {};
  if (appearanceMode.value !== 'story')
    for (const f of protectedFields.value) {
      if (CHAR_TAG_FIELDS.includes(f as any))
        fields[f as keyof typeof fields] = entry.fields[f as keyof typeof entry.fields];
    }
  if (appearanceMode.value === 'fandom') {
    if (!entry.fields.fandom.trim()) throw new Error('同人锁定需要先填写或选择同人身份');
    fields.fandom = entry.fields.fandom;
  }
  setAppearancePolicy(entry.name, { mode: appearanceMode.value, fields }, entry);
  recomputeCharTags();
}
function restoreOriginalAppearance() {
  if (!draft.value) return;
  const backup = appearancePolicy(draft.value.name)?.backup;
  if (!backup) {
    feedback.value = '没有套用前的外貌备份';
    return;
  }
  const entry = {
    ...draft.value,
    ...JSON.parse(JSON.stringify(backup)),
    fields: { ...backup.fields, outfit: draft.value.fields.outfit },
    source: 'manual' as const,
  };
  if (!upsertCharTag(entry, selected.value, { recordChanges: true })) {
    feedback.value = '恢复失败，未解除锁定';
    return;
  }
  setAppearancePolicy(entry.name, { mode: 'story', fields: {} });
  recomputeCharTags();
  draft.value = clone(entry);
  appearanceMode.value = 'story';
  protectedFields.value = [];
  adoptLook(entry);
  feedback.value = '已恢复套用前外貌并解除同人锁定，服装记录保留';
  version.value++;
}
const locks = ref<string[]>(['sex', 'age', 'hair', 'eyes', 'body', 'fandom']);
const version = ref(0),
  floor = ref(0),
  customTag = ref(''),
  customZh = ref('');
const appearedNames = computed(() => {
  version.value;
  const entries = charTagLib.entries;
  const names = new Set<string>();
  for (const message of getContext()?.chat || []) {
    const delta = readCharTagFloorDelta(message);
    if (delta?.swipe === (message.swipe_id ?? 0)) for (const op of delta.ops) names.add(op.name);
    for (const tag of parseImageTags(message.mes))
      for (const c of parseImageTagContent(tag).characters) {
        const matches = entries.filter((e) => e.name === c.name || characterAliases(e.name).includes(c.name));
        if (matches.length === 1) names.add(matches[0].name);
      }
  }
  return names;
});
const rows = computed(() =>
  charTagLib.entries
    .filter(
      (e) =>
        charTagBaseNames.has(e.name) ||
        appearedNames.value.has(e.name) ||
        !globalCharTagLib.entries.some((g) => g.name === e.name),
    )
    .filter((e) =>
      (e.name + ' ' + e.desc + ' ' + JSON.stringify(e.fields))
        .toLowerCase()
        .includes(query.value.toLowerCase()),
    ),
);
const look = computed(() => {
  version.value;
  return lookSettings(selected.value);
});
const clothing = computed(() => {
  version.value;
  const ctx = getContext();
  return ctx
    ? [
        ...clothingBefore(ctx.chat, Math.min(floor.value + 1, ctx.chat.length), charTagLib.entries).values(),
      ].find((e) => e.name === selected.value)
    : null;
});

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
function revoke() {
  if (candidateUrl.value) URL.revokeObjectURL(candidateUrl.value);
  candidateUrl.value = '';
  candidateBlob = null;
  candidate.value = null;
}
async function select(name: string) {
  aliasDraft.value = characterAliases(name).join('、');
  if (busy.value) return;
  selected.value = name;
  draft.value = clone(charTagLib.entries.find((e) => e.name === name)!);
  revoke();
  locks.value = lookSettings(name).locks ?? ['sex', 'age', 'hair', 'eyes', 'body', 'fandom'];
  const policy = appearancePolicy(name);
  appearanceMode.value = policy?.mode ?? (isManualFandom(draft.value) ? 'fandom' : 'story');
  protectedFields.value = Object.keys(policy?.fields ?? {}).filter((f) => f !== 'fandom');
  await refreshPortrait();
}
async function refreshPortrait() {
  const name = selected.value,
    key = lookSettings(name).active?.image;
  const image = key ? await getThumb(key) : null;
  if (name !== selected.value) return;
  if (portrait.value) URL.revokeObjectURL(portrait.value);
  portrait.value = image ? URL.createObjectURL(image.blob) : '';
  version.value++;
}
function save() {
  if (!draft.value) return;
  const e = clone(draft.value);
  e.source = 'manual';
  e.desc = '';
  if (appearanceMode.value === 'fandom' && !e.fields.fandom.trim()) throw new Error('请先选择同人身份');
  if (!upsertCharTag(e, selected.value, { recordChanges: true })) throw new Error('名称或外貌不能为空');
  persistPolicy(e);
  selected.value = e.name;
  feedback.value = '已保存档案；与旧定妆不一致时自动停用图片参考';
  saveLook(e.name, { ...lookSettings(e.name), locks: [...locks.value] });
  version.value++;
}
function add() {
  if (busy.value) return;
  draft.value = {
    name: '',
    fields: emptyCharFields(),
    raw: '',
    nl: '',
    source: 'manual',
    desc: '',
    history: [],
  };
  selected.value = '';
  appearanceMode.value = 'story';
  protectedFields.value = [];
  revoke();
  portrait.value = '';
}
async function task(fn: () => Promise<void>) {
  if (busy.value) return;
  const chat = getContext()?.getCurrentChatId?.();
  busy.value = true;
  taskChat = chat;
  controller = new AbortController();
  try {
    await fn();
    if (chat !== getContext()?.getCurrentChatId?.()) throw new Error('聊天已切换，未采用候选');
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    controller = null;
  }
}
async function ask(mode: string) {
  if (!draft.value?.name.trim()) throw new Error('请填写角色名并打开聊天');
  const ctx = getContext();
  if (!ctx) throw new Error('请填写角色名并打开聊天');
  const source = clone(draft.value);
  const at = ctx.chat.length - 1;
  const world = await fetchWorldInfo(ctx.chat, [Math.max(0, at)], ctx.name1, ctx.name2);
  const memory = at >= 0 ? readBookMemory(at, ctx.chat[at].mes, ctx.name1) : null;
  const messages = [
    {
      role: 'system' as const,
      content:
        '为已有角色设计稳定外貌，只返回 JSON {fields:{sex,age,hair,eyes,skin,body,extra,outfit,fandom},desc}。extra 只记录稳定面部特征：轮廓、眼型、眉、鼻唇，不堆通用美女词，不添加服装、表情、动作、画师或画风。英文标签须可靠，不编造复合标签。desc 用中文解释变化与补全。原文明确特征优先；未说明才补全，不能强加痣疤。原姓名、性别、年龄不改。锁定字段原样保留。' +
        (mode === '补全'
          ? '只补空白字段。'
          : mode === '只换脸'
            ? '只重新设计 extra 的面部特征，其他字段不变。'
            : '重新设计未锁定外貌。'),
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        mode,
        role: source,
        locked: locks.value,
        card: fetchCharCard(ctx),
        persona: fetchUserPersona(ctx),
        world,
        memory: memory?.roles,
        story: ctx.chat.slice(-4).map((e) => e.mes.replace(/<bbi_image>[\s\S]*?<\/bbi_image>/g, '')),
        others: charTagLib.entries
          .filter((e) => e.name !== source.name)
          .map((e) => ({ name: e.name, extra: e.fields.extra })),
      }),
    },
  ];
  checkTask();
  const ch = getTagGenChannel();
  const raw = ch
    ? await requestCompletion(ch, messages, {
        signal: controller!.signal,
        source: '角色定妆：' + mode,
      })
    : await requestViaMainApi(messages, {
        signal: controller!.signal,
        source: '角色定妆：' + mode,
      });
  checkTask();
  const clean = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/g, '');
  const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
  const next = clone(source);
  for (const field of CHAR_TAG_FIELDS) {
    if (
      field === 'outfit' ||
      ((field === 'sex' || field === 'age' || locks.value.includes(field)) && !!source.fields[field]) ||
      (mode === '只换脸' && field !== 'extra') ||
      (mode === '补全' && source.fields[field])
    )
      continue;
    const v = parsed.fields?.[field];
    if (typeof v === 'string' && !/[<>\r\n]/.test(v)) next.fields[field] = v.slice(0, 1800);
  }
  if (
    locks.value.includes('eyes') &&
    /tsurime|tareme|jitome|sanpaku|half.closed eyes/i.test(source.fields.eyes)
  )
    next.fields.extra = next.fields.extra
      .split(',')
      .filter((t) => !/tsurime|tareme|jitome|sanpaku|half.closed eyes/i.test(t))
      .join(',');
  next.nl =
    CHAR_TAG_FIELDS.filter((f) => f !== 'outfit')
      .map((f) => next.fields[f])
      .filter(Boolean)
      .join(', ') + '.';
  next.desc = typeof parsed.desc === 'string' ? parsed.desc.slice(0, 3000) : '';
  next.raw = '';
  candidate.value = next;
  feedback.value = '候选已准备好，采用前不改变当前档案';
}
async function draw(entry: CharTagEntry) {
  checkTask();
  if (settings.defaultBackend !== 'nai') throw new Error('请先选用 NAI 渠道；不会自动切换你的模型');
  const fields = isManualFandom(entry) ? ['fandom', 'sex'] : CHAR_TAG_FIELDS.filter((f) => f !== 'outfit');
  const tags =
    fields
      .map((f) => entry.fields[f as keyof typeof entry.fields])
      .filter(Boolean)
      .join(', ') || entry.raw;
  const ctx = getContext(),
    era = ctx ? costumeBefore(ctx.chat, ctx.chat.length) : undefined;
  const outfit =
    era?.era === 'ancient'
      ? era.culture === 'chinese'
        ? 'hanfu'
        : era.culture === 'japanese'
          ? 'kimono'
          : 'plain cloth tunic'
      : 'simple dress';
  const out = await generateImage(
    {
      prompt:
        'solo, full body, standing, facing viewer, centered composition, clothed, simple background, ' +
        outfit +
        ', ' +
        tags,
      nl: entry.nl,
      characters: [],
      size: 'portrait',
      seed: decideSeed('nai', undefined, true),
      suppressCharacterReference: true,
      genPresetId: portraitPreset.value || undefined,
      naiPortraitResolution: portraitResolution.value,
    },
    controller!.signal,
  );
  try {
    const response = await fetch(out.result.url, {
      signal: controller!.signal,
    });
    if (!response.ok) throw new Error('立绘图片读取失败，请稍后重试');
    const blob = await response.blob();
    checkTask();
    if (candidateUrl.value) URL.revokeObjectURL(candidateUrl.value);
    candidateBlob = blob;
    candidateUrl.value = URL.createObjectURL(blob);
    candidate.value = clone(entry);
  } finally {
    out.result.revoke();
  }
  feedback.value = '立绘已生成，满意后采用';
}
async function roll(mode: string) {
  await task(async () => {
    revoke();
    if (mode === '只重画') {
      if (!draft.value) return;
      await draw(draft.value);
    } else {
      await ask(mode);
      if (mode !== '补全' && candidate.value) await draw(candidate.value);
    }
  });
}
async function adopt() {
  if (!candidate.value || busy.value) return;
  const beforeEntry = findCharTag(selected.value) ? clone(findCharTag(selected.value)!) : undefined;
  const entry = clone(candidate.value),
    ctx = getContext(),
    chat = ctx?.getCurrentChatId?.();
  await task(async () => {
    let key: string | undefined;
    if (candidateBlob) {
      key = 'studio:' + crypto.randomUUID();
      await putStudioImage(key, candidateBlob, JSON.stringify(entry.fields));
      if (chat !== getContext()?.getCurrentChatId?.()) return;
    }
    checkTask();
    entry.source = 'manual';
    if (
      !upsertCharTag(entry, selected.value || undefined, {
        recordChanges: true,
      })
    )
      throw new Error('保存失败');
    if (entry.fields.fandom && candidate.value?.source === 'manual') appearanceMode.value = 'fandom';
    else {
      const before = beforeEntry;
      const changed = CHAR_TAG_FIELDS.filter((f) => f !== 'outfit' && entry.fields[f] !== before?.fields[f]);
      if (changed.length) {
        appearanceMode.value = 'manual';
        protectedFields.value = [...new Set([...protectedFields.value, ...changed])];
      }
    }
    persistPolicy(entry);
    adoptLook(entry, key);
    saveLook(entry.name, {
      ...lookSettings(entry.name),
      locks: [...locks.value],
    });
    selected.value = entry.name;
    draft.value = clone(entry);
    revoke();
    await refreshPortrait();
    feedback.value = '已采用定妆，后续默认使用文字档案，无逐图参考费';
  });
}
async function useOnlineFandom(name: string, item: FandomMaterial) {
  await select(name);
  feedback.value = `已将 ${item.name} 套用给 ${name}，同人身份已固定`;
  tab.value = '定妆';
}
function referenceChanged(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  saveLook(selected.value, { ...look.value, reference: enabled });
  version.value++;
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file || !draft.value) return;
  if (file.size > 20 * 1024 * 1024) {
    feedback.value = '图片不能超过 20MB';
    return;
  }
  revoke();
  candidate.value = clone(draft.value);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    feedback.value = '仅支持 PNG/JPEG/WebP';
    return;
  }
  candidateBlob = file;
  candidateUrl.value = URL.createObjectURL(file);
  feedback.value = '已上传为候选；采用后仍默认使用文字定妆';
}
async function restore(v: LookVersion) {
  if (!draft.value) return;
  if (v.policy) {
    appearanceMode.value = v.policy.mode;
    protectedFields.value = Object.keys(v.policy.fields).filter((f) => f !== 'fandom');
  }
  revoke();
  candidate.value = {
    ...clone(draft.value),
    fields: clone(v.fields),
    nl: v.nl,
    raw: v.raw ?? '',
  };
  if (v.image) {
    const image = await getThumb(v.image);
    if (image) {
      candidateBlob = image.blob;
      candidateUrl.value = URL.createObjectURL(image.blob);
    }
  }
  tab.value = '定妆';
}
async function exportStudio() {
  await task(async () => {
    const entries = clone(charTagLib.entries),
      looks: Record<string, unknown> = {},
      images: Record<string, string> = {};
    for (const e of entries) {
      const l = lookSettings(e.name);
      looks[e.name] = l;
      for (const v of [l.active, ...l.history])
        if (v?.image && !images[v.image]) {
          const record = await getThumb(v.image);
          if (record)
            images[v.image] = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error('读取立绘备份失败'));
              reader.readAsDataURL(record.blob);
            });
        }
    }
    checkTask();
    const blob = new Blob(
        [
          JSON.stringify({
            version: 1,
            entries,
            looks,
            images,
            policies: Object.fromEntries(entries.map((e) => [e.name, appearancePolicy(e.name)])),
          }),
        ],
        {
          type: 'application/json',
        },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = '墨影角色与立绘备份.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    feedback.value = '已导出角色、定妆图与历史；自定义词义可在本机继续使用';
  });
}
async function importStudio(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await task(async () => {
    if (file.size > 100 * 1024 * 1024) throw new Error('备份超过 100MB');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 500)
      throw new Error('不是有效的墨影角色备份');
    const keys = new Map<string, string>();
    for (const [old, value] of Object.entries(data.images ?? {})) {
      if (typeof value !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(value)) continue;
      const blob = await (await fetch(value)).blob(),
        key = 'studio:' + crypto.randomUUID();
      await putStudioImage(key, blob, old);
      keys.set(old, key);
    }
    checkTask();
    for (const raw of data.entries) {
      if (typeof raw.name !== 'string' || !raw.name.trim() || !raw.fields) continue;
      const fields = emptyCharFields();
      for (const k of CHAR_TAG_FIELDS)
        if (typeof raw.fields[k] === 'string') fields[k] = raw.fields[k].slice(0, 4000);
      const entry: CharTagEntry = {
        name: raw.name.slice(0, 200),
        fields,
        raw: typeof raw.raw === 'string' ? raw.raw.slice(0, 8000) : '',
        nl: typeof raw.nl === 'string' ? raw.nl.slice(0, 4000) : '',
        desc: '从用户备份导入',
        source: 'manual',
        history: [],
      };
      if (!upsertCharTag(entry, entry.name, { recordChanges: true })) continue;
      const importedPolicy = data.policies?.[entry.name];
      if (importedPolicy && ['story', 'manual', 'fandom'].includes(importedPolicy.mode)) {
        const pinned: Partial<CharTagEntry['fields']> = {};
        for (const f of CHAR_TAG_FIELDS)
          if (
            f !== 'outfit' &&
            typeof importedPolicy.fields?.[f] === 'string' &&
            !/[<>\r\n]/.test(importedPolicy.fields[f])
          )
            pinned[f] = importedPolicy.fields[f].slice(0, 4000);
        setAppearancePolicy(entry.name, { mode: importedPolicy.mode, fields: pinned });
        recomputeCharTags();
      }
      const old = data.looks?.[entry.name];
      if (old) {
        const remap = (v: any) =>
          v && typeof v.id === 'string' && v.fields ? { ...v, image: keys.get(v.image) } : undefined;
        saveLook(entry.name, {
          reference: false,
          strength: 0.6,
          fidelity: 0.5,
          active: remap(old.active),
          history: (Array.isArray(old.history) ? old.history : []).map(remap).filter(Boolean).slice(0, 16),
        });
      }
    }
    version.value++;
    feedback.value = '已导入备份；付费图片参考默认关闭。请选择角色查看';
  });
}
onMounted(async () => {
  try {
    await loadTagChinese();
    dictionaryReady.value = true;
  } catch {
    feedback.value = '本地词库加载失败，暂显示英文；重新打开页面可重试。不会调用 LLM 翻译';
  }
  floor.value = Math.max(0, (getContext()?.chat.length ?? 1) - 1);
  if (rows.value[0]) await select(rows.value[0].name);
});
onUnmounted(() => {
  clearTimeout(zoomTimer);
  controller?.abort();
  revoke();
  if (portrait.value) URL.revokeObjectURL(portrait.value);
});
watch(
  () => getContext()?.getCurrentChatId?.(),
  () => {
    controller?.abort();
    draft.value = null;
    selected.value = '';
    revoke();
  },
);
</script>

<template>
  <section class="bbi-page studio">
    <header class="studio-head">
      <div>
        <h2>角色定妆室</h2>
        <p>定下一张脸，让她走进故事。</p>
      </div>
      <div>
        <button class="bbi-btn" :disabled="busy" @click="add">新建角色</button
        ><button class="bbi-btn" :disabled="busy" @click="exportStudio">备份</button
        ><label class="bbi-btn"
          >导入备份<input type="file" accept="application/json" :disabled="busy" @change="importStudio"
        /></label>
      </div>
    </header>
    <div class="studio-layout">
      <aside>
        <input v-model="query" class="bbi-input" aria-label="搜索角色" placeholder="搜索姓名或外貌标签" />
        <button
          v-for="e in rows"
          :key="e.name"
          class="person"
          :class="{ active: selected === e.name }"
          :disabled="busy"
          @click="select(e.name)"
        >
          <strong>{{ e.name }}</strong
          ><small>{{
            dictionaryReady ? explainTags(e.fields.hair + ', ' + e.fields.eyes) : e.fields.hair
          }}</small>
        </button>
        <p v-if="!rows.length">暂无本聊天角色。剧情分析会自动建档，也可以手动新建。</p>
        <details>
          <summary>跨聊天模板</summary>
          <button
            v-for="e in globalCharTagLib.entries"
            :key="e.name"
            class="bbi-btn"
            :disabled="busy"
            @click="copyGlobalCharTagToChat(e.name)"
          >
            导入 {{ e.name }}
          </button>
        </details>
        <details>
          <summary>身份待核对 · {{ pendingIdentities.length }}</summary>
          <p>仅处理身份不明、冲突或已确认女性但缺档的人物。确认女性会补建档案；这不是每个角色必点的开关。</p>
          <p v-if="!pendingIdentities.length">暂无待核对身份。</p>
          <button
            class="bbi-btn"
            :disabled="busy"
            @click="
              task(async () => {
                await reviewAutomaticProfiles();
              })
            "
          >
            检查错误入库（LLM）</button
          ><button class="bbi-btn" :disabled="busy" @click="undoReview">撤销审核</button>
          <div v-for="fact in pendingIdentities" :key="fact.name">
            <span>{{ fact.name }} · {{ fact.gender }}</span
            ><button class="bbi-btn" @click="confirmIdentity(fact.name, false)">确认男性</button
            ><button class="bbi-btn" @click="confirmIdentity(fact.name, true)">确认女性并补建档案</button>
          </div>
        </details>
      </aside>
      <main v-if="draft">
        <nav>
          <button
            v-for="t in ['档案', '定妆', '穿搭', '历史']"
            :key="t"
            :class="{ active: tab === t }"
            @click="tab = t"
          >
            {{ t }}
          </button>
        </nav>
        <div class="studio-body">
          <fieldset :disabled="busy" class="studio-fields">
            <figure class="portrait">
              <img
                v-if="portrait"
                :src="portrait"
                alt="当前采用的角色立绘，双击放大"
                tabindex="0"
                @dblclick="zoomPortrait()"
                @keydown.enter="zoomPortrait()"
                @click="queuePortraitZoom()"
              />
              <div v-else class="empty-portrait">
                <span>尚未保存立绘</span>
                <p>生成立绘候选，或上传已有的满意图片。</p>
              </div>
              <figcaption>
                {{ selected || '新角色' }} · {{ look.active ? '已保存形象' : '文字档案' }}<br /><small>{{
                  look.reference
                    ? '已请求单人图参考（受模型和版本限制）'
                    : '文字档案＋展示图片 · 图片未参与生成'
                }}</small>
              </figcaption>
            </figure>
            <section v-if="tab === '档案'" class="editor">
              <label>姓名<input v-model="draft.name" class="bbi-input" /></label>
              <label
                >称谓／别名<input
                  v-model="aliasDraft"
                  class="bbi-input"
                  placeholder="例如：千华、风阿姨、风老师，用顿号分隔"
              /></label>
              <button class="bbi-btn" :disabled="!selected" @click="saveAliases">保存称谓关联</button>
              <p>
                只填写确定指向她的称呼；不要使用“她”等代词。同名称谓有多个指向时不自动合并。保存后重新分析使用别称的楼层。
              </p>
              <p>
                勾选锁定项：重 Roll
                时保留（仅约束重设计，不等于剧情保护）。性别和年龄已有值时保留。没有证据的细节由你决定是否补全。
              </p>
              <button
                class="bbi-btn"
                @click="
                  task(async () => {
                    if (draft) {
                      if (!upsertGlobalCharTag({ ...clone(draft), source: 'manual' }))
                        throw new Error('模板保存失败');
                      feedback = '已保存跨聊天模板，需从模板入口导入聊天';
                    }
                  })
                "
              >
                另存为跨聊天模板
              </button>
              <details>
                <summary>查词并添加英文标签（本地免费）</summary>
                <p>
                  通用 Danbooru 中译＋NAI 常用词＋组合解释，不是官方完整 NAI
                  词库。中文只是解释，生成仍发送原始英文；长句和画师人名不保证能翻译。
                </p>
                <input
                  v-model="tagSearch"
                  class="bbi-input"
                  placeholder="搜索中文词义或英文标签，如：眉毛"
                /><select v-model="tagTarget" class="bbi-input">
                  <option v-for="f in CHAR_TAG_FIELDS.filter((f) => f !== 'outfit')" :key="f" :value="f">
                    添加到 {{ CHAR_TAG_FIELD_LABELS[f] }}
                  </option></select
                ><button
                  v-for="[en, zh] in tagMatches"
                  :key="en"
                  class="bbi-btn"
                  :title="en"
                  @click="appendTag(en)"
                >
                  {{ zh }} · {{ en }}
                </button>
                <p v-if="tagSearch && !tagMatches.length">未找到本地词条，可在下方补充词义。</p>
              </details>
              <div class="appearance-policy">
                <label
                  >外貌优先规则<select v-model="appearanceMode" class="bbi-input">
                    <option value="story">解除保护：保留当前形象，允许后续有依据的剧情变化</option>
                    <option value="manual">手动定妆：指定字段高于剧情</option>
                    <option value="fandom">同人锁定：完整替换角色外貌</option>
                  </select></label
                >
                <p>
                  手改字段会自动进入手动保护；采用候选时新增/改变的字段也进入保护。选择模式与保护项后点击保存档案。修改小说原文不会被阻止，只覆盖绘图外貌。重
                  Roll 保留项与剧情保护是两套不同用途。
                </p>
                <button
                  v-if="appearancePolicy(selected)?.backup"
                  class="bbi-btn"
                  @click="restoreOriginalAppearance"
                >
                  恢复套用前外貌并解除锁定
                </button>
                <p v-if="appearanceMode === 'fandom'">
                  同人模式只使用 trigger
                  和下方显式保护的修正词；旧外貌隔离，剧情不再更新固定外貌，服装和临时状态继续记录。
                </p>
                <div v-if="appearanceMode !== 'story'">
                  <label v-for="f in CHAR_TAG_FIELDS.filter((f) => f !== 'outfit' && f !== 'fandom')" :key="f"
                    ><input v-model="protectedFields" type="checkbox" :value="f" />{{
                      CHAR_TAG_FIELD_LABELS[f]
                    }}高于剧情{{ appearanceMode === 'fandom' ? '，同时覆盖同人默认特征' : '' }}</label
                  >
                </div>
              </div>
              <label v-for="f in CHAR_TAG_FIELDS.filter((f) => f !== 'outfit')" :key="f" class="field"
                ><span
                  >{{ f === 'extra' ? '面部与标志特征' : CHAR_TAG_FIELD_LABELS[f]
                  }}<input v-model="locks" type="checkbox" :value="f" />锁定</span
                ><input v-model="draft.fields[f]" class="bbi-input" @input="pinEdited(f)" /><small>{{
                  dictionaryReady ? explainTags(draft.fields[f]) : ''
                }}</small><small>{{ protectedFields.includes(f) && appearanceMode !== 'story' ? '用户锁定' : draft.fieldEvidence?.[f] ? '剧情明确 · ' + draft.fieldEvidence[f] : draft.fields[f] ? '自动补全／历史资料，后续明确描写可校正' : '待补充' }}</small></label
              >
              <label>英文外貌说明<textarea v-model="draft.nl" class="bbi-input" rows="3" /></label>
              <p>
                {{ draft.desc || '原文与用户设定优先。补全候选会显示中文说明。' }}
              </p>
              <details v-if="draft.raw.trim()">
                <summary>旧数据原文（仅此角色有历史标签时显示）</summary>
                <textarea v-model="draft.raw" class="bbi-input" />
              </details>
              <button class="bbi-btn bbi-btn-primary" @click="task(async () => save())">保存档案</button
              ><button class="bbi-btn" @click="roll('补全')">从设定与剧情补全（LLM）</button
              ><button
                class="bbi-btn"
                :disabled="!selected"
                @click="
                  removeCharTag(selected);
                  draft = null;
                  selected = '';
                "
              >
                移出角色库
              </button>
              <details>
                <summary>纠正某个标签的中文解释（可选）</summary>
                <input v-model="customTag" class="bbi-input" placeholder="英文标签" /><input
                  v-model="customZh"
                  class="bbi-input"
                  placeholder="中文解释"
                /><button
                  class="bbi-btn"
                  @click="
                    setTagChinese(customTag, customZh);
                    version++;
                    dictionaryReady = false;
                    dictionaryReady = true;
                  "
                >
                  保存词义
                </button>
              </details>
            </section>
            <section v-else-if="tab === '定妆'" class="editor">
              <h3>高质量立绘与外貌候选</h3>
              <div class="portrait-settings">
                <label
                  >立绘专用生成预设<select v-model="portraitPreset" class="bbi-input">
                    <option value="">使用当前正式配置</option>
                    <option v-for="p in genPresetList()" :key="p.id" :value="p.id">
                      {{ p.name }} · {{ p.model }} · {{ p.steps }}步
                    </option>
                  </select></label
                ><label
                  >立绘竖向分辨率<select v-model="portraitResolution" class="bbi-input">
                    <option value="1024x1536">1024 × 1536</option>
                    <option value="1536x2048">1536 × 2048（高消耗）</option>
                    <option value="2048x2048">2048 × 2048（最高像素，高消耗）</option>
                  </select></label
                >
                <p>
                  先在渠道页保存你满意的高质量模型与参数，再在这里选用；不会擅自换画师或修改剧情生图配置。尺寸、模型和步数越高通常消耗越大，服务端可能拒绝超额参数。
                </p>
              </div>
              <p>
                预览使用当前 NAI 模型与配方，每次一张。中性衣服仅用于立绘，不改剧情穿搭。只重画不请求
                LLM；换脸和重设计会调用 LLM。
              </p>
              <div class="actions">
                <button class="bbi-btn" :disabled="!!draft.fields.fandom" @click="roll('只换脸')">
                  只换脸</button
                ><button class="bbi-btn" :disabled="!!draft.fields.fandom" @click="roll('整体外貌')">
                  重设未锁定外貌</button
                ><button class="bbi-btn" @click="roll('只重画')">生成 / 重画立绘</button
                ><label class="bbi-btn"
                  >上传定妆图<input type="file" accept="image/png,image/jpeg,image/webp" @change="upload"
                /></label>
              </div>
              <small>同人身份非空时锁定完整形象；要恢复原创设计，请先清空同人身份。</small>
              <div v-if="candidate" class="candidate">
                <img
                  v-if="candidateUrl"
                  :src="candidateUrl"
                  alt="立绘候选，双击放大"
                  tabindex="0"
                  @dblclick="zoomPortrait(true)"
                  @click="queuePortraitZoom(true)"
                  @keydown.enter="zoomPortrait(true)"
                />
                <h4>未采用候选</h4>
                <a v-if="candidateUrl" class="bbi-btn" :href="candidateUrl" download="角色立绘候选.png"
                  >下载候选</a
                >
                <p>{{ candidate.desc }}</p>
                <div
                  v-for="f in CHAR_TAG_FIELDS.filter((f) => candidate!.fields[f] !== draft!.fields[f])"
                  :key="f"
                >
                  <strong>{{ CHAR_TAG_FIELD_LABELS[f] }}</strong>
                  <p>
                    {{ explainTags(draft.fields[f]) }} →
                    {{ explainTags(candidate.fields[f]) }}
                  </p>
                </div>
                <button class="bbi-btn bbi-btn-primary" @click="adopt">采用此候选</button
                ><button class="bbi-btn" @click="revoke">丢弃候选</button>
              </div>
              <FandomLibrary @applied="useOnlineFandom" @saved="version++" />

              <div class="reference">
                <h3>让后续生成参考这张图 · 可选付费</h3>
                <p>
                  保存立绘不是训练模型。默认只复用文字档案，人物可能与样图不同；启用图片参考才会把原图发送给
                  NAI，也不能保证完全一致。
                </p>
                <label
                  ><input
                    type="checkbox"
                    :checked="look.reference"
                    :disabled="!look.active?.image"
                    @change="referenceChanged"
                  />单角色剧情图自动携带定妆图</label
                >
                <p>
                  约 +5 Anlas / 张。仅 V4.5、单角色、未启用 Vibe
                  且档案与定妆一致时发送；其他情况回退文字并在详情说明。中转接口是否应用需自行验证。
                </p>
                <p>原图保存在本机浏览器，换设备需重新导入；头像不等于已发送参考。</p>
                <label
                  >参考强度<input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    :value="look.strength"
                    @change="
                      saveLook(selected, {
                        ...look,
                        strength: Number(($event.target as HTMLInputElement).value),
                      });
                      version++;
                    "
                /></label>
              </div>
            </section>
            <section v-else-if="tab === '穿搭'" class="editor">
              <h3>剧情衣物账本</h3>
              <p>选定楼层后，可在下方组合套装；保存套装仅收藏，穿给角色才建立用户覆盖。</p>
              <label
                >查看楼层<input
                  v-model.number="floor"
                  class="bbi-input"
                  type="number"
                  min="0"
                  :max="(getContext()?.chat.length ?? 1) - 1"
              /></label>
              <p v-if="!clothing">该位置尚无已分析的穿搭记录，请先分析对应剧情。</p>
              <p v-if="clothing?.suitMode">
                {{
                  clothing.suitMode === 'always'
                    ? '始终使用用户套装，忽略剧情穿脱'
                    : '已绑定款式，允许有依据的穿脱；明确换装退出绑定'
                }}
              </p>
              <article v-for="p in clothing?.pieces" :key="p.id">
                <h4>{{ explainTags(p.design) }}</h4>
                <code>{{ p.design }}</code>
                <p>
                  {{
                    Object.entries(p.state)
                      .map(([k, v]) => k + '：' + v)
                      .join('；')
                  }}
                </p>
              </article>
              <small>当前穿搭不写进永久面部档案，按楼层剧情继承。</small>
              <WardrobePanel
                v-if="selected"
                :key="selected"
                :name="selected"
                :floor="floor"
                @changed="version++"
              />
            </section>
            <section v-else class="editor">
              <h3>定妆历史</h3>
              <p v-if="!look.history.length">采用新候选后，上一版会自动保留。</p>
              <article v-for="v in look.history" :key="v.id">
                <strong>{{ new Date(v.at).toLocaleString() }}</strong>
                <p>
                  {{ explainTags(v.fields.hair + ', ' + v.fields.eyes + ', ' + v.fields.extra) }}
                </p>
                <button class="bbi-btn" @click="restore(v)">恢复为候选</button>
              </article>
              <h3>档案变更</h3>
              <p v-for="(h, i) in draft.history.slice(-12).reverse()" :key="i">
                {{ h.field }}：{{ explainTags(h.from) }} →
                {{ explainTags(h.to) }}
              </p>
            </section>
          </fieldset>
        </div>
      </main>
      <main v-else class="welcome">
        <h3>为故事里的每个人留下清晰的面貌</h3>
        <p>选择角色，查看中文档案、生成立绘或重新定妆。</p>
      </main>
    </div>
    <footer role="status">
      <span v-if="busy">正在处理，候选不会自动覆盖档案。</span>{{ feedback
      }}<button v-if="busy" class="bbi-btn" @click="controller?.abort()">取消</button>
    </footer>
  </section>
</template>
<style scoped>
.studio-fields {
  display: contents;
}
.studio {
  --studio-accent: #6b83b4;
}
.studio-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.studio-head h2 {
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  font-size: 28px;
  margin: 0;
}
.studio-head p {
  color: var(--bbi-ink-muted);
  margin: 8px 0;
}
.studio-layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 24px;
}
.studio aside {
  border-right: 1px solid var(--bbi-border, #5555);
  padding-right: 16px;
}
.person {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-left: 3px solid transparent;
  color: inherit;
  padding: 14px 12px;
  cursor: pointer;
}
.person.active {
  border-color: var(--studio-accent);
  background: #6b83b41c;
}
.person strong,
.person small {
  display: block;
}
.person small {
  font-size: 11px;
  line-height: 1.6;
  color: var(--bbi-ink-muted);
  margin-top: 6px;
}
.studio nav {
  display: flex;
  border-bottom: 1px solid #8885;
  margin-bottom: 20px;
  gap: 24px;
}
.studio nav button {
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 12px 0;
  color: inherit;
  cursor: pointer;
}
.studio nav button.active {
  border-color: var(--studio-accent);
}
.studio-body {
  display: grid;
  grid-template-columns: minmax(160px, 32%) minmax(0, 1fr);
  gap: 24px;
}
.portrait {
  margin: 0;
  align-self: start;
  position: sticky;
  top: 12px;
}
.portrait img {
  width: 100%;
  max-height: 650px;
  object-fit: contain;
  background: #6b83b410;
  border-radius: 4px;
}
.empty-portrait {
  aspect-ratio: 2/3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
  padding: 20px;
  background: repeating-linear-gradient(45deg, #6b83b40a, #6b83b40a 12px, #6b83b412 12px, #6b83b412 13px);
  border: 1px solid #8883;
}
.empty-portrait span {
  font-family: serif;
  font-size: 22px;
}
.empty-portrait p,
figcaption {
  font-size: 12px;
  line-height: 1.7;
  color: var(--bbi-ink-muted);
}
.editor {
  min-width: 0;
}
.editor label {
  display: block;
  margin: 12px 0;
}
.field > span {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 6px;
}
.field small {
  display: block;
  line-height: 1.7;
  margin-top: 6px;
  color: var(--bbi-ink-muted);
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.candidate {
  border: 1px solid var(--studio-accent);
  padding: 16px;
  margin: 20px 0;
}
.candidate img {
  max-width: 100%;
  max-height: 520px;
  object-fit: contain;
  display: block;
  margin: auto;
}
.reference,
article {
  border-top: 1px solid #8884;
  margin-top: 20px;
  padding-top: 12px;
}
details {
  margin: 20px 0;
}
summary {
  cursor: pointer;
  line-height: 2;
}
.welcome {
  padding: 40px 0;
}
footer {
  position: sticky;
  bottom: 0;
  background: var(--bbi-surface);
  padding: 12px 0;
  line-height: 1.8;
}
button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--studio-accent);
  outline-offset: 3px;
}
input[type='file'] {
  max-width: 160px;
}
.editor .bbi-btn {
  margin: 4px;
}
.editor p {
  line-height: 1.7;
  font-size: 13px;
}
@media (max-width: 720px) {
  .studio-layout {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .studio aside {
    border: 0;
    max-height: 180px;
    overflow: auto;
  }
  .studio-body {
    grid-template-columns: 1fr;
  }
  .portrait {
    position: static;
  }
  .portrait img,
  .empty-portrait {
    max-height: 320px;
    max-width: 240px;
    margin: auto;
  }
  .studio-head h2 {
    font-size: 24px;
  }
  .studio nav {
    gap: 28px;
  }
  .portrait figcaption {
    text-align: center;
  }
}
</style>

<style scoped>
.studio-head > div:last-child {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.studio-head .bbi-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  min-height: 36px;
  margin: 0;
  padding: 0 14px;
  font-size: 13px;
  line-height: 1;
  position: relative;
  cursor: pointer;
}
.studio-head input[type='file'],
.actions label input[type='file'] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.studio-head label.bbi-btn,
.actions label.bbi-btn {
  position: relative;
  overflow: hidden;
}
.portrait {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.portrait img {
  display: block;
  margin: 0 auto;
  object-position: center;
  cursor: zoom-in;
  width: 100%;
}
.candidate img {
  cursor: zoom-in;
  object-position: center;
}
.studio-body {
  align-items: start;
}
.portrait-settings {
  padding: 16px;
  background: color-mix(in srgb, var(--bbi-surface) 90%, #7b96b0);
  border: 1px solid #8295b433;
  border-radius: 8px;
  margin-bottom: 18px;
}
.portrait-settings p {
  color: var(--bbi-ink-muted);
}
.editor h3 {
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  font-size: 19px;
}
.studio nav button {
  min-width: 50px;
}
.studio .field {
  padding-bottom: 12px;
  border-bottom: 1px solid #8882;
}
.studio .field small {
  line-height: 1.85;
}
.studio .portrait figcaption {
  padding: 12px 4px;
}
.candidate {
  border-radius: 8px;
}
.studio-head {
  gap: 16px;
  flex-wrap: wrap;
}
.studio .actions {
  align-items: center;
}
.studio .actions .bbi-btn {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  margin: 0;
  position: relative;
}
.studio .actions label {
  margin: 0;
}
@media (max-width: 720px) {
  .studio-head > div:last-child {
    justify-content: flex-start;
  }
  .portrait {
    width: 100%;
  }
  .portrait img {
    max-height: 440px;
    max-width: 100%;
  }
  .studio .editor {
    width: 100%;
  }
}
</style>

<style scoped>
.appearance-policy {
  border: 1px solid #7e94ae66;
  border-radius: 8px;
  padding: 14px;
  margin: 16px 0;
  background: #819abb0b;
}
.appearance-policy > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.appearance-policy > div label {
  font-size: 12px;
  margin: 4px 0;
}
.appearance-policy p {
  font-size: 12px;
  color: var(--bbi-ink-muted);
}
</style>
