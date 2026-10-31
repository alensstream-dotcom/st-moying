<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import { BODY_PRESETS, FACE_PRESETS, FANDOM_PRESETS } from '@/data/faceBank';
import { POSE_CATEGORIES, POSE_ITEMS } from '@/data/poseBank';
import { WARDROBE_CATEGORIES, WARDROBE_ITEMS } from '@/data/wardrobe';
import {
  CHAR_TAG_FIELD_LABELS,
  charTagLib,
  findCharTag,
  upsertCharTag,
  type CharTagEntry,
  type CharTagField,
} from '@/state/charTags';
import { computed, ref } from 'vue';

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
}

const WARDROBE_LABEL = new Map<string, string>(WARDROBE_CATEGORIES.map(c => [c.id, c.label]));
const POSE_LABEL = new Map<string, string>(POSE_CATEGORIES.map(c => [c.id, c.label]));

const wardrobeCards: LoreCard[] = WARDROBE_ITEMS.map(item => ({
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
}));

const poseCards: LoreCard[] = POSE_ITEMS.map(item => ({
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
}));

const faceCards: LoreCard[] = [
  ...FACE_PRESETS.map(item => ({
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
  ...BODY_PRESETS.map(item => ({
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
  ...FANDOM_PRESETS.map(item => ({
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
const keyword = ref('');
const activeCategory = ref('all');
const flash = ref('');
let flashTimer: number | undefined;

const allCards = computed<LoreCard[]>(() => {
  if (tab.value === 'wardrobe') return wardrobeCards;
  if (tab.value === 'pose') return poseCards;
  return faceCards;
});

/** 关键字命中:名字 / tag 串 / 中文触发词,任一含子串即算。 */
const searched = computed<LoreCard[]>(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return allCards.value;
  return allCards.value.filter(card => {
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
        <p class="bbi-lore-tags">{{ card.tags }}</p>
        <p v-if="card.extra" class="bbi-lore-extra">{{ card.extra }}</p>
        <p v-if="card.note" class="bbi-lore-note">{{ card.note }}</p>
        <footer class="bbi-lore-card-foot">
          <span class="bbi-lore-alias">{{ card.aliases.join(' / ') }}</span>
          <span class="bbi-lore-acts">
            <button class="bbi-btn bbi-btn-sm" type="button" @click="copyTags(card)">复制</button>
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
