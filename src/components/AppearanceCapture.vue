<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import ModalMask from './ModalMask.vue';
import { getContext } from '@/st/context';
import { getTagGenChannel } from '@/state/settings';
import { requestCompletion, requestViaMainApi } from '@/api/client';
import { findCharTag, upsertCharTag, recomputeCharTags, CHAR_TAG_FIELD_LABELS, type CharTagField } from '@/state/charTags';
import { appearancePolicy, setAppearancePolicy, fandomOnly } from '@/state/appearancePolicy';
import { explainTags } from '@/state/characterStudio';
const props = defineProps<{ src: string; cast: Array<{ name: string; tag: string }>; chat?: string }>();
const emit = defineEmits<{ close: [] }>();
const candidates = props.cast.filter(c => findCharTag(c.name));
const name = ref(candidates[0]?.name || '');
const fields = ['hair', 'eyes', 'skin', 'body', 'extra'] as CharTagField[];
const values = ref<Partial<Record<CharTagField, string>>>({});
const selected = ref<CharTagField[]>([]);
const busy = ref(false), feedback = ref('');
const controller = new AbortController();
const old = computed(() => findCharTag(name.value));
onBeforeUnmount(() => controller.abort());
function check() { if (getContext()?.getCurrentChatId?.() !== props.chat) throw new Error('聊天已切换，请重新打开图片'); }
async function recognise() {
  if (busy.value) return;
  busy.value = true; const target = name.value;
  try {
    check();
    const response = await fetch(props.src, { signal: controller.signal });
    if (!response.ok) throw new Error('图片读取失败');
    const blob = await response.blob();
    if (blob.size > 8 * 1024 * 1024) throw new Error('图片超过 8MB，请先裁剪');
    const imageData = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('图片读取失败')); r.readAsDataURL(blob); });
    const messages = [
      { role: 'system' as const, content: '识别指定人物在图片中可见的稳定外貌，返回 JSON {fields:{hair,eyes,skin,body,extra},reason:"中文说明",uncertain:false}。字段使用简洁英文标签：头发颜色长度造型、眼睛颜色形状、肤色、身高体态、面部轮廓眉形和标志特征。不推断年龄、性格、身份或敏感属性，不描述衣物、动作、画风、表情、灯光、临时湿发。看不见的字段留空；多人中无法唯一确认目标则 uncertain=true，不能根据提示词猜图片内容。' },
      { role: 'user' as const, content: JSON.stringify({ target, cast: props.cast }) },
    ];
    const channel = getTagGenChannel(), options = { signal: controller.signal, imageData, source: '图片外貌识别（需确认采用）' };
    const raw = channel ? await requestCompletion(channel, messages, options) : await requestViaMainApi(messages, options);
    check(); if (target !== name.value) throw new Error('角色已切换');
    const text = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/g, '');
    const data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (data.uncertain !== false) throw new Error(data.reason || '无法确认图片中的角色');
    values.value = Object.fromEntries(fields.map(f => [f, typeof data.fields?.[f] === 'string' ? data.fields[f].trim().slice(0, 1000) : '']));
    selected.value = []; feedback.value = data.reason || '请勾选要固定的字段；未勾选的保持不变。';
  } catch(e) { feedback.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; }
}
function save() {
  try {
    check(); const entry = old.value;
    if (!entry) throw new Error('角色已不存在');
    const chosen = Object.fromEntries(selected.value.map(f => [f, values.value[f]?.trim() || '']));
    if (!Object.keys(chosen).length || Object.values(chosen).some(v => !v || /[<>]/.test(v))) throw new Error('请勾选并填写要固定的外貌字段，不能包含标签标记');
    const prev = appearancePolicy(entry.name);
    const policy = { mode: entry.fields.fandom ? 'fandom' as const : 'manual' as const, fields: { ...prev?.fields, ...chosen, ...(entry.fields.fandom ? { fandom: entry.fields.fandom } : {}) } };
    const next = policy.mode === 'fandom' ? fandomOnly(entry, policy.fields) : { ...entry, fields: { ...entry.fields, ...chosen }, source: 'manual' as const };
    if (!upsertCharTag(next, entry.name, { recordChanges: true })) throw new Error('保存失败');
    setAppearancePolicy(entry.name, policy, entry); recomputeCharTags();
    toastr.success('所选外貌已固定；不会自动开启图片参考，也不会改变衣物', '墨影'); emit('close');
  } catch(e) { feedback.value = e instanceof Error ? e.message : String(e); }
}
</script>
<template>
  <ModalMask open top-layer @close="emit('close')">
    <section class="bbi-modal capture" role="dialog" aria-modal="true" aria-label="识别并固定外貌">
      <header class="bbi-modal-head"><h3>识别并固定图中外貌</h3><button class="bbi-btn" @click="emit('close')">关闭</button></header>
      <img :src="src" alt="待识别的剧情图片" />
      <label>对应角色<select v-model="name" class="bbi-input" :disabled="busy" @change="values = {}; selected = []; feedback = ''"><option v-for="c in candidates" :key="c.name" :value="c.name">{{ c.name }}</option></select></label>
      <p>识别会发送此图给已保存的 LLM，需要支持看图并按渠道计费。只固定你勾选的外貌，不能保证文字在每张图中完全还原脸型。</p>
      <button class="bbi-btn" :disabled="busy || !name" @click="recognise">{{ busy ? '识别中…' : '识别图片（LLM）' }}</button>
      <div v-for="f in fields" :key="f" class="capture-field">
        <label><input v-model="selected" type="checkbox" :value="f" />固定{{ CHAR_TAG_FIELD_LABELS[f] }}</label>
        <small>当前：{{ explainTags(old?.fields[f] || '') || '未设定' }}</small>
        <input v-model="values[f]" class="bbi-input" placeholder="识别后可自行修正英文标签" />
        <small>{{ explainTags(values[f] || '') }}</small>
      </div>
      <p role="status">{{ feedback }}</p>
      <footer class="bbi-modal-foot"><button class="bbi-btn" @click="emit('close')">取消</button><button class="bbi-btn bbi-btn-primary" :disabled="busy || !selected.length" @click="save">固定勾选的特征</button></footer>
    </section>
  </ModalMask>
</template>
<style scoped>
.capture { width: min(680px,94vw); max-height: 90dvh; overflow: auto; padding: 20px; }
.capture h3 { margin: 0; }
.capture img { display: block; margin: 14px auto; max-width: 100%; max-height: 38dvh; object-fit: contain; }
.capture p { line-height: 1.6; }
.capture-field { display: grid; gap: 5px; margin-top: 14px; }
.capture-field small { opacity: .75; overflow-wrap: anywhere; }
</style>
