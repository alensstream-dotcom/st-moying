<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import ModalMask from './ModalMask.vue';
import type { FandomMaterial } from '@/data/fandomCatalog';
import { charTagLib, findCharTag, upsertCharTag, recomputeCharTags } from '@/state/charTags';
import { setAppearancePolicy, fandomOnly } from '@/state/appearancePolicy';
import { adoptLook } from '@/state/characterStudio';
import { getContext } from '@/st/context';
const props = defineProps<{ item: FandomMaterial | null }>();
const emit = defineEmits<{ close: []; applied: [name: string, item: FandomMaterial] }>();
const query = ref(''),
  target = ref(''),
  error = ref(''),
  input = ref<HTMLInputElement>();
let chat: string | undefined;
const names = computed(() =>
  charTagLib.entries.map((x) => x.name).filter((name) => name.includes(query.value.trim())),
);
watch(
  () => props.item,
  async (item) => {
    if (!item) return;
    query.value = '';
    target.value = '';
    error.value = '';
    chat = getContext()?.getCurrentChatId?.();
    await nextTick();
    input.value?.focus();
  },
);
function apply() {
  try {
    const item = props.item;
    if (!item) return;
    if (chat !== getContext()?.getCurrentChatId?.()) throw new Error('聊天已切换，请关闭后重新选择角色');
    const old = findCharTag(target.value);
    if (!old) throw new Error('请选择角色库中要套用的角色');
    const next = fandomOnly(old, { fandom: item.tags });
    if (!upsertCharTag(next, old.name, { recordChanges: true })) throw new Error('角色档案保存失败');
    setAppearancePolicy(old.name, { mode: 'fandom', fields: { fandom: item.tags } }, old);
    recomputeCharTags();
    adoptLook(next);
    emit('applied', old.name, item);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
</script>
<template>
  <ModalMask :open="!!item" top-layer @close="emit('close')">
    <section
      class="bbi-modal apply-picker"
      role="dialog"
      aria-modal="true"
      aria-label="选择套用角色"
      @keydown.esc.stop="emit('close')"
    >
      <header class="bbi-modal-head">
        <h3>套用到哪个角色？</h3>
        <button class="bbi-btn" @click="emit('close')">关闭</button>
      </header>
      <p>{{ item?.name }} · {{ item?.franchise }}</p>
      <code>{{ item?.tags }}</code>
      <input
        ref="input"
        v-model="query"
        class="bbi-input"
        placeholder="搜索当前角色库"
        aria-label="搜索当前角色库"
      />
      <div class="targets" role="radiogroup" aria-label="角色库人物">
        <label v-for="name in names" :key="name" class="target" :class="{ chosen: target === name }"
          ><input v-model="target" type="radio" :value="name" name="fandom-target" />{{ name }}</label
        >
        <p v-if="!charTagLib.entries.length">当前角色库为空。请先到角色库建立剧情角色，再回来套用。</p>
        <p v-else-if="!names.length">没有匹配的角色，请修改搜索词。</p>
      </div>
      <p class="hint">确认后将固定该角色的同人身份；剧情服装继续单独记录，图片参考关闭。</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer class="bbi-modal-foot">
        <button class="bbi-btn" @click="emit('close')">取消</button
        ><button class="bbi-btn bbi-btn-primary" :disabled="!target" @click="apply">
          套用给 {{ target || '所选角色' }}
        </button>
      </footer>
    </section>
  </ModalMask>
</template>
<style scoped>
.apply-picker {
  width: min(560px, 92vw);
  max-height: 85dvh;
  overflow: auto;
  padding: 20px;
}
.bbi-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
h3 {
  margin: 0;
}
code {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 12px 0;
  opacity: 0.8;
}
.targets {
  display: grid;
  gap: 8px;
  max-height: 36dvh;
  overflow-y: auto;
  margin: 14px 0;
}
.target {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px;
  border: 1px solid #8884;
  border-radius: 8px;
  cursor: pointer;
}
.target.chosen {
  background: #8882;
  border-color: currentColor;
}
.hint {
  font-size: 0.85em;
  opacity: 0.75;
  line-height: 1.6;
}
</style>
