<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue';
import { wardrobeCategoryLabel, allWardrobeItems } from '@/data/loreIndex';
import { addCustomWardrobe, guessWardrobeCategory } from '@/data/customLore';
import { bindingFromTags, chooseWardrobe, type SuitMode } from '@/state/wardrobeChoice';
import { findCharTag, buildEntryTag, isManualFandom } from '@/state/charTags';
import { explainTags } from '@/state/characterStudio';
import { generateImage, decideSeed } from '@/generate';
import { getContext } from '@/st/context';
import { putStudioImage } from '@/data/loreThumbs';
import { openLightbox } from '@/floor/lightbox';
import type { WardrobeItem } from '@/data/loreTypes';
import OnlineLibrary from '@/components/OnlineLibrary.vue';
import { onlineWardrobeSlot, type OnlineMaterial } from '@/data/onlineLibrary';
const props = defineProps<{ name: string; floor: number }>();
const emit = defineEmits<{ changed: [] }>();
const query = ref(''),
  category = ref(''),
  selection = ref<WardrobeItem[]>([]),
  title = ref('我的套装'),
  tags = ref(''),
  mode = ref<SuitMode>('style'),
  feedback = ref(''),
  busy = ref(false),
  revision = ref(0),
  preview = ref('');
let blob: Blob | null = null,
  controller: AbortController | null = null;
const items = computed(() => {
  revision.value;
  return allWardrobeItems();
});
const categories = computed(() => [...new Set(items.value.map((i) => i.category))]);
const results = computed(() =>
  items.value
    .filter((i) => i.slot !== 'state')
    .filter(
      (i) =>
        (!category.value || i.category === category.value) &&
        (!query.value.trim() ||
          (i.name + ' ' + i.tags + ' ' + i.aliases.join(' '))
            .toLowerCase()
            .includes(query.value.trim().toLowerCase())),
    )
    .slice(0, 24),
);
function clearPreview() {
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = '';
  blob = null;
}
function selectOnline(item: OnlineMaterial) {
  select({
    id: `online:${item.sourceUrl}:${item.tags}`,
    name: item.name,
    tags: item.tags,
    aliases: item.aliases,
    nsfw: 1,
    category: guessWardrobeCategory(item.tags),
    slot: onlineWardrobeSlot(item.tags),
    note: `在线来源：${item.sourceUrl}`,
  });
  feedback.value = '在线素材已加入下方穿搭组合，可继续选部件，再收藏整套或穿给角色';
}
function select(item: WardrobeItem) {
  clearPreview();
  const k = item.slot;
  if (k === 'state') {
    feedback.value = '穿脱状态不作为固定款式收藏';
    return;
  }
  selection.value = selection.value.filter(
    (e) =>
      e.id !== item.id &&
      (k === 'full'
        ? !['full', 'top', 'bottom'].includes(e.slot)
        : ['top', 'bottom'].includes(k)
          ? e.slot !== 'full' && e.slot !== k
          : e.slot !== k),
  );
  selection.value.push(item);
  tags.value = [
    ...new Set(
      selection.value.flatMap((e) =>
        e.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ),
  ].join(', ');
  title.value = selection.value
    .map((e) => e.name)
    .join('＋')
    .slice(0, 120);
}
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
async function save() {
  await run(async () => {
    const result = addCustomWardrobe({
      name: title.value,
      tags: tags.value,
      aliases: title.value,
      category: guessWardrobeCategory(tags.value, []),
      slot: 'full',
      nsfw: selection.value.reduce<number>((n, e) => Math.max(n, e.nsfw), 0) as 0 | 1 | 2 | 3,
      note: ['用户组合并冻结的套装', ...selection.value.map((e) => e.note).filter(Boolean)].join('；'),
    });
    if (!result.ok || !result.item) throw new Error(result.error ?? '保存失败');
    let imageNote = '';
    if (blob)
      try {
        await putStudioImage('wardrobe:' + result.item.id, blob, tags.value);
      } catch {
        imageNote = '；预览图片未能保存，请下载图片备份';
      }
    revision.value++;
    feedback.value = '已存入本地服装素材库，可搜索名称再次套用' + imageNote;
  });
}
async function wear() {
  await run(async () => {
    if (!props.name) throw new Error('先保存角色档案');
    const suit = bindingFromTags(props.name, title.value, tags.value, mode.value);
    await chooseWardrobe(props.floor, props.name, suit);
    emit('changed');
    feedback.value = '从第 ' + props.floor + ' 楼开头起套用，后续分析/重画使用；历史图片不批量替换';
  });
}
async function release() {
  await run(async () => {
    await chooseWardrobe(props.floor, props.name, null);
    emit('changed');
    feedback.value = '已从此楼解除套装保护，保留当前衣物直到剧情发生变化';
  });
}
async function draw() {
  await run(async () => {
    const entry = findCharTag(props.name);
    if (!entry) throw new Error('先保存角色档案');
    const ctx = getContext(),
      chat = ctx?.getCurrentChatId?.(),
      expected = tags.value;
    if (!expected.trim()) throw new Error('先组合或填写套装标签');
    clearPreview();
    controller = new AbortController();
    const body = isManualFandom(entry)
      ? entry.fields.sex + ', ' + entry.fields.fandom
      : buildEntryTag({ fields: { ...entry.fields, outfit: '' }, raw: entry.raw });
    const out = await generateImage(
      {
        prompt:
          'solo, full body, standing, centered composition, simple background, ' + body + ', ' + expected,
        backend: 'nai',
        size: 'portrait',
        seed: decideSeed('nai', undefined, true),
        suppressCharacterReference: true,
      },
      controller.signal,
    );
    try {
      const response = await fetch(out.result.url, { signal: controller.signal });
      if (!response.ok) throw new Error('预览读取失败');
      const image = await response.blob();
      if (controller.signal.aborted || chat !== getContext()?.getCurrentChatId?.() || expected !== tags.value)
        return;
      blob = image;
      preview.value = URL.createObjectURL(image);
      feedback.value = '预览使用当前 NAI 配置；仅展示，不改剧情账本';
    } finally {
      out.result.revoke();
      controller = null;
    }
  });
}
onUnmounted(() => {
  controller?.abort();
  clearPreview();
});
</script>
<template>
  <section class="wardrobe-panel">
    <OnlineLibrary kind="wardrobe" @select="selectOnline" @saved="revision++" />
    <h3>挑选、组合并固定一套衣服</h3>
    <p>
      先选部件或直接填写英文标签，再保存收藏或穿给角色。不重新随机选款；穿脱由账本处理，状态型素材不作为固定款式。
    </p>
    <fieldset :disabled="busy">
      <input v-model="query" class="bbi-input" placeholder="搜索服装名称、中文触发词或英文标签" /><select
        v-model="category"
        class="bbi-input"
      >
        <option value="">全部分类</option>
        <option v-for="c in categories" :key="c" :value="c">{{ wardrobeCategoryLabel(c) }}</option>
      </select>
      <div class="wardrobe-grid">
        <button v-for="item in results" :key="item.id" class="bbi-btn" @click="select(item)">
          {{ item.name }}
          <small>{{
            {
              full: '整套',
              top: '上装',
              bottom: '下装',
              underwear: '内搭',
              hosiery: '袜类',
              shoes: '鞋履',
              accessory: '配饰',
              state: '穿脱状态',
            }[item.slot]
          }}</small>
        </button>
      </div>
      <p>
        本地共 {{ items.length }} 项，一次显示前 24
        项，输入关键词可缩小范围。新选择的同部位单品替换旧项；整套与上下装互斥。
      </p>
      <label>套装名称<input v-model="title" class="bbi-input" /></label
      ><label
        >冻结的款式标签<textarea v-model="tags" class="bbi-input" rows="4" @input="clearPreview" />
      </label>
      <p>{{ explainTags(tags) }}</p>
      <label
        >穿搭保护<select v-model="mode" class="bbi-input">
          <option value="style">锁款式，允许剧情穿脱；明确整套换装时退出绑定</option>
          <option value="always">始终使用此套装，忽略剧情换装与穿脱</option>
        </select></label
      >
      <p>生效位置：第 {{ floor }} 楼开头。用户覆盖允许与时代/剧情不同；原文不被改写。</p>
      <div class="wardrobe-actions">
        <button class="bbi-btn" @click="draw">预览一次（NAI）</button
        ><button class="bbi-btn" @click="save">收藏这套衣服</button
        ><button class="bbi-btn bbi-btn-primary" @click="wear">穿给 {{ name || '当前角色' }}</button
        ><button class="bbi-btn" @click="release">从此楼解除保护</button>
      </div>
    </fieldset>
    <img
      v-if="preview"
      :src="preview"
      alt="套装预览，点击放大"
      @click="openLightbox({ src: preview, prompt: tags, filename: title })"
    />
    <p role="status">{{ busy ? '正在处理… ' : '' }}{{ feedback }}</p>
    <button v-if="busy && controller" class="bbi-btn" @click="controller.abort()">取消预览</button>
  </section>
</template>
<style scoped>
.wardrobe-panel {
  border-top: 1px solid #8884;
  margin-top: 20px;
  padding-top: 16px;
}
.wardrobe-panel fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.wardrobe-panel label {
  display: block;
  margin: 12px 0;
}
.wardrobe-panel p {
  font-size: 12px;
  line-height: 1.8;
  color: var(--bbi-ink-muted);
}
.wardrobe-panel img {
  display: block;
  max-width: 100%;
  max-height: 480px;
  margin: 16px auto;
  cursor: zoom-in;
}
.wardrobe-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0;
  max-height: 200px;
  overflow: auto;
}
.wardrobe-grid small {
  opacity: 0.6;
}
.wardrobe-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
