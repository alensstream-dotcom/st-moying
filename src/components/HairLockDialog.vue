<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import ModalMask from './ModalMask.vue';
import { getContext } from '@/st/context';
import { getTagGenChannel } from '@/state/settings';
import { requestCompletion, requestViaMainApi } from '@/api/client';
import { findCharTag, upsertCharTag, recomputeCharTags, isManualFandom } from '@/state/charTags';
import { appearancePolicy, setAppearancePolicy, fandomOnly } from '@/state/appearancePolicy';
import { adoptLook } from '@/state/characterStudio';
import { recoverProfileFields } from '@/autoTag/profileRecovery';
const props = defineProps<{ src: string; cast: Array<{ name: string; tag: string }>; chat?: string }>();
const emit = defineEmits<{ close: [] }>();
const candidates = props.cast.filter((c) => {
  const entry = findCharTag(c.name);
  return entry && isManualFandom(entry);
});
const name = ref(candidates[0]?.name || ''),
  tags = ref(''),
  feedback = ref(''),
  busy = ref(false);
const entry = computed(() => findCharTag(name.value));
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
function fillFromTags() {
  tags.value = recoverProfileFields(candidates.find((c) => c.name === name.value)?.tag || '').hair;
  feedback.value = '这是该图生成时的标签，不是图片识别结果；请核对图片，或点击识别实际发型。';
}
function checkChat() {
  if (props.chat !== getContext()?.getCurrentChatId?.()) throw new Error('聊天已切换，请重新打开图片');
}
async function recognise() {
  if (busy.value || !name.value) return;
  busy.value = true;
  const target = name.value;
  try {
    checkChat();
    const response = await fetch(props.src, { signal: controller.signal });
    if (!response.ok) throw new Error('图片读取失败');
    const blob = await response.blob();
    if (blob.size > 8 * 1024 * 1024) throw new Error('请使用8MB以内的图片');
    const imageData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
    const messages = [
      {
        role: 'system' as const,
        content:
          '只识别图片中指定人物的实际头发，返回 JSON {hair:"英文逗号分隔Danbooru标签",reason:"中文简述",uncertain:false}。hair 包含可见发色、长度、发型、刘海，排除画师、画风、衣服、脸、表情、湿发和风吹等临时状态。以图片为准，不抄旧标签；被遮挡或多人无法确定目标时 uncertain=true，hair 留空，不猜测。',
      },
      {
        role: 'user' as const,
        content: JSON.stringify({ target, characters: props.cast, task: '请识别目标人物实际可见的发型' }),
      },
    ];
    const channel = getTagGenChannel(),
      options = { signal: controller.signal, imageData, source: '图片固定同人发型：视觉识别' };
    const reply = channel
      ? await requestCompletion(channel, messages, options)
      : await requestViaMainApi(messages, options);
    checkChat();
    if (target !== name.value) throw new Error('人物已切换，请重新识别');
    const json = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error('模型未返回发型信息，请检查该渠道是否支持看图');
    const result = JSON.parse(json);
    if (result.uncertain !== false || typeof result.hair !== 'string' || !result.hair.trim())
      throw new Error(result.reason || '无法确定图中发型，请手动填写');
    tags.value = result.hair;
    feedback.value = `识别结果待你确认：${result.reason || ''}`;
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
function save() {
  try {
    checkChat();
    const old = entry.value;
    if (!old || !isManualFandom(old)) throw new Error('请选择已套用同人的角色');
    const text = tags.value.trim().replace(/_/g, ' ');
    if (
      !text ||
      !/^[a-zA-Z0-9 ,()\-]+$/.test(text) ||
      text.length > 600 ||
      /\b(?:artist|style|quality|dress|shirt|breasts|eyes|skin|wet|wind|expression)\b/i.test(text)
    )
      throw new Error('请只填写英文头发标签，例如 short hair, ponytail, black hair');
    const hair = recoverProfileFields(text).hair;
    if (!hair || text.split(',').some((t) => !recoverProfileFields(t).hair))
      throw new Error('请移除非头发标签');
    const policy = {
      mode: 'fandom' as const,
      fields: { ...appearancePolicy(old.name)?.fields, fandom: old.fields.fandom, hair },
    };
    const next = fandomOnly(old, policy.fields);
    if (!upsertCharTag(next, old.name, { recordChanges: true })) throw new Error('保存发型失败');
    setAppearancePolicy(old.name, policy, old);
    recomputeCharTags();
    adoptLook(next);
    toastr.success(`已固定 ${old.name} 的同人发型，后续剧情不能自动改写；可在角色库编辑或解除`, '墨影');
    emit('close');
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  }
}
</script>
<template>
  <ModalMask open top-layer @close="emit('close')">
    <section
      class="bbi-modal hair-lock"
      role="dialog"
      aria-modal="true"
      aria-label="固定同人发型"
      @keydown.esc.stop="emit('close')"
    >
      <header class="bbi-modal-head">
        <h3>固定这张图的同人发型</h3>
        <button class="bbi-btn" @click="emit('close')">关闭</button>
      </header>
      <img :src="src" alt="待固定发型的图片" />
      <label
        >套用的剧情角色<select
          v-model="name"
          class="bbi-input"
          :disabled="busy"
          @change="
            tags = '';
            feedback = '';
          "
        >
          <option v-for="c in candidates" :key="c.name" :value="c.name">{{ c.name }}</option>
        </select></label
      >
      <p v-if="!candidates.length">该图没有可关联的同人角色，请先在角色库套用同人形象。</p>
      <textarea
        v-model="tags"
        class="bbi-input"
        rows="3"
        placeholder="英文发色、长度和发型标签，可手动编辑"
        :disabled="busy"
      />
      <div class="tools">
        <button class="bbi-btn" :disabled="busy || !name" @click="recognise">
          {{ busy ? '识别中…' : '识别图中实际发型（LLM）' }}</button
        ><button class="bbi-btn" :disabled="busy || !name" @click="fillFromTags">
          读取该图提示词中的发型
        </button>
      </div>
      <p>
        识别会将此图发送给已保存的 tagGen LLM（未配置则用酒馆主
        API），需要模型支持看图并按渠道计费。核对后确认，只固定发型，不发送逐图参考，不改变衣服或其他角色。
      </p>
      <p role="status">{{ feedback }}</p>
      <footer class="bbi-modal-foot">
        <button class="bbi-btn" @click="emit('close')">取消</button
        ><button class="bbi-btn bbi-btn-primary" :disabled="busy || !tags.trim() || !name" @click="save">
          确认固定发型
        </button>
      </footer>
    </section>
  </ModalMask>
</template>
<style scoped>
.hair-lock {
  width: min(620px, 94vw);
  max-height: 90dvh;
  overflow: auto;
  padding: 20px;
}
header,
.tools {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
}
h3 {
  margin: 0;
}
img {
  display: block;
  margin: 14px auto;
  max-width: 100%;
  max-height: 38dvh;
  object-fit: contain;
}
label {
  display: block;
  margin: 12px 0;
}
p {
  font-size: 0.85em;
  line-height: 1.6;
}
textarea {
  margin: 10px 0;
}
</style>
