<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import { BODY_PRESETS, FACE_PRESETS, FANDOM_PRESETS } from '@/data/faceBank';
import { BODY_EXTRA, FACE_EXTRA, FANDOM_EXTRA } from '@/data/faceExtra';
import { POSE_CATEGORIES } from '@/data/poseBank';
import { WARDROBE_CATEGORIES } from '@/data/wardrobe';
import {
  addCustomPose,
  addCustomWardrobe,
  clearCustomLore,
  exportCustomLoreJson,
  guessWardrobeCategory,
  guessWardrobeSlot,
  importCustomLoreJson,
  parseTagBundle,
  removeCustomLore,
  updateCustomPose,
  updateCustomWardrobe,
  WARDROBE_SLOT_LABELS,
} from '@/data/customLore';
import { allPoseItems, allWardrobeItems } from '@/data/loreIndex';
import {
  clearThumbs,
  countThumbs,
  deleteThumb,
  getThumb,
  putThumb,
  thumbKey,
  type ThumbKind,
} from '@/data/loreThumbs';
import { backendStatus, decideSeed, generateImage } from '@/generate';
import { settings } from '@/state/settings';
import type { NsfwLevel, PoseCategoryId, WardrobeSlot } from '@/data/loreTypes';
import {
  CHAR_TAG_FIELD_LABELS,
  charTagLib,
  findCharTag,
  upsertCharTag,
  type CharTagEntry,
  type CharTagField,
} from '@/state/charTags';
import { computed, onUnmounted, ref, watch } from 'vue';

/**
 * 素材库 —— 服装 / 姿势 / 面相候选库的浏览与套用页。
 *
 * 三件事:
 * 1) 浏览:自动 tag 用的那些库(wardrobe.ts / poseBank.ts / faceBank.ts)在设置页里看不到,
 *    用户没法判断「黑丝到底有几种」。这里按分类平铺,一眼能看出库里到底存了什么。
 * 2) 套用:点一条服装/面相,直接写进角色管理里某个角色的固定字段,后续每次出图都带这串。
 *    写入走 charTags 的 upsertCharTag(recordChanges:true),与手改角色走同一条路,
 *    角色历史里能查到这次改动、也能回滚。
 * 3) 复制:姿势这类不属于角色属性的条目只提供复制,方便贴到提示词编辑器里手改。
 */

type Tab = 'wardrobe' | 'pose' | 'face';

const TABS: { value: Tab; label: string }[] = [
  { value: 'wardrobe', label: '服装' },
  { value: 'pose', label: '姿势' },
  { value: 'face', label: '面相' },
];

/** 卡片视图模型:三套库形状不同,统一压成这一种,模板只认它。 */
interface LoreCard {
  id: string;
  name: string;
  tags: string;
  aliases: string[];
  nsfw: number;
  quality?: number;
  note?: string;
  /** 机位 / 气质 / 阶段这类不进 tag 串的补充信息 */
  extra: string;
  /** 「套用到角色」默认写进哪个字段 */
  field: CharTagField;
  group: string;
  groupLabel: string;
  /** 用户自己导入的条目（id 以 u-/up- 开头），可以删除 */
  custom?: boolean;
  /** 姿势条目自带的最佳机位，编辑时要能回填 */
  camera?: string;
  /** 服装条目挂的部位，编辑时要能回填 */
  slot?: WardrobeSlot;
}

const WARDROBE_LABEL = new Map<string, string>(WARDROBE_CATEGORIES.map(c => [c.id, c.label]));
const POSE_LABEL = new Map<string, string>(POSE_CATEGORIES.map(c => [c.id, c.label]));

/** 自定义条目改动后自增,用来让 computed 重新读 localStorage(它本身不是响应式的)。 */
const revision = ref(0);
function bumpLore() {
  revision.value += 1;
}

const wardrobeCards = computed<LoreCard[]>(() => {
  revision.value;
  return allWardrobeItems().map(item => ({
    id: item.id,
    name: item.name,
    tags: item.tags,
    aliases: item.aliases,
    nsfw: item.nsfw,
    quality: item.quality,
    note: item.note,
    extra: item.vibe?.length ? `气质 ${item.vibe.join(' / ')}` : '',
    field: 'outfit',
    group: item.category,
    groupLabel: WARDROBE_LABEL.get(item.category) ?? item.category,
    custom: isCustomId(item.id),
    slot: item.slot,
  }));
});

const poseCards = computed<LoreCard[]>(() => {
  revision.value;
  return allPoseItems().map(item => ({
    id: item.id,
    name: item.name,
    tags: item.tags,
    aliases: item.aliases,
    nsfw: item.nsfw,
    quality: item.quality,
    note: item.note,
    extra: [
      item.camera ? `机位 ${item.camera}` : '',
      item.direction ?? '',
      item.stage ? `阶段 ${item.stage}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    field: 'outfit',
    group: item.category,
    groupLabel: POSE_LABEL.get(item.category) ?? item.category,
    custom: isCustomId(item.id),
    camera: item.camera,
  }));
});

const faceCards: LoreCard[] = [
  ...[...FACE_PRESETS, ...FACE_EXTRA].map(item => ({
    id: item.id,
    name: item.name,
    tags: item.tags,
    aliases: item.aliases,
    nsfw: item.nsfw,
    quality: item.quality,
    note: item.note,
    extra: item.vibe?.length ? `气质 ${item.vibe.join(' / ')}` : '',
    field: 'extra' as CharTagField,
    group: 'face',
    groupLabel: '脸部指纹',
  })),
  ...[...BODY_PRESETS, ...BODY_EXTRA].map(item => ({
    id: item.id,
    name: item.name,
    tags: item.tags,
    aliases: item.aliases,
    nsfw: item.nsfw,
    quality: item.quality,
    note: item.note,
    extra: '',
    field: 'body' as CharTagField,
    group: 'body',
    groupLabel: '体型',
  })),
  ...[...FANDOM_PRESETS, ...FANDOM_EXTRA].map(item => ({
    id: item.id,
    name: item.name,
    tags: item.tags,
    aliases: item.aliases,
    nsfw: item.nsfw,
    quality: item.quality,
    note: item.note,
    extra: [item.franchise, item.hair, item.eyes, item.companion].filter(Boolean).join(' · '),
    field: 'fandom' as CharTagField,
    group: 'fandom',
    groupLabel: '同人 tag',
  })),
];

const tab = ref<Tab>('wardrobe');
/** 浏览时的尺度上限:库里有 nsfw 3 的条目,翻页时未必想让它们全铺出来。 */
const maxNsfwFilter = ref(3);
const keyword = ref('');
const activeCategory = ref('all');
const flash = ref('');
let flashTimer: number | undefined;

/** 自定义条目的 id 前缀：u- 服装 / up- 姿势，内置表不会用这两个前缀。 */
function isCustomId(id: string): boolean {
  return id.startsWith('u-') || id.startsWith('up-');
}

const SLOT_OPTIONS = Object.entries(WARDROBE_SLOT_LABELS).map(([id, label]) => ({ id, label }));

const allCards = computed<LoreCard[]>(() => {
  if (tab.value === 'wardrobe') return wardrobeCards.value;
  if (tab.value === 'pose') return poseCards.value;
  return faceCards;
});

/** 关键字命中:名字 / tag 串 / 中文触发词,任一含子串即算。 */
const searched = computed<LoreCard[]>(() => {
  const q = keyword.value.trim().toLowerCase();
  const pool = maxNsfwFilter.value >= 3
    ? allCards.value
    : allCards.value.filter(card => card.nsfw <= maxNsfwFilter.value);
  if (!q) return pool;
  return pool.filter(card => {
    const hay = `${card.name}\n${card.tags}\n${card.aliases.join(' ')}\n${card.extra}`.toLowerCase();
    return hay.includes(q);
  });
});

const categories = computed<{ id: string; label: string; count: number }[]>(() => {
  const counts = new Map<string, { label: string; count: number }>();
  for (const card of searched.value) {
    const hit = counts.get(card.group);
    if (hit) hit.count += 1;
    else counts.set(card.group, { label: card.groupLabel, count: 1 });
  }
  return [...counts.entries()].map(([id, v]) => ({ id, label: v.label, count: v.count }));
});

const shown = computed<LoreCard[]>(() =>
  activeCategory.value === 'all'
    ? searched.value
    : searched.value.filter(card => card.group === activeCategory.value),
);

// 换 tab / 改关键字后分类可能整组消失,把选中态收回「全部」,避免停在一个不存在的分类上。
function pickTab(next: Tab) {
  tab.value = next;
  activeCategory.value = 'all';
}

const NSFW_TEXT: Record<number, string> = { 1: '微诱惑', 2: '情趣', 3: 'NSFW' };

/* —— 预览图：只有点过「生成预览」的条目才有，缓存在 IndexedDB，翻页不重画 —— */
const thumbSrcMap = ref<Record<string, string>>({});
const thumbBusy = ref<Record<string, boolean>>({});
const thumbCount = ref(0);

function thumbKindOf(): ThumbKind {
  return tab.value === 'pose' ? 'pose' : tab.value === 'face' ? 'face' : 'wardrobe';
}

function cardKey(card: LoreCard): string {
  return thumbKey(thumbKindOf(), card.id);
}

function thumbSrc(card: LoreCard): string | undefined {
  return thumbSrcMap.value[cardKey(card)];
}

function isThumbBusy(card: LoreCard): boolean {
  return !!thumbBusy.value[cardKey(card)];
}

function setThumbBusy(key: string, busy: boolean) {
  const next = { ...thumbBusy.value };
  if (busy) next[key] = true;
  else delete next[key];
  thumbBusy.value = next;
}

function mountThumb(key: string, blob: Blob) {
  const old = thumbSrcMap.value[key];
  if (old) URL.revokeObjectURL(old);
  thumbSrcMap.value = { ...thumbSrcMap.value, [key]: URL.createObjectURL(blob) };
}

/** 当前列表里已缓存过的预览一次性挂上(只读不画，不花钱)。 */
const thumbChecked = new Set<string>();

async function syncThumbs(list: LoreCard[]) {
  const kind = thumbKindOf();
  for (const card of list) {
    const key = thumbKey(kind, card.id);
    if (thumbSrcMap.value[key]) continue;
    // 查过一次没图的条目不必每次搜索都再查一遍(IndexedDB 往返虽然快，但搜索每敲一个字都会触发)
    if (thumbChecked.has(key)) continue;
    thumbChecked.add(key);
    const record = await getThumb(key);
    if (record && record.blob) mountThumb(key, record.blob);
  }
}

watch(shown, list => {
  void syncThumbs(list);
}, { immediate: true });

/** 预览提示词：一条素材要能被单独看懂，所以固定主体与背景，只换它自己的 tag。 */
function thumbPrompt(card: LoreCard): string {
  const base = 'masterpiece, best quality, very aesthetic, absurdres, 1girl, solo, cowboy shot, simple background, grey background';
  const nude = tab.value === 'pose' ? 'completely nude' : '';
  return [base, nude, card.tags].filter(Boolean).join(', ');
}

async function genThumb(card: LoreCard) {
  const status = backendStatus();
  if (!status.configured) {
    toast(`后端还没配好：${status.reason || '先去「渠道」页配置'}`);
    return;
  }
  const key = cardKey(card);
  if (thumbBusy.value[key]) return;
  setThumbBusy(key, true);
  const prompt = thumbPrompt(card);
  try {
    const output = await generateImage({
      prompt,
      seed: decideSeed(settings.defaultBackend),
      size: 'portrait',
    });
    const blob = await fetch(output.result.url).then(response => response.blob());
    output.result.revoke();
    await putThumb(key, blob, prompt);
    mountThumb(key, blob);
    thumbCount.value = await countThumbs();
  } catch (error) {
    toast(error instanceof Error ? error.message : '生成预览失败');
  } finally {
    setThumbBusy(key, false);
  }
}

/** 批量走串行:NAI 有并发闸门,并发发出去只会在闸门里排队,不如一条条来好显示进度。 */
async function genVisibleThumbs() {
  const status = backendStatus();
  if (!status.configured) {
    toast(`后端还没配好：${status.reason || '先去「渠道」页配置'}`);
    return;
  }
  const pending = shown.value.filter(card => !thumbSrc(card));
  if (!pending.length) {
    toast('当前列表都已有预览');
    return;
  }
  toast(`开始生成 ${pending.length} 张预览`);
  for (const card of pending) {
    if (!thumbSrc(card)) await genThumb(card);
  }
}

async function dropThumb(card: LoreCard) {
  const key = cardKey(card);
  await deleteThumb(key);
  const url = thumbSrcMap.value[key];
  if (url) URL.revokeObjectURL(url);
  const next = { ...thumbSrcMap.value };
  delete next[key];
  thumbSrcMap.value = next;
  thumbCount.value = await countThumbs();
}

async function clearAllThumbs() {
  if (!window.confirm('清空所有素材预览图？下次点生成会重新消耗 NAI 额度。')) return;
  await clearThumbs();
  Object.values(thumbSrcMap.value).forEach(url => URL.revokeObjectURL(url));
  thumbSrcMap.value = {};
  thumbCount.value = 0;
}

onUnmounted(() => {
  Object.values(thumbSrcMap.value).forEach(url => URL.revokeObjectURL(url));
});

/* —— 套用到角色 —— */
const applying = ref<LoreCard | null>(null);
const applyField = ref<CharTagField>('outfit');
const applyMode = ref<'append' | 'replace'>('append');
const FIELD_OPTIONS: CharTagField[] = [
  'outfit',
  'extra',
  'hair',
  'eyes',
  'body',
  'skin',
  'fandom',
];

const characters = computed<CharTagEntry[]>(() => charTagLib.entries);

function startApply(card: LoreCard) {
  applying.value = card;
  applyField.value = card.field;
  applyMode.value = card.tags.split(',').length > 3 ? 'replace' : 'append';
  flash.value = '';
}

function cancelApply() {
  applying.value = null;
  flash.value = '';
}

function currentValue(name: string): string {
  const entry = findCharTag(name);
  if (!entry) return '';
  return (entry.fields[applyField.value] ?? '').trim();
}

function applyTo(name: string, card: LoreCard | null) {
  if (!card) return;
  const target = findCharTag(name);
  if (!target) return;
  const field = applyField.value;
  const before = (target.fields[field] ?? '').trim();
  const merged =
    applyMode.value === 'append' && before
      ? `${before}, ${card.tags}`
      : card.tags;
  const next: CharTagEntry = {
    ...target,
    fields: { ...target.fields, [field]: merged },
  };
  const ok = upsertCharTag(next, name, { recordChanges: true });
  flash.value = ok
    ? `已写入「${name}」的「${CHAR_TAG_FIELD_LABELS[field]}」`
    : `「${name}」还没有任何外貌字段,先在角色管理里填一项再套用`;
  if (ok) {
    if (flashTimer) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      applying.value = null;
      flash.value = '';
    }, 900);
  }
}

async function copyTags(card: LoreCard) {
  try {
    await navigator.clipboard.writeText(card.tags);
    flash.value = '';
    toast(`已复制「${card.name}」的 tag 串`);
  } catch (error) {
    console.warn('[柏宝绘] 复制失败', error);
  }
}

const toastText = ref('');
let toastTimer: number | undefined;
function toast(text: string) {
  toastText.value = text;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastText.value = '';
  }, 1800);
}

/* —— 自定义素材：新增 / 导入 / 导出 / 删除 —— */
const addingOpen = ref(false);
const addingKind = ref<'wardrobe' | 'pose'>('wardrobe');
const draftName = ref('');
const draftTags = ref('');
const draftAliases = ref('');
const draftCategory = ref('');
const draftSlot = ref<WardrobeSlot>('full');
const draftNsfw = ref(2);
const draftCamera = ref('');
const draftNote = ref('');
const pasteRaw = ref('');

/**
 * 把网上分享的「英文 tag（中文说明）」整段贴进来，一次填好名称、tag 串、触发词、分类和部位。
 * 这类文本里英文 tag 决定画得准不准，括号里的中文既是给用户看的说明，也正好是正文会
 * 出现的触发词——所以直接拿来当 aliases，比让人再手打一遍更靠谱。
 */
function applyPaste() {
  const draft = parseTagBundle(pasteRaw.value);
  if (!draft.tags) {
    toast('没解析到英文 tag：这段是不是只有中文？');
    return;
  }
  if (!draftName.value.trim() && draft.name) draftName.value = draft.name;
  draftTags.value = draft.tags;
  if (!draftAliases.value.trim() && draft.aliases.length) draftAliases.value = draft.aliases.join(', ');
  if (addingKind.value === 'wardrobe') {
    draftCategory.value = guessWardrobeCategory(draft.tags, draft.aliases);
    draftSlot.value = guessWardrobeSlot(draft.tags, draft.aliases) as WardrobeSlot;
  }
  const tagCount = draft.tags.split(',').length;
  toast(`解析出 ${tagCount} 个 tag、${draft.aliases.length} 个中文触发词`);
}

function openAdd() {
  editingId.value = null;
  addingKind.value = tab.value === 'pose' ? 'pose' : 'wardrobe';
  draftName.value = '';
  draftTags.value = '';
  draftAliases.value = '';
  draftCategory.value = addingKind.value === 'pose' ? POSE_CATEGORIES[0].id : WARDROBE_CATEGORIES[0].id;
  draftSlot.value = 'full';
  draftNsfw.value = 2;
  draftCamera.value = '';
  draftNote.value = '';
  pasteRaw.value = '';
  addingOpen.value = true;
}

/** 切换服装/姿势时分类下拉的选项整组换掉,顺手把选中值收回到第一项。 */
function switchKind(kind: 'wardrobe' | 'pose') {
  addingKind.value = kind;
  draftCategory.value = kind === 'pose' ? POSE_CATEGORIES[0].id : WARDROBE_CATEGORIES[0].id;
}

const editingId = ref<string | null>(null);

/**
 * 编辑已有条目:回填同一套表单。
 * id 不改,所以已经生成的预览图继续对新内容生效——改错分类不必重画。
 */
function openEdit(card: LoreCard) {
  const pose = tab.value === 'pose';
  editingId.value = card.id;
  addingKind.value = pose ? 'pose' : 'wardrobe';
  draftName.value = card.name;
  draftTags.value = card.tags;
  draftAliases.value = card.aliases.join(', ');
  draftCategory.value = card.group;
  draftSlot.value = card.slot ?? 'full';
  draftNsfw.value = card.nsfw;
  draftCamera.value = card.camera ?? '';
  draftNote.value = card.note ?? '';
  pasteRaw.value = '';
  addingOpen.value = true;
}

function submitAdd() {
  const nsfw = Math.min(3, Math.max(0, Math.round(Number(draftNsfw.value) || 0))) as NsfwLevel;
  const editing = editingId.value;
  if (addingKind.value === 'pose') {
    const payload = {
      name: draftName.value,
      tags: draftTags.value,
      aliases: draftAliases.value,
      category: draftCategory.value as PoseCategoryId,
      nsfw: (nsfw === 0 ? 1 : nsfw) as NsfwLevel,
      camera: draftCamera.value,
      note: draftNote.value,
    };
    const result = editing ? updateCustomPose(editing, payload) : addCustomPose(payload);
    if (!result.ok) {
      toast(result.error ?? '保存失败');
      return;
    }
    tab.value = 'pose';
  } else {
    const payload = {
      name: draftName.value,
      tags: draftTags.value,
      aliases: draftAliases.value,
      category: draftCategory.value,
      slot: draftSlot.value,
      nsfw,
      note: draftNote.value,
    };
    const result = editing ? updateCustomWardrobe(editing, payload) : addCustomWardrobe(payload);
    if (!result.ok) {
      toast(result.error ?? '保存失败');
      return;
    }
    tab.value = 'wardrobe';
  }
  bumpLore();
  addingOpen.value = false;
  activeCategory.value = 'all';
  toast(editing ? '已更新这一条' : '已加入素材库，下一次自动 tag 就能召回它');
  editingId.value = null;
}

const importOpen = ref(false);
const importText = ref('');

function openImport() {
  importOpen.value = true;
  importText.value = '';
}

function submitImport() {
  const report = importCustomLoreJson(importText.value);
  if (report.error) {
    toast(report.error);
    return;
  }
  bumpLore();
  importOpen.value = false;
  toast(
    `导入完成：服装 +${report.wardrobe}，姿势 +${report.poses}${report.skipped ? `，跳过 ${report.skipped}` : ''}`,
  );
}

async function copyAllCustom() {
  try {
    await navigator.clipboard.writeText(exportCustomLoreJson());
    toast('已复制全部自定义条目（可直接存成 .json 当备份）');
  } catch (error) {
    console.warn('[柏宝绘] 导出失败', error);
    toast('浏览器拦了剪贴板，请允许后重试');
  }
}

function removeCard(card: LoreCard) {
  const kind = tab.value === 'pose' ? 'pose' : 'wardrobe';
  if (!removeCustomLore(kind, card.id)) return;
  bumpLore();
  toast(`已删除「${card.name}」`);
}

function clearCustom() {
  if (!window.confirm('清空全部自定义素材？（内置条目不受影响，清空前建议先点「导出」备份）')) return;
  clearCustomLore();
  bumpLore();
  toast('已清空全部自定义条目（内置条目不受影响）');
}
</script>

<template>
  <section class="bbi-page">
    <div class="bbi-page-head">
      <h2 class="bbi-title bbi-title-sub">素材库</h2>
      <span class="bbi-lore-count">{{ allCards.length }} 条</span>
    </div>
    <hr class="bbi-rule" />
    <p class="bbi-page-intro">
      自动 tag 时按正文命中挑候选的就是这里的条目。服装与面相可以直接套到角色管理里的人物身上，写进他的固定字段，之后每次出图都带这一串。
    </p>

    <div class="bbi-lore-bar">
      <div class="bbi-segmented" role="tablist" aria-label="素材类型">
        <button
          v-for="t in TABS"
          :key="t.value"
          class="bbi-seg"
          :class="{ 'is-on': tab === t.value }"
          type="button"
          role="tab"
          :aria-selected="tab === t.value"
          @click="pickTab(t.value)"
        >
          {{ t.label }}
        </button>
      </div>
      <input
        v-model="keyword"
        class="bbi-input bbi-lore-search"
        type="search"
        placeholder="搜名字 / tag / 中文触发词"
      />
      <div class="bbi-lore-tools">
        <select v-model.number="maxNsfwFilter" class="bbi-input bbi-lore-scale" title="浏览尺度上限">
          <option :value="1">日常</option>
          <option :value="2">到情趣</option>
          <option :value="3">全部</option>
        </select>
        <button class="bbi-btn bbi-btn-sm bbi-btn-primary" type="button" @click="openAdd">
          新增
        </button>
        <button class="bbi-btn bbi-btn-sm" type="button" @click="openImport">导入</button>
        <button class="bbi-btn bbi-btn-sm" type="button" @click="copyAllCustom">导出</button>
        <button class="bbi-btn bbi-btn-sm" type="button" title="为当前列表里还没有预览的条目生成一张小图（每条消耗一次 NAI 额度）" @click="genVisibleThumbs">
          批量预览
        </button>
        <button class="bbi-btn bbi-btn-sm" type="button" @click="clearAllThumbs">清空预览</button>
        <button class="bbi-btn bbi-btn-sm" type="button" @click="clearCustom">清空自定义</button>
      </div>
    </div>

    <div class="bbi-lore-cats">
      <button
        class="bbi-lore-cat"
        :class="{ 'is-on': activeCategory === 'all' }"
        type="button"
        @click="activeCategory = 'all'"
      >
        全部<span>{{ searched.length }}</span>
      </button>
      <button
        v-for="c in categories"
        :key="c.id"
        class="bbi-lore-cat"
        :class="{ 'is-on': activeCategory === c.id }"
        type="button"
        @click="activeCategory = c.id"
      >
        {{ c.label }}<span>{{ c.count }}</span>
      </button>
    </div>

    <div v-if="shown.length" class="bbi-lore-grid">
      <article v-for="card in shown" :key="card.id" class="bbi-lore-card">
        <header class="bbi-lore-card-head">
          <span class="bbi-lore-name">{{ card.name }}</span>
          <span v-if="card.nsfw" class="bbi-lore-nsfw" :class="`lv${card.nsfw}`">
            {{ NSFW_TEXT[card.nsfw] ?? 'NSFW' }}
          </span>
          <span v-if="card.quality" class="bbi-lore-q" title="表现力权重">Q{{ card.quality }}</span>
        </header>
        <figure v-if="thumbSrc(card)" class="bbi-lore-thumb">
          <img :src="thumbSrc(card) || ''" :alt="card.name" loading="lazy" />
          <button
            class="bbi-lore-thumb-x"
            type="button"
            title="删掉这张预览"
            @click="dropThumb(card)"
          >
            ×
          </button>
        </figure>
        <button
          v-else
          class="bbi-btn bbi-btn-sm bbi-lore-thumb-make"
          type="button"
          :disabled="isThumbBusy(card)"
          title="按这条素材的 tag 单独生成一张预览（消耗一次 NAI 额度，之后会缓存）"
          @click="genThumb(card)"
        >
          {{ isThumbBusy(card) ? '生成中…' : '生成预览' }}
        </button>
        <p class="bbi-lore-tags">{{ card.tags }}</p>
        <p v-if="card.extra" class="bbi-lore-extra">{{ card.extra }}</p>
        <p v-if="card.note" class="bbi-lore-note">{{ card.note }}</p>
        <footer class="bbi-lore-card-foot">
          <span class="bbi-lore-alias">{{ card.aliases.join(' / ') }}</span>
          <span class="bbi-lore-acts">
            <button class="bbi-btn bbi-btn-sm" type="button" @click="copyTags(card)">复制</button>
            <button
              v-if="card.custom"
              class="bbi-btn bbi-btn-sm"
              type="button"
              title="改名称、tag、分类或触发词"
              @click="openEdit(card)"
            >
              编辑
            </button>
            <button
              v-if="card.custom"
              class="bbi-btn bbi-btn-sm bbi-lore-del"
              type="button"
              title="删除这条自定义素材"
              @click="removeCard(card)"
            >
              删除
            </button>
            <button
              v-if="tab !== 'pose'"
              class="bbi-btn bbi-btn-primary bbi-btn-sm"
              type="button"
              @click="startApply(card)"
            >
              <Icon name="characters" /> 套用
            </button>
          </span>
        </footer>
      </article>
    </div>
    <p v-else class="bbi-field-hint">没有匹配的条目，换个词或切回「全部」。</p>

    <ModalMask :open="!!applying" @close="cancelApply">
      <div
        v-if="applying"
        class="bbi-modal bbi-lore-modal"
        role="dialog"
        aria-modal="true"
        aria-label="套用到角色"
      >
        <header class="bbi-modal-head">
          <span class="bbi-modal-title">{{ applying.name }}</span>
          <button class="bbi-modal-x" type="button" aria-label="关闭" @click="cancelApply">
            <Icon name="close" />
          </button>
        </header>

        <p class="bbi-lore-tags">{{ applying.tags }}</p>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">写入字段</span>
          <select v-model="applyField" class="bbi-input">
            <option v-for="f in FIELD_OPTIONS" :key="f" :value="f">
              {{ CHAR_TAG_FIELD_LABELS[f] }}
            </option>
          </select>
        </label>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">写入方式</span>
          <select v-model="applyMode" class="bbi-input">
            <option value="append">追加在原值之后</option>
            <option value="replace">覆盖原值</option>
          </select>
        </label>

        <div class="bbi-modal-field">
          <span class="bbi-modal-label">选择角色</span>
          <div v-if="characters.length" class="bbi-lore-chars">
            <button
              v-for="c in characters"
              :key="c.name"
              class="bbi-lore-char"
              type="button"
              @click="applyTo(c.name, applying)"
            >
              <span class="bbi-lore-char-name">{{ c.name }}</span>
              <span class="bbi-lore-char-hint">{{ currentValue(c.name) || '该字段为空' }}</span>
            </button>
          </div>
          <p v-else class="bbi-field-hint">
            角色管理里还没有人物。先去「角色管理」建档,或让自动 tag 跑一楼生成角色档案。
          </p>
        </div>

        <p v-if="flash" class="bbi-lore-flash">{{ flash }}</p>
      </div>
    </ModalMask>

    <ModalMask :open="addingOpen" @close="addingOpen = false">
      <div v-if="addingOpen" class="bbi-modal bbi-lore-modal" role="dialog" aria-modal="true" :aria-label="editingId ? '编辑素材' : '新增素材'">
        <header class="bbi-modal-head">
          <span class="bbi-modal-title">{{ editingId ? '编辑素材' : '新增素材' }}</span>
          <button class="bbi-modal-x" type="button" aria-label="关闭" @click="addingOpen = false">
            <Icon name="close" />
          </button>
        </header>

        <div class="bbi-lore-kind">
          <button
            class="bbi-btn bbi-btn-sm"
            :class="{ 'bbi-btn-primary': addingKind === 'wardrobe' }"
            type="button"
            @click="switchKind('wardrobe')"
          >
            服装
          </button>
          <button
            class="bbi-btn bbi-btn-sm"
            :class="{ 'bbi-btn-primary': addingKind === 'pose' }"
            type="button"
            @click="switchKind('pose')"
          >
            姿势
          </button>
        </div>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">从 tag 串填充（可选）</span>
          <textarea
            v-model="pasteRaw"
            class="bbi-input bbi-lore-json"
            rows="3"
            placeholder="champagne_tulle_gown（香槟色薄纱晚礼服）, halter_neckline（挂脖领口）, sequin_embroidery（亮片刺绣）"
          />
          <span class="bbi-field-hint">
            从别处复制的一整段「英文 tag（中文说明）」直接贴这里，点下面解析：会自动剥掉括号、把中文说明变触发词、并猜分类与部位。之后还能手动改。
          </span>
          <button class="bbi-btn bbi-btn-sm" type="button" @click="applyPaste">解析并填入下方</button>
        </label>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">名称</span>
          <input v-model="draftName" class="bbi-input" type="text" placeholder="比如：黑丝袜口卷落" />
        </label>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">danbooru tag 串（逗号分隔）</span>
          <textarea
            v-model="draftTags"
            class="bbi-input"
            rows="3"
            placeholder="black thighhighs, sheer legwear, rolled down, glossy texture"
          />
          <span class="bbi-field-hint">
            用英文 danbooru tag，逗号分隔。这串会被原样写进生图提示词，所以越具体越好（版型 + 面料 + 细节）。
          </span>
        </label>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">中文触发词（描述里出现这些词就会召回）</span>
          <input
            v-model="draftAliases"
            class="bbi-input"
            type="text"
            placeholder="黑丝, 袜口滑落, 卷边"
          />
          <span class="bbi-field-hint">逗号或顿号分隔，至少一个，两个汉字以上。</span>
        </label>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">分类</span>
          <select v-model="draftCategory" class="bbi-input">
            <option
              v-for="c in addingKind === 'pose' ? POSE_CATEGORIES : WARDROBE_CATEGORIES"
              :key="c.id"
              :value="c.id"
            >
              {{ c.label }}
            </option>
          </select>
        </label>

        <label v-if="addingKind === 'wardrobe'" class="bbi-modal-field">
          <span class="bbi-modal-label">部位</span>
          <select v-model="draftSlot" class="bbi-input">
            <option v-for="opt in SLOT_OPTIONS" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
          </select>
        </label>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">尺度</span>
          <select v-model.number="draftNsfw" class="bbi-input">
            <option :value="0">0 · 日常</option>
            <option :value="1">1 · 微诱惑</option>
            <option :value="2">2 · 情趣内衣</option>
            <option :value="3">3 · 明确 NSFW</option>
          </select>
        </label>

        <label v-if="addingKind === 'pose'" class="bbi-modal-field">
          <span class="bbi-modal-label">机位（可选）</span>
          <input
            v-model="draftCamera"
            class="bbi-input"
            type="text"
            placeholder="from above, pov, close-up"
          />
        </label>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">备注（可选）</span>
          <input v-model="draftNote" class="bbi-input" type="text" placeholder="什么时候用、和什么搭配" />
        </label>

        <div class="bbi-channel-bar">
          <button class="bbi-btn bbi-btn-primary" type="button" @click="submitAdd">加入素材库</button>
          <button class="bbi-btn" type="button" @click="addingOpen = false">取消</button>
        </div>
      </div>
    </ModalMask>

    <ModalMask :open="importOpen" @close="importOpen = false">
      <div v-if="importOpen" class="bbi-modal bbi-lore-modal" role="dialog" aria-modal="true" aria-label="导入素材">
        <header class="bbi-modal-head">
          <span class="bbi-modal-title">导入自定义素材</span>
          <button class="bbi-modal-x" type="button" aria-label="关闭" @click="importOpen = false">
            <Icon name="close" />
          </button>
        </header>

        <p class="bbi-field-hint">
          两种都能贴：① JSON（<code>{"wardrobe":[…],"poses":[…]}</code>、一个数组、或单条对象，缺字段的条目只跳过不整体失败）；
          ② 网上分享的 tag 串，形如 <code>champagne_tulle_gown（香槟色薄纱晚礼服）, halter_neckline（挂脖领口）</code>——
          这类会自动剥括号、把中文说明当触发词、并猜分类与部位，导入后可在卡片上看到。
        </p>

        <label class="bbi-modal-field">
          <span class="bbi-modal-label">内容（JSON 或 tag 串）</span>
          <textarea
            v-model="importText"
            class="bbi-input bbi-lore-json"
            rows="10"
            placeholder='[{"name":"绷带装","tags":"bandage, topless, cast","aliases":["绷带","包扎"],"category":"costume","slot":"full","nsfw":3}]'
          />
        </label>

        <div class="bbi-channel-bar">
          <button class="bbi-btn bbi-btn-primary" type="button" @click="submitImport">导入</button>
          <button class="bbi-btn" type="button" @click="importOpen = false">取消</button>
        </div>
      </div>
    </ModalMask>

    <p v-if="toastText" class="bbi-lore-toast">{{ toastText }}</p>
  </section>
</template>

<style scoped>
.bbi-lore-count {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--bbi-ink-muted);
}

.bbi-lore-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.bbi-lore-search {
  flex: 1 1 200px;
  min-width: 160px;
}

.bbi-lore-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}

.bbi-lore-cat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--bbi-line);
  border-radius: 999px;
  background: transparent;
  color: var(--bbi-ink-muted);
  font-size: 12px;
  cursor: pointer;
}

.bbi-lore-cat span {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.bbi-lore-cat.is-on {
  border-color: var(--bbi-accent);
  color: var(--bbi-accent);
}

.bbi-lore-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.bbi-lore-tools {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.bbi-lore-scale {
  width: auto;
  min-width: 84px;
  padding: 3px 6px;
  font-size: 12px;
}

.bbi-lore-thumb {
  position: relative;
  margin: 0 0 8px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
}

.bbi-lore-thumb img {
  display: block;
  width: 100%;
  height: auto;
}

.bbi-lore-thumb-x {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.bbi-lore-thumb-make {
  width: 100%;
  margin: 0 0 8px;
}

.bbi-lore-kind {
  display: flex;
  gap: 6px;
}

.bbi-lore-del {
  color: var(--bbi-danger, #d25a5a);
}

.bbi-lore-json {
  font-family: var(--bbi-mono, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.55;
  resize: vertical;
}

.bbi-lore-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--bbi-line);
  border-radius: 10px;
  background: var(--bbi-surface);
}

.bbi-lore-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bbi-lore-name {
  flex: 1 1 auto;
  font-size: 13px;
  font-weight: 600;
  color: var(--bbi-ink);
}

.bbi-lore-nsfw,
.bbi-lore-q {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 10px;
  line-height: 1.6;
}

.bbi-lore-nsfw {
  background: color-mix(in srgb, var(--bbi-warn, #d68b3a) 18%, transparent);
  color: var(--bbi-warn, #d68b3a);
}

.bbi-lore-nsfw.lv3 {
  background: color-mix(in srgb, var(--bbi-danger, #d25a5a) 18%, transparent);
  color: var(--bbi-danger, #d25a5a);
}

.bbi-lore-q {
  background: color-mix(in srgb, var(--bbi-accent) 14%, transparent);
  color: var(--bbi-accent);
}

.bbi-lore-tags {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--bbi-ink);
  font-family: var(--bbi-mono, ui-monospace, monospace);
  word-break: break-word;
}

.bbi-lore-extra,
.bbi-lore-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--bbi-ink-muted);
}

.bbi-lore-card-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 6px;
  border-top: 1px solid var(--bbi-line);
}

.bbi-lore-alias {
  flex: 1 1 auto;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--bbi-ink-muted);
}

.bbi-lore-acts {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
}

.bbi-lore-modal {
  max-width: 520px;
}

.bbi-modal-x {
  border: 0;
  background: transparent;
  color: var(--bbi-ink-muted);
  cursor: pointer;
  padding: 2px;
}

.bbi-lore-chars {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 42vh;
  overflow: auto;
}

.bbi-lore-char {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--bbi-line);
  border-radius: 8px;
  background: var(--bbi-surface);
  text-align: left;
  cursor: pointer;
}

.bbi-lore-char:hover {
  border-color: var(--bbi-accent);
}

.bbi-lore-char-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--bbi-ink);
}

.bbi-lore-char-hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--bbi-ink-muted);
  word-break: break-word;
}

.bbi-lore-flash {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--bbi-accent);
}

.bbi-lore-toast {
  position: sticky;
  bottom: 8px;
  align-self: center;
  margin: 14px 0 0;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--bbi-surface);
  border: 1px solid var(--bbi-line);
  font-size: 12px;
  color: var(--bbi-ink);
}
</style>
