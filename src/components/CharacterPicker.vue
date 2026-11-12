<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import ModalMask from './ModalMask.vue';
import { requestCompletion, requestViaMainApi } from '@/api/client';
import { charTagLib, findCharTag } from '@/state/charTags';
import { resolveCanonicalCharName } from '@/autoTag/charReuse';
import { getTagGenChannel } from '@/state/settings';
import { getContext } from '@/st/context';

/**
 * 画面角色选择器。
 *
 * 生成图里角色块就是「这张图有谁」，点图就能看到；但老图或模型漏写角色块时
 * 只能看像素。所以这里除了列出角色块，还能把图发给视觉模型现场认一遍女性
 * 角色（长什么样、对应哪个已有档案），认出来的人可以当场建档/更新形象。
 */
const props = defineProps<{
  src: string;
  cast: Array<{ name: string; tag: string; nl?: string }>;
  chat?: string;
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'pick', value: { name: string; tag: string }): void;
}>();

interface Row {
  name: string;
  tag: string;
  saved: boolean;
  /** 视觉识别出来的行（不是角色块里写死的名字）。 */
  recognised?: boolean;
  /** 识别时给的中文说明，展示用。 */
  reason?: string;
}

const extra = ref<Row[]>([]);
const feedback = ref('');
const busy = ref('');
const failed = ref(false);
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());

const rows = computed<Row[]>(() => {
  // 角色块里可能写的是「晚晴」这类称呼：先归到档案主名，否则同一个人的档案会被
  // 标成「未建档」，点一下就拿称呼另建一条新档。
  const fromTag: Row[] = props.cast.map((item) => {
    const name = charTagLib.entries.length
      ? resolveCanonicalCharName(item.name, charTagLib.entries)
      : item.name;
    return { name, tag: item.tag, saved: !!findCharTag(name) };
  });
  const seen = new Set(fromTag.map((row) => row.name));
  return [...fromTag, ...extra.value.filter((row) => !seen.has(row.name))];
});

function checkChat() {
  if (props.chat && props.chat !== getContext()?.getCurrentChatId?.())
    throw new Error('聊天已切换，请重新打开图片');
}

async function imageData(): Promise<string> {
  const response = await fetch(props.src, { signal: controller.signal });
  if (!response.ok) throw new Error('图片读取失败');
  const blob = await response.blob();
  if (blob.size > 8 * 1024 * 1024) throw new Error('请使用8MB以内的图片');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

async function recognise() {
  if (busy.value) return;
  busy.value = 'recognise';
  feedback.value = '';
  try {
    checkChat();
    const data = await imageData();
    const known = props.cast.map((item) => ({ name: item.name, tag: item.tag }));
    const messages = [
      {
        role: 'system' as const,
        content:
          '只识别图片里真实可见的女性角色，返回 JSON {"characters":[{"label":"女1","name":"","tag":"","reason":""}]}。' +
          'name 只能从给定名单里选（外貌/发型/服装明显对得上时才选），对不上留空；tag 用英文逗号分隔的 Danbooru 标签，只写这个角色本身稳定可见的特征（发色长度发型、瞳色、肤色、体型、显著特征），不写表情、动作、姿势、镜头、背景、画风、衣服状态。' +
          '画面里没有女性角色时返回空数组。不要为男性或背景生成条目，不要猜名字。',
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          known,
          task: '识别这张图里出现的女性角色',
        }),
      },
    ];
    const reply = (getTagGenChannel()
      ? await requestCompletion(getTagGenChannel()!, messages, {
          signal: controller.signal,
          imageData: data,
          source: '画面角色：视觉识别',
        })
      : await requestViaMainApi(messages, {
          signal: controller.signal,
          imageData: data,
          source: '画面角色：视觉识别',
        })) as string;
    checkChat();
    const json = reply
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
      .match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error('模型没有返回可解析的角色信息，请确认该渠道支持看图');
    const parsed = JSON.parse(json) as {
      characters?: Array<{ label?: string; name?: string; tag?: string; reason?: string }>;
    };
    const found = (parsed.characters ?? [])
      .filter((item) => typeof item.tag === 'string' && item.tag.trim())
      .slice(0, 4);
    if (!found.length) throw new Error('没有识别到女性角色');
    extra.value = found.map((item, index) => {
      const named = (item.name ?? '').trim();
      // 视觉模型也常写「晚晴」这种称呼：同样先归主名，否则点保存会另建一条档。
      const raw = named || `无名女子${index + 1}`;
      const name = charTagLib.entries.length
        ? resolveCanonicalCharName(raw, charTagLib.entries)
        : raw;
      return {
        name,
        tag: (item.tag ?? '').trim(),
        saved: !!findCharTag(name),
        recognised: true,
        reason: (item.reason ?? '').trim(),
      };
    });
    feedback.value = `识别到 ${extra.value.length} 位女性角色，核对标签后点右侧保存。`;
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = '';
  }
}
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
        <div class="bbi-cast-pick__tools">
          <button class="bbi-cast-pick__vision" type="button" :disabled="!!busy" @click="recognise">
            {{ busy === 'recognise' ? '识别中…' : '让 AI 看图标出女角色' }}
          </button>
          <span v-if="feedback" class="bbi-cast-pick__feedback">{{ feedback }}</span>
        </div>
        <ul class="bbi-cast-pick__list">
          <li v-for="row in rows" :key="row.name" class="bbi-cast-pick__row">
            <div class="bbi-cast-pick__info">
              <div class="bbi-cast-pick__name">
                {{ row.name }}
                <span v-if="!row.saved" class="bbi-cast-pick__badge">未建档</span>
                <span v-if="row.recognised" class="bbi-cast-pick__badge">识别</span>
              </div>
              <div class="bbi-cast-pick__tags">{{ row.tag }}</div>
              <div v-if="row.reason" class="bbi-cast-pick__reason">{{ row.reason }}</div>
            </div>
            <button
              class="bbi-cast-pick__save"
              type="button"
              :disabled="!!busy"
              @click="emit('pick', { name: row.name, tag: row.tag })"
            >
              {{ row.saved ? '更新形象' : '建档并固定' }}
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
.bbi-cast-pick__tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.bbi-cast-pick__vision {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px dashed var(--bbi-border, #4a4e57);
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
.bbi-cast-pick__vision:disabled {
  opacity: 0.6;
  cursor: default;
}
.bbi-cast-pick__feedback {
  font-size: 12px;
  opacity: 0.75;
  line-height: 1.5;
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
.bbi-cast-pick__reason {
  margin-top: 3px;
  font-size: 11px;
  opacity: 0.55;
  line-height: 1.5;
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
