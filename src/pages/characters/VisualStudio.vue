<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { getThumb } from '@/data/loreThumbs';
import Collapsible from '@/components/Collapsible.vue';
import BbiTextarea from '@/components/BbiTextarea.vue';
import { createVisualDesign, drawVisualPreview, freezeVisualReference, recompileFloorVisuals } from '@/autoTag/visualActions';
import { prepareTargetText } from '@/autoTag/clean';
import { getContext } from '@/st/context';
import { parseImageTags, stripImageTags } from '@/st/imageTagRegex';
import { transcriptRevision } from '@/state/sceneState';
import { readCharTagFloorDelta } from '@/state/charTags';
import { bindMaterialToCharacter, confirmIdentity, recordManualVisualEvent, sceneAt, sceneStore, undoManualVisualEvent } from '@/state/sceneStore';
import { cloneVisual, materialExclusions, rollMaterial, searchMaterials } from '@/state/visualDesign';
import { exportMaterials, importMaterials, latestMaterials, normalizeMaterial, saveMaterial, saveWorldProfile, visualLibrary, worldProfile } from '@/state/visualLibrary';
import type { VisualMaterial, VisualScope } from '@/state/visualTypes';
import { activeNaiEndpoint, settings } from '@/state/settings';
import { capabilityOverride, resolveNaiCapabilities, saveCapabilityOverride } from '@/backends/capabilities';

const world = ref(worldProfile());
const liveWorld = computed(() => { void sceneStore.current; return worldProfile(); });
const eraOptions = [{ value: 'auto', label: '自动/未知' }, { value: 'xianxia', label: '仙侠' }, { value: 'historical', label: '古风' }, { value: 'modern', label: '现代' }, { value: 'modern_retro', label: '复古现代' }, { value: 'western_fantasy', label: '西幻' }, { value: 'scifi', label: '科幻' }];
const followWorld = ref(false);
const query = ref(''), kind = ref<VisualMaterial['kind']>('outfit'), work = ref('*');
const materials = computed(() => latestMaterials());
const results = computed(() => searchMaterials(materials.value, { query: query.value, kind: kind.value, setting: followWorld.value && kind.value !== 'character' ? world.value.setting : 'auto', work: work.value === '*' ? undefined : work.value }));
const works = computed(() => [...new Set(materials.value.filter(m => m.kind === 'character').map(m => m.work))]);
const exclusions = computed(() => materialExclusions(materials.value, { kind: kind.value, setting: followWorld.value && kind.value !== 'character' ? world.value.setting : 'auto', work: work.value === '*' ? undefined : work.value }));
const candidate = ref<VisualMaterial | null>(null), materialSeed = ref(0), imageSeed = ref<number>(), json = ref(''), transfer = ref('');
const busy = ref(false), feedback = ref('');
const floor = ref(Math.max(0, (getContext()?.chat.length ?? 1) - 1)), line = ref(0);
const characterId = ref(''), scope = ref<VisualScope>('outfit'), mode = ref<'preserve' | 'change'>('preserve');
const characters = computed(() => { void sceneStore.current; return sceneAt(floor.value).characters; });
const positions = computed(() => prepareTargetText(stripImageTags(getContext()?.chat[floor.value]?.mes ?? ''), []).segments);
const chosenCharacter = computed(() => characters.value.find(c => c.characterId === characterId.value));
const aliasDraft = ref(''), workDraft = ref(''), appearanceDraft = ref(''), garmentDraft = ref('');
const vibeId = ref('');
const endpoint = computed(() => activeNaiEndpoint());
const capability = ref(capabilityOverride(endpoint.value.id));
const resolvedCapability = computed(() => resolveNaiCapabilities(settings.nai.model, capability.value));
let mountedChat = getContext()?.getCurrentChatId();
watch(() => sceneStore.current, () => {
  const currentChat = getContext()?.getCurrentChatId();
  if (currentChat !== mountedChat) {
    mountedChat = currentChat; world.value = worldProfile(); floor.value = Math.max(0, (getContext()?.chat.length ?? 1) - 1);
    line.value = 0; characterId.value = ''; feedback.value = '';
  }
});
watch(endpoint, value => { capability.value = capabilityOverride(value.id); });
watch(chosenCharacter, c => {
  aliasDraft.value = c?.aliases.join(', ') ?? ''; workDraft.value = c?.work ?? '';
  appearanceDraft.value = JSON.stringify(c?.baseAppearance ?? {}, null, 2);
  garmentDraft.value = JSON.stringify(c?.outfit?.garments ?? [], null, 2);
});
const cachedPreview = ref('');
let previewRequest = 0;
watch(candidate, async value => {
  json.value = value ? JSON.stringify(value, null, 2) : ''; vibeId.value = value?.vibe?.id ?? '';
  const request = ++previewRequest;
  if (cachedPreview.value) URL.revokeObjectURL(cachedPreview.value);
  cachedPreview.value = '';
  if (!value?.previewKey || value.previewPath) return;
  const record = await getThumb(value.previewKey);
  if (request === previewRequest && record) cachedPreview.value = URL.createObjectURL(record.blob);
});
onUnmounted(() => { previewRequest++; if (cachedPreview.value) URL.revokeObjectURL(cachedPreview.value); });
async function run(action: () => unknown | Promise<unknown>) {
  if (busy.value) return; busy.value = true; feedback.value = '';
  try { await action(); } catch (error) { feedback.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}
async function roll(next = false) {
  if (next) materialSeed.value++;
  candidate.value = rollMaterial(materials.value, { query: query.value, kind: kind.value, setting: followWorld.value && kind.value !== 'character' ? world.value.setting : 'auto', work: work.value === '*' ? undefined : work.value }, materialSeed.value) ?? null;
  if (!candidate.value && kind.value === 'character' && results.value.length) throw new Error('同名角色存在多个作品，请先选择作品');
  if (!candidate.value) {
    if (!query.value.trim()) throw new Error('请输入角色名或服装类型');
    candidate.value = await createVisualDesign(query.value, kind.value, liveWorld.value.setting);
    feedback.value = '本地库未命中，LLM 已创作候选（非已验证同人数据库）；正在生成预览';
  }
  if (!candidate.value.previewPath && !candidate.value.previewKey) await draw();
  feedback.value = '候选已准备，可收藏或应用；剧情人物尚未改变';
}
async function draw() {
  if (!candidate.value) return;
  const result = await drawVisualPreview(candidate.value);
  candidate.value = result.material; imageSeed.value = result.imageSeed;
  feedback.value = '真实生图预览已保存；款式未变，尚未收藏或应用';
}
function edit() {
  const material = normalizeMaterial(JSON.parse(json.value)); if (!material) throw new Error('素材结构无效');
  candidate.value = material; feedback.value = '已更新候选；没有改变人物或剧情';
}
async function collect() {
  if (!candidate.value) return;
  const selectedVibe = settings.nai.vibes.find(v => v.id === vibeId.value) ?? (candidate.value.vibe?.id === vibeId.value ? candidate.value.vibe : undefined);
  candidate.value = saveMaterial({ ...candidate.value, vibe: selectedVibe ? await freezeVisualReference(selectedVibe) : undefined });
  feedback.value = '已收藏素材新版本；人物穿搭未改变';
}
async function apply() {
  if (!candidate.value || !chosenCharacter.value) throw new Error('请选择素材与目标人物');
  const ctx = getContext(), targetFloor = floor.value, targetLine = line.value, chatId = ctx?.getCurrentChatId();
  const message = ctx?.chat[targetFloor]; if (!ctx || !message || !parseImageTags(message.mes).length) throw new Error('请先为目标楼层生成 tag，再应用并重编译');
  const revision = transcriptRevision(ctx.chat, targetFloor), prior = readCharTagFloorDelta(message);
  if (prior?.scene && prior.scene.revision !== revision) throw new Error('剧情已编辑，请先重新分析目标楼层');
  const character = cloneVisual(chosenCharacter.value), selected = cloneVisual(candidate.value);
  const reference = settings.nai.vibes.find(v => v.id === vibeId.value) ?? (selected.vibe?.id === vibeId.value ? selected.vibe : undefined);
  selected.vibe = reference ? await freezeVisualReference(reference) : undefined;
  if (getContext()?.getCurrentChatId() !== chatId || transcriptRevision(getContext()?.chat ?? [], targetFloor) !== revision) throw new Error('参考处理期间聊天/消息已变化，本次未应用');
  bindMaterialToCharacter(character, selected, scope.value, mode.value, targetFloor, targetLine, materialSeed.value);
  await recompileFloorVisuals(targetFloor);
  feedback.value = '已建立带版本快照的绑定并重编译本楼；点击原楼图片卡可重画';
}
function saveShape() {
  const c = chosenCharacter.value; if (!c) throw new Error('请选择人物');
  const raw = JSON.parse(appearanceDraft.value) as Record<string, unknown>;
  const appearance = Object.fromEntries(Object.entries(raw).filter(([k, v]) => ['fandom', 'hair', 'eyes', 'skin', 'body', 'extra'].includes(k) && typeof v === 'string')) as Record<string, string>;
  if (!Object.keys(appearance).length) throw new Error('请填写结构化外貌字段');
  recordManualVisualEvent(floor.value, { name: c.name, characterId: c.characterId, kind: 'design', sourceLine: line.value, evidence: '用户确认定妆', baseAppearance: appearance });
  feedback.value = '定妆已确认并记录生效位置；可重编译本楼应用';
}
function saveGarments() {
  const c = chosenCharacter.value; if (!c) throw new Error('请选择人物');
  const raw = JSON.parse(garmentDraft.value);
  if (!Array.isArray(raw) || !raw.length) throw new Error('请填写衣物部件数组');
  const allowed: Record<string, string[]> = { arrangement: ['unknown','normal','lifted','pulled_aside','lowered','around_waist','around_ankles'], location: ['unknown','on_body','held','on_chair','on_table','removed','absent'], fastening: ['unknown','open','closed','loose'], leftSleeve: ['unknown','on_arm','off_arm','rolled_up','damaged'], rightSleeve: ['unknown','on_arm','off_arm','rolled_up','damaged'] };
  if (raw.some(g => !g.id || typeof g.design !== 'string' || Object.entries(g.state ?? {}).some(([k, v]) => !allowed[k]?.includes(String(v))))) throw new Error('衣物 ID、设计或状态枚举无效');
  if (new Set(raw.map(g => g.id)).size !== raw.length) throw new Error('衣物部件 ID 不可重复');
  const onlyState = raw.length === c.outfit?.garments.length && raw.every(g => c.outfit?.garments.some(old => old.id === g.id && old.design === g.design));
  recordManualVisualEvent(floor.value, { name: c.name, characterId: c.characterId, kind: 'outfit', sourceLine: line.value, evidence: '用户人工修正衣物', operation: onlyState ? 'patch' : 'change', garments: raw });
  feedback.value = '衣物部件和状态已记录；可重编译本楼应用';
}
async function loadFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  if (file.size > 10_000_000) throw new Error('导入文件超过 10 MB');
  const count = importMaterials(await file.text()); feedback.value = `已导入 ${count} 条素材；未应用到剧情`;
}
function download() {
  const url = URL.createObjectURL(new Blob([exportMaterials()], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'baibai-visual-materials.json'; a.click(); URL.revokeObjectURL(url);
}
</script>

<template>
  <Collapsible title="自动视觉管理 · 素材抽样" :open="true">
    <p class="bbi-field-hint">生图时自动调用已保存的自动 tag LLM：识别世界、补全首次定妆、挑选素材并保存到剧情状态。已有定妆与穿搭直接继承，不用填写下面的高级字段。</p>
    <p class="bbi-field-hint">当前世界：{{ eraOptions.find(o => o.value === liveWorld.setting)?.label }} · {{ liveWorld.provenance }} · 可用素材 {{ materials.length }} 条</p>
    <p class="bbi-field-hint">自动档案 {{ sceneStore.current.characters.length }} 人；定妆、已绑定素材与实际衣物状态请在「角色管理」查看。首次定妆会额外调用一次 LLM，重画不调用。</p>
    <fieldset :disabled="busy" class="bbi-visual-controls">
      <Collapsible title="高级：覆盖自动识别（可留空）" :open="false">
        <label>世界背景 <select v-model="world.setting"><option v-for="option in eraOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        <label>默认服装 <select v-model="world.wardrobeDefaults"><option value="">按世界过滤后补全</option><option v-for="material in materials.filter(m => m.kind === 'outfit')" :key="material.id" :value="material.id">{{ material.name }}</option></select></label>
        <label>通用画风（不填具体脸型）<input v-model="world.visualStyle" class="bbi-input" /></label>
        <label>默认发式/饰物倾向<input v-model="world.characterStylingDefaults" class="bbi-input" /></label>
        <button class="bbi-btn" @click="run(() => { saveWorldProfile(world); feedback = '世界档案已保存；只补全未知穿搭，不覆盖已有状态或剧情例外'; })">保存世界档案</button>
      </Collapsible>

      <div class="bbi-visual-row">
        <select v-model="kind"><option value="outfit">服装款式</option><option value="character">人物/同人外貌</option><option value="style">画风</option></select>
        <input v-model="query" class="bbi-input" placeholder="中文名/别名/服装类型，如：仙侠剑修、JK" />
        <select v-if="kind === 'character'" v-model="work"><option value="*">全部作品（同名需消歧）</option><option v-for="title in works" :key="title" :value="title">{{ title || '未标作品' }}</option></select>
      </div>
      <div class="bbi-visual-row">
        <button class="bbi-btn" @click="run(() => roll())">库内抽样</button><button class="bbi-btn" @click="run(() => roll(true))">换个款式</button>
        <button class="bbi-btn" @click="run(async () => { candidate = await createVisualDesign(query, kind, world.setting); feedback = '新款结构已生成，标签未验证；可真实生图预览'; })">创作新款</button>
        <span class="bbi-field-hint">款式种子 {{ materialSeed }} · 图片种子 {{ imageSeed ?? '未生图' }}</span>
      </div>
      <label class="bbi-visual-check"><input v-model="followWorld" type="checkbox" />库内抽样只看符合当前世界的服装（未标时代的旧素材需手动选择）</label>
      <p class="bbi-field-hint">已接入原素材库的服装、同人与已有预览。中文名先查库；无图片的条目可生成预览，不会冒充网络图库。收藏不会改变剧情，应用会创建版本绑定。</p>
      <details>
        <summary>匹配结果与来源（{{ results.length }}）</summary>
        <p v-if="!results.length" class="bbi-field-hint">未命中：检查世界、类型和作品过滤，或导入素材。</p>
        <button v-for="result in results" :key="result.material.id" class="bbi-btn" @click="candidate = cloneVisual(result.material)">{{ result.material.name }} · {{ result.material.work }} · {{ result.material.variant }} · v{{ result.material.version }} — {{ result.reason }}</button>
        <p v-for="excluded in exclusions" :key="excluded.name" class="bbi-field-hint">排除 {{ excluded.name }}：{{ excluded.reason }}</p>
      </details>
      <div v-if="candidate" class="bbi-visual-candidate">
        <strong>{{ candidate.name }} · {{ candidate.variant }} · v{{ candidate.version }}</strong>
        <img v-if="candidate.previewPath || cachedPreview" :src="candidate.previewPath || cachedPreview" alt="素材真实预览" @error="feedback = '预览不存在或无法加载；没有替换成虚构图片'" />
        <p v-else class="bbi-field-hint">此素材暂无预览图片。</p>
        <p class="bbi-field-hint">来源：{{ candidate.source }} · {{ candidate.verified ? '用户已确认标签' : '标签尚未验证' }}</p>
        <BbiTextarea :model-value="candidate.tags || candidate.garments.map(g => g.design).join(', ') || Object.values(candidate.appearance).join(', ')" readonly :rows="3" />
        <label class="bbi-visual-check"><input v-model="candidate.verified" type="checkbox" />我已核对素材标签</label>
        <label>可选已编码参考 <select v-model="vibeId"><option value="">无人物参考</option><option v-if="candidate.vibe && !settings.nai.vibes.some(v => v.id === candidate?.vibe?.id)" :value="candidate.vibe.id">{{ candidate.vibe.name }}（版本快照）</option><option v-for="vibe in settings.nai.vibes" :key="vibe.id" :value="vibe.id">{{ vibe.name }}</option></select></label>
        <p class="bbi-field-hint">参考只对单人图使用共享 Vibe；多人跳过人物 Vibe 并记录降级。不将服装预览当作人物锁脸。</p>
        <div class="bbi-visual-row"><button class="bbi-btn" @click="run(draw)">重画这套 / 生成真实预览</button><button class="bbi-btn" @click="run(collect)">收藏款式</button></div>
        <details><summary>编辑素材结构 / 上传素材格式参考</summary><BbiTextarea v-model="json" :rows="12" /><button class="bbi-btn" @click="run(edit)">更新候选设计</button></details>
      </div>

      <Collapsible title="目标人物、定妆与衣物状态" :open="false">
        <label>目标楼层 <input v-model.number="floor" type="number" min="0" /></label>
        <label>生效正文位置 <select v-model.number="line"><option v-for="position in positions" :key="position.id" :value="position.sourceLine">{{ position.id }} · {{ position.text.slice(0, 50) }}</option></select></label>
        <label>人物 <select v-model="characterId" aria-label="目标人物"><option value="">请选择</option><option v-for="c in characters" :key="c.characterId" :value="c.characterId">{{ c.name }} · {{ c.work }} · {{ c.characterId }}</option></select></label>
        <div v-if="chosenCharacter">
          <label>别名（逗号分隔）<input v-model="aliasDraft" class="bbi-input" /></label><label>作品/身份区分<input v-model="workDraft" class="bbi-input" /></label>
          <button class="bbi-btn" @click="run(() => { if (chosenCharacter) confirmIdentity(chosenCharacter, chosenCharacter.identity.gender, chosenCharacter.isHeroine, aliasDraft.split(/[,，]/).map(a => a.trim()).filter(Boolean), workDraft); })">确认别名和作品</button>
          <details><summary>稳定外貌定妆（结构化字段）</summary><BbiTextarea v-model="appearanceDraft" :rows="8" /><button class="bbi-btn" @click="run(saveShape)">确认此定妆</button></details>
          <details><summary>衣物部件和状态（兼容旧服装记录）</summary><p class="bbi-field-hint">id 为部件名；design 只写款式。location: on_body / on_chair / on_table / held / removed / absent / unknown；fastening: open / closed / loose / unknown。左右袖 leftSleeve / rightSleeve 可为 on_arm / off_arm / rolled_up / damaged / unknown。</p><BbiTextarea v-model="garmentDraft" :rows="12" /><button class="bbi-btn" @click="run(saveGarments)">确认衣物状态</button></details>
        </div>
        <label>套用范围 <select v-model="scope"><option value="outfit">只套用服装</option><option value="appearance">只套用外貌</option><option value="style">只套用画风</option><option value="all">整套视觉</option></select></label>
        <label>换装方式 <select v-model="mode"><option value="preserve">替换款式，保留能对应的部件状态</option><option value="change">执行完整换装</option></select></label>
        <div class="bbi-visual-row"><button class="bbi-btn" :disabled="!candidate || !chosenCharacter" @click="run(apply)">应用候选到目标人物</button><button class="bbi-btn" @click="run(async () => { await recompileFloorVisuals(floor); feedback = '已按各图对应位置重编译；未请求 LLM 或抽选新素材'; })">按状态重编译本楼</button><button class="bbi-btn" @click="run(() => { undoManualVisualEvent(); feedback = '已撤销上一项视觉操作，可重新编译本楼恢复提示词'; })">撤销上次视觉操作</button></div>
      </Collapsible>

      <Collapsible title="素材导入、导出与接入点能力" :open="false">
        <p v-if="visualLibrary.error">{{ visualLibrary.error }}</p>
        <input type="file" accept="application/json,.json" @change="event => run(() => loadFile(event))" /><button class="bbi-btn" @click="download">导出素材库</button>
        <BbiTextarea v-model="transfer" :rows="5" placeholder='粘贴 {"v":1,"records":[素材对象]}' /><button class="bbi-btn" @click="run(() => { feedback = `已导入 ${importMaterials(transfer)} 条素材`; })">导入 JSON</button>
        <p class="bbi-field-hint">当前 NAI 接入点：{{ endpoint.name }}。不会自动发收费生图探测代理能力；根据实际支持情况禁用字段。</p>
        <label>独立人物提示 <select v-model="capability.characters"><option value="auto">按模型协议</option><option value="off">代理不支持，禁用</option></select></label>
        <label>Vibe 参考 <select v-model="capability.vibes"><option value="auto">按模型协议</option><option value="off">代理不支持，禁用</option></select></label>
        <label>提示字符预算（0 不裁剪）<input v-model.number="capability.maxPromptChars" type="number" min="0" /></label>
        <button class="bbi-btn" @click="run(() => { saveCapabilityOverride(endpoint.id, capability); feedback = '接入点能力覆盖已保存'; })">保存能力配置</button>
        <p class="bbi-field-hint">{{ resolvedCapability.source }}；参考模式：共享 Vibe，无法保证逐人锁脸。</p>
      </Collapsible>
    </fieldset>
    <p v-if="feedback" role="status" class="bbi-field-hint">{{ feedback }}</p><p v-if="busy" class="bbi-field-hint">正在处理，请稍候…</p>
  </Collapsible>
</template>

<style scoped>
.bbi-visual-controls { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 12px; }
.bbi-visual-controls label { display: grid; gap: 5px; margin: 10px 0; }
.bbi-visual-controls input, .bbi-visual-controls select { max-width: 100%; min-width: 0; color: var(--bbi-ink); background: var(--bbi-surface); border: 1px solid var(--bbi-line); border-radius: 6px; padding: 7px; }
.bbi-visual-controls label.bbi-visual-check { display: flex; align-items: center; }
.bbi-visual-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.bbi-visual-candidate { border: 1px solid var(--bbi-line); padding: 12px; border-radius: 8px; }
.bbi-visual-candidate img { display: block; max-width: 100%; max-height: 320px; object-fit: contain; margin: 10px auto; }
details { margin: 10px 0; } summary { cursor: pointer; }
</style>
