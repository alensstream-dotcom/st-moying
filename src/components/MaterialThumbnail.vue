<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { getThumb } from '@/data/loreThumbs';
const props = defineProps<{ id: string; tags: string; revision: number }>();
const box = ref<HTMLElement>(),
  url = ref('');
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
    const record = await getThumb('wardrobe:' + props.id);
    if (ticket === epoch && record?.prompt === props.tags) url.value = URL.createObjectURL(record.blob);
  } catch {}
}
watch(
  () => [props.id, props.tags, props.revision],
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
  <div ref="box" class="material-thumb">
    <img v-if="url" :src="url" alt="已保存的服装参考或试穿图" loading="lazy" />
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
</style>
