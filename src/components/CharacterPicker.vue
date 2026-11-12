<script setup lang="ts">
import { computed, ref } from 'vue';
import ModalMask from './ModalMask.vue';
import { findCharTag } from '@/state/charTags';

/**
 * 画面角色选择器。
 *
 * 生成的图里角色块是模型写的「这张图有谁」，点图就能看到。过去只有单角色图
 * 能一键存形象，多角色图直接劝退；出图即建档上线后，这里还要能把「没档案的
 * 女角色」当场认领进库。选中后由调用方负责存档案 + 存立绘。
 */
const props = defineProps<{
  src: string;
  cast: Array<{ name: string; tag: string; nl?: string }>;
  /** 正在保存的名字，用于禁用按钮。 */
  busyName?: string;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'pick', name: string): void }>();
const failed = ref(false);

const rows = computed(() =>
  props.cast.map((item) => ({
    ...item,
    saved: !!findCharTag(item.name),
  })),
);
</script>

<template>
  <ModalMask open @close="emit('close')">
    <div class="bbi-cast-pick" role="dialog" aria-label="画面角色">
      <div class="bbi-cast-pick__head">
        <div>
          <div class="bbi-cast-pick__title">画面角色</div>
          <div class="bbi-cast-pick__hint">
            选一个角色，把她在这张图里的外貌存成档案形象（没档案的会先建档）。
          </div>
        </div>
        <button class="bbi-cast-pick__close" type="button" @click="emit('close')">×</button>
      </div>
      <div class="bbi-cast-pick__body">
        <img
          class="bbi-cast-pick__thumb"
          :src="src"
          alt=""
          @error="failed = true"
          v-show="!failed"
        />
        <ul class="bbi-cast-pick__list">
          <li v-for="row in rows" :key="row.name" class="bbi-cast-pick__row">
            <div class="bbi-cast-pick__info">
              <div class="bbi-cast-pick__name">
                {{ row.name }}
                <span v-if="!row.saved" class="bbi-cast-pick__badge">未建档</span>
              </div>
              <div class="bbi-cast-pick__tags">{{ row.tag }}</div>
            </div>
            <button
              class="bbi-cast-pick__save"
              type="button"
              :disabled="!!busyName"
              @click="emit('pick', row.name)"
            >
              {{ busyName === row.name ? '保存中…' : row.saved ? '更新形象' : '建档并固定' }}
            </button>
          </li>
        </ul>
      </div>
    </div>
  </ModalMask>
</template>

<style scoped>
.bbi-cast-pick {
  width: min(560px, calc(100vw - 32px));
  max-height: min(78vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--bbi-bg-panel, #1d1f24);
  color: var(--bbi-text, #e7e9ee);
  border: 1px solid var(--bbi-border, #33363d);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}
.bbi-cast-pick__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--bbi-border, #33363d);
}
.bbi-cast-pick__title {
  font-size: 15px;
  font-weight: 600;
}
.bbi-cast-pick__hint {
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.7;
  line-height: 1.5;
}
.bbi-cast-pick__close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
}
.bbi-cast-pick__body {
  padding: 12px 16px 16px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bbi-cast-pick__thumb {
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
}
.bbi-cast-pick__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bbi-cast-pick__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--bbi-border, #33363d);
  border-radius: 10px;
}
.bbi-cast-pick__info {
  min-width: 0;
  flex: 1;
}
.bbi-cast-pick__name {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.bbi-cast-pick__badge {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(240, 180, 80, 0.16);
  color: #f0b450;
}
.bbi-cast-pick__tags {
  margin-top: 3px;
  font-size: 11px;
  opacity: 0.65;
  line-height: 1.5;
  word-break: break-word;
}
.bbi-cast-pick__save {
  flex: none;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--bbi-accent, #6c8cff);
  background: rgba(108, 140, 255, 0.14);
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
.bbi-cast-pick__save:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
