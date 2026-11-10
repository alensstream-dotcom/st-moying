<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { getThumb } from '@/data/loreThumbs';
import { openLightbox } from '@/floor/lightbox';
const props = defineProps<{
  id: string;
  tags: string;
  revision: number;
  kind?: 'face' | 'wardrobe';
  name?: string;
  large?: boolean;
}>();
const box = ref<HTMLElement>(),
  url = ref(''),
  stale = ref(false),
  picturePrompt = ref('');
let observer: IntersectionObserver | undefined,
  visible = false,
  epoch = 0;
function clear() {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = '';
}
async function load() {
  const ticket = ++epoch;
  clear();
  if (!visible) return;
  try {
    const record = await getThumb((props.kind ?? 'wardrobe') + ':' + props.id);
    if (ticket === epoch && record) {
      url.value = URL.createObjectURL(record.blob);
      stale.value = record.prompt !== props.tags;
      picturePrompt.value = record.prompt;
    }
  } catch {}
}
watch(
  () => [props.id, props.tags, props.revision, props.kind],
  () => {
    void load();
  },
);
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') {
    visible = true;
    void load();
    return;
  }
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      visible = true;
      observer?.disconnect();
      void load();
    }
  });
  if (box.value) observer.observe(box.value);
});
onUnmounted(() => {
  epoch++;
  observer?.disconnect();
  clear();
});
</script>
<template>
  <div ref="box" class="material-thumb" :class="{ large }">
    <img
      v-if="url"
      :src="url"
      alt="素材预览，双击放大"
      loading="lazy"
      tabindex="0"
      @click.stop
      @dblclick.stop="openLightbox({ src: url, prompt: picturePrompt, filename: props.name || '素材预览' })"
      @keydown.enter.stop="
        openLightbox({ src: url, prompt: picturePrompt, filename: props.name || '素材预览' })
      "
    />
    <span v-else class="empty">尚未生成预览</span>
    <small v-if="url && stale">标签已修改，预览待更新</small>
  </div>
</template>
<style scoped>
.material-thumb:empty {
  display: none;
}
.material-thumb img {
  display: block;
  width: 100%;
  height: 150px;
  object-fit: contain;
  object-position: center;
  margin: 0 auto 10px;
  background: #8881;
}
.material-thumb .empty {
  display: grid;
  place-items: center;
  min-height: 100px;
  background: #8881;
  font-size: 0.8em;
  opacity: 0.6;
}
.material-thumb.large img {
  height: 440px;
  cursor: zoom-in;
}
.material-thumb.large .empty {
  min-height: 180px;
}
</style>
