<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import ModalMask from './ModalMask.vue';
import { harvestOutfit, type HarvestedOutfit } from '@/autoTag/outfitHarvest';
import { confirmClothingWords, inspectClothing, saveSuit, SUIT_CATEGORIES } from '@/data/materialLibrary';
import { putStudioImage } from '@/data/loreThumbs';
import type { WardrobeSlot } from '@/data/loreTypes';

/**
 * 把这张图里好看的这身衣服收进新衣橱。
 *
 * 与「衣橱 → 识别」的区别:那条路是拿一段**文字描述**去猜款式,猜出来的东西往往
 * 比图里实际画的粗。这里直接读这张图自己的提示词,版型、主色、配件全在,
 * 存下来就是原样复用,下次还能召回。
 *
 * 只做本地字符串整理 + 用户确认,不额外调用 LLM,不花额度。
 */
const props = defineProps<{ src: string; prompt?: string }>();
const emit = defineEmits<{ close: []; saved: [payload: { name: string }] }>();

const harvested = ref<HarvestedOutfit>(
  harvestOutfit(
    (() => {
      try {
        const text = String(props.prompt ?? '');
        const match = text.match(/<characters>([\s\S]*?)<\/characters>/i);
        const characters = match ? (JSON.parse(match[1]) as Array<{ name?: string; tag?: string }>) : [];
        const base = text.replace(/<characters>[\s\S]*?<\/characters>/i, '');
        return { tag: base, characters };
      } catch {
        return { tag: String(props.prompt ?? ''), characters: [] };
      }
    })(),
  ),
);

const name = ref(harvested.value.name);
const tags = ref(harvested.value.tags);
const slot = ref<WardrobeSlot>(harvested.value.slot);
const category = ref(harvested.value.category);
const era = ref(harvested.value.era);
const automatic = ref(true);
const confirmed = ref<string[]>([]);
const feedback = ref(harvested.value.pieces ? '' : '这张图里没读出衣物标签，可以手动补。');
const busy = ref(false);

const checked = computed(() => inspectClothing(tags.value));
const unknown = computed(() => checked.value.unknown.filter((word) => !confirmed.value.includes(word)));

function confirmUnknown() {
  try {
    confirmClothingWords(checked.value.unknown);
    confirmed.value = [...checked.value.unknown];
    feedback.value = '已作为“用户确认词”补进本地词表。';
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  }
}

function slotLabel(value: WardrobeSlot): string {
  return (
    { full: '整套', top: '上衣', bottom: '下装', underwear: '内衣', hosiery: '袜类', shoes: '鞋', accessory: '配饰', state: '状态' } as Record<
      string,
      string
    >
  )[value] ?? value;
}

const controller = new AbortController();
onBeforeUnmount(() => controller.abort());

async function save() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (!name.value.trim()) throw new Error('请起一个名字，方便以后在衣橱里找到它');
    const result = inspectClothing(tags.value);
    if (!result.tags) throw new Error('没有可保存的衣物标签');
    if (result.unknown.length) throw new Error(`这些词不在词表里：${result.unknown.join(', ')}`);
    const item = saveSuit({
      name: name.value.trim().slice(0, 120),
      tags: result.tags,
      aliases: [name.value.trim().slice(0, 120), ...(harvested.value.wearer ? [harvested.value.wearer] : [])],
      category: category.value,
      era: era.value,
      slot: slot.value,
      nsfw: ['swim', 'lingerie'].includes(category.value) ? 1 : 0,
      automatic: automatic.value,
      origin: '从已出图片收藏的这身',
      note: '从实际出图提示词提取的款式指纹，剧情里的穿脱另记',
    });
    try {
      const response = await fetch(props.src, { signal: controller.signal });
      const blob = await response.blob();
      await putStudioImage('wardrobe:' + item.id, blob, item.tags);
    } catch {
      /* 缩略图存不上不影响条目本身 */
    }
    toastr.success(`已收进新衣橱：${item.name}`, '墨影');
    emit('saved', { name: item.name });
    emit('close');
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalMask open top-layer @close="emit('close')">
    <section class="bbi-modal harvest" role="dialog" aria-modal="true" aria-label="收藏这身衣服">
      <header class="bbi-modal-head">
        <h3>把这身衣服收进衣橱</h3>
        <button class="bbi-btn" @click="emit('close')">关闭</button>
      </header>
      <img :src="src" alt="要收藏的服装" />
      <p class="hint">
        标签取自这张图自己的提示词{{ harvested.wearer ? `（${harvested.wearer} 身上这套）` : '' }}，可直接改。
        收进衣橱后，首次穿搭或正文明确换装时会作为候选出现；穿脱状态仍由楼层账本管理。
      </p>
      <label>名字<input v-model="name" class="bbi-input" maxlength="120" /></label>
      <label>
        标签
        <textarea v-model="tags" class="bbi-input" rows="3" placeholder="英文衣物标签，逗号分隔" />
      </label>
      <p v-if="unknown.length" class="warn">
        这些词不在词表里，可以手动改，也可以整批确认为个人补充词：{{ unknown.join('、') }}
        <button class="bbi-btn" @click="confirmUnknown">全都是衣物词，确认补入</button>
      </p>
      <div class="row">
        <label>
          部位
          <select v-model="slot" class="bbi-input">
            <option v-for="s in (['full', 'top', 'bottom', 'underwear', 'hosiery', 'shoes', 'accessory'] as const)" :key="s" :value="s">
              {{ slotLabel(s) }}
            </option>
          </select>
        </label>
        <label>
          分类
          <select v-model="category" class="bbi-input">
            <option v-for="c in SUIT_CATEGORIES" :key="c[0]" :value="c[0]">{{ c[1] }}</option>
          </select>
        </label>
        <label>
          时代
          <select v-model="era" class="bbi-input">
            <option value="ancient">古代</option>
            <option value="modern">现代</option>
            <option value="fantasy">奇幻</option>
            <option value="any">通用</option>
          </select>
        </label>
      </div>
      <label class="inline">
        <input v-model="automatic" type="checkbox" />自动参与候选召回（不勾则只能手动挑）
      </label>
      <p role="status">{{ feedback }}</p>
      <footer class="bbi-modal-foot">
        <button class="bbi-btn" @click="emit('close')">取消</button>
        <button class="bbi-btn bbi-btn-primary" :disabled="busy" @click="save">收藏到衣橱</button>
      </footer>
    </section>
  </ModalMask>
</template>

<style scoped>
.harvest {
  width: min(640px, 94vw);
  max-height: 90dvh;
  overflow: auto;
  padding: 20px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h3 {
  margin: 0;
}
img {
  display: block;
  margin: 12px auto;
  max-width: 100%;
  max-height: 32dvh;
  object-fit: contain;
  border-radius: var(--bbi-radius-sm);
}
label {
  display: block;
  margin: 10px 0;
  font-size: 0.9em;
}
label.inline {
  display: flex;
  align-items: center;
  gap: 6px;
}
.row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.row label {
  flex: 1 1 120px;
}
textarea {
  margin-top: 6px;
}
p {
  font-size: 0.85em;
  line-height: 1.6;
}
.hint {
  color: var(--bbi-ink-muted);
}
.warn {
  color: var(--bbi-warning, orange);
}
</style>
