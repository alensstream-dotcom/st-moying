<script setup lang="ts">
import { computed, ref } from 'vue';
import FandomLibrary from '@/components/FandomLibrary.vue';
import WardrobePanel from '@/components/WardrobePanel.vue';
import { charTagLib, findCharTag, upsertCharTag, recomputeCharTags } from '@/state/charTags';
import { setAppearancePolicy } from '@/state/appearancePolicy';
import { adoptLook } from '@/state/characterStudio';
import { archiveLegacyMaterials, exportMaterials, importMaterials } from '@/data/materialLibrary';
import { exportCustomLoreJson } from '@/data/customLore';
import type { FandomMaterial } from '@/data/fandomCatalog';
const tab = ref('wardrobe'),
  target = ref(''),
  feedback = ref(''),
  revision = ref(0);
const names = computed(() => charTagLib.entries.map((x) => x.name));
function applyFandom(item: FandomMaterial) {
  try {
    const old = findCharTag(target.value);
    if (!old) throw new Error('请先在上方选择要更换形象的剧情人物');
    const next = {
      ...old,
      source: 'manual' as const,
      fields: { ...old.fields, fandom: item.tags },
      nl: '',
      raw: '',
    };
    if (!upsertCharTag(next, old.name, { recordChanges: true })) throw new Error('人物保存失败');
    setAppearancePolicy(old.name, { mode: 'fandom', fields: { fandom: item.tags } });
    recomputeCharTags();
    adoptLook(next);
    feedback.value = `已把 ${old.name} 的绘图身份固定为 ${item.name}；剧情服装另行记录，图片参考已关闭`;
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  }
}
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function localLegacyBackup() {
  try {
    return localStorage.getItem('moying_image_custom_lore') || exportCustomLoreJson();
  } catch {
    return exportCustomLoreJson();
  }
}
function backup() {
  try {
    archiveLegacyMaterials();
    download(exportMaterials(), '墨影-新衣橱备份.json');
    feedback.value = '已导出衣橱款式；图片缓存在本机，不包含在这份标签备份里';
  } catch (e) {
    feedback.value = String(e);
  }
}
async function imported(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('衣橱备份不能超过 8MB');
    importMaterials(await file.text());
    revision.value++;
    feedback.value = '已合并新衣橱备份；没有覆盖剧情人物或历史穿搭';
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  } finally {
    input.value = '';
  }
}
</script>
<template>
  <section class="bbi-page materials">
    <div class="bbi-page-head">
      <div>
        <h2 class="bbi-title bbi-title-sub">角色与衣橱</h2>
        <p>人物认准身份，衣服记住款式。</p>
      </div>
      <div class="tools">
        <button class="bbi-btn" @click="backup">导出衣橱</button
        ><label class="bbi-btn file">导入衣橱<input type="file" accept=".json" @change="imported" /></label>
      </div>
    </div>
    <div class="material-tabs" role="tablist" aria-label="素材类别">
      <button
        class="bbi-btn"
        :class="{ 'bbi-btn-primary': tab === 'wardrobe' }"
        :aria-selected="tab === 'wardrobe'"
        role="tab"
        @click="tab = 'wardrobe'"
      >
        服装衣橱</button
      ><button
        class="bbi-btn"
        :class="{ 'bbi-btn-primary': tab === 'fandom' }"
        :aria-selected="tab === 'fandom'"
        role="tab"
        @click="tab = 'fandom'"
      >
        同人角色
      </button>
    </div>
    <template v-if="tab === 'fandom'"
      ><label class="target"
        >要更换形象的剧情人物<select v-model="target" class="bbi-input">
          <option value="">选择人物；仅收藏时可留空</option>
          <option v-for="name in names" :key="name">{{ name }}</option>
        </select></label
      ><FandomLibrary action-label="固定给所选人物" @select="applyFandom"
    /></template>
    <WardrobePanel v-else :key="revision" />
    <p role="status">{{ feedback }}</p>
    <details>
      <summary>旧素材备份</summary>
      <p>
        旧服装、脸型和姿势候选不再参与新素材召回。旧个人收藏和图片缓存保留；衣橱里的“旧服装待整理”可逐条重建。已写入剧情的历史穿搭不会被删除。
      </p>
      <button class="bbi-btn" @click="download(localLegacyBackup(), '墨影-旧素材原始备份.json')">
        导出旧个人收藏
      </button>
    </details>
  </section>
</template>
<style scoped>
.bbi-page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.tools,
.material-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.material-tabs {
  padding: 15px 0;
  border-top: 1px solid #8884;
  border-bottom: 1px solid #8884;
  margin: 18px 0;
}
.target {
  display: block;
  margin: 16px 0;
  max-width: 480px;
}
.target select {
  margin-top: 8px;
}
.file {
  position: relative;
  overflow: hidden;
  margin: 0;
}
.file input {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
}
.bbi-btn {
  min-height: 36px;
  box-sizing: border-box;
}
p {
  line-height: 1.65;
}
details {
  margin-top: 24px;
}
</style>
