<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import {
  onThumbJobState,
  onThumbTaskDone,
  thumbJobState,
  startThumbJob,
  stopThumbJob,
  type ThumbTask,
} from '@/data/loreThumbJob';
import { settings, effectiveNai, activeOrientationLock } from '@/state/settings';
import { naiArtistPrompt, naiQualityTags, fullNegativePrompt } from '@/backends/nai';
import { effectiveOrientation, pickSize } from '@/backends/size';
import { genPresetList, applyPresetToNaiConn } from '@/state/genPresets';
const props = defineProps<{ tasks: ThumbTask[]; scene?: string }>();
const emit = defineEmits<{ changed: [] }>();
const job = ref(thumbJobState()),
  feedback = ref(''),
  force = ref(false),
  preset = ref(''),
  model = ref(''),
  interval = ref(settings.autoTag.lore.thumbIntervalMs / 1000);
const scene = ref(
  props.scene ??
    (props.tasks[0]?.kind === 'face'
      ? 'solo, centered composition'
      : 'solo, full body, standing, looking at viewer, centered composition, simple background'),
);
const presets = computed(() => genPresetList());
const config = computed(() => {
  const selected = presets.value.find((p) => p.id === preset.value);
  const backend = selected?.backend ?? settings.defaultBackend;
  if (backend !== 'nai') return { summary: 'ComfyUI · 当前工作流及其尺寸', positive: '', negative: '' };
  const conn = effectiveNai();
  if (selected) applyPresetToNaiConn(conn, selected);
  if (model.value.trim()) conn.model = model.value.trim() as typeof conn.model;
  return {
    summary: `${conn.model} · ${conn.steps} 步 · CFG ${conn.scale} · ${conn.sampler} · ${conn.noiseSchedule} · ${pickSize(conn, effectiveOrientation(activeOrientationLock(), 'portrait'))}`,
    positive: [naiArtistPrompt(conn), naiQualityTags(conn)].filter(Boolean).join(', '),
    negative: fullNegativePrompt(conn),
  };
});
const off = onThumbJobState((s) => (job.value = s)),
  offTask = onThumbTaskDone(() => emit('changed'));
function enqueue() {
  try {
    if (!props.tasks.length) throw new Error('请先选素材或缩小筛选范围');
    const selected = presets.value.find((p) => p.id === preset.value);
    const count = startThumbJob(
      props.tasks.map((t) => ({
        ...t,
        scene: t.scene ?? scene.value,
        genPresetId: selected?.id ?? '',
        backend: selected?.backend ?? settings.defaultBackend,
        naiModel: model.value.trim(),
      })),
      interval.value * 1000,
      force.value,
    );
    feedback.value = count
      ? `已提交 ${count} 项；默认跳过标签相同且已有预览的素材`
      : '这些素材已在队列中，不会重复生成';
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  }
}
onUnmounted(() => {
  off();
  offTask();
});
</script>
<template>
  <section class="queue-bar">
    <div class="queue-tools">
      <button class="bbi-btn bbi-btn-primary" :disabled="!tasks.length" @click="enqueue">
        {{ job.running ? '追加到队列' : '排队生成预览' }} · {{ tasks.length }} 项</button
      ><button v-if="job.running" class="bbi-btn" @click="stopThumbJob">停止队列</button
      ><label><input v-model="force" type="checkbox" />重画已有预览</label>
    </div>
    <p class="actual-config">本次配置：{{ config.summary }}</p>
    <details>
      <summary>预览配置 · 沿用已保存配置，不修改剧情生图设置</summary>
      <div class="queue-tools">
        <label
          >生图预设<select v-model="preset" class="bbi-input">
            <option value="">跟随当前剧情生图配置</option>
            <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select></label
        ><label
          >NAI 模型覆盖<input
            v-model="model"
            class="bbi-input"
            placeholder="留空跟随预设 / 当前模型" /></label
        ><label
          >间隔（秒）<input v-model.number="interval" class="bbi-input" type="number" min="3" max="120"
        /></label>
      </div>
      <label>统一预览构图<input v-model="scene" class="bbi-input" /></label>
      <p>固定正向词：{{ config.positive || '由当前工作流提供' }}</p>
      <p>固定负向词：{{ config.negative || '由当前工作流提供' }}</p>
      <p>
        更换配置后，请勾选“重画已有预览”，否则仍会显示已缓存的旧图。同人默认不限制半身或全身；可自行添加 full
        body（全身）、cowboy shot（半身）或 portrait（肖像）来控制取景。
      </p>
      <p>
        素材标签与统一构图会叠加当前画师串、质量词和负面词；预设只替换模型与采样参数。不读取剧情人物外貌、不绑定角色，也不自动携带角色参考图。点击生成后按所选渠道计费。切换插件页面会继续排队；刷新或关闭酒馆会停止，已完成图片保留，下次可跳过补齐。
      </p>
    </details>
    <p v-if="job.total" role="status">
      {{ job.running ? '正在排队' : '队列已停止 / 完成' }}：{{ job.done }} 完成（{{
        job.skipped
      }}
      项使用已有图），{{ job.failed }} 失败 / {{ job.total }} 项 {{ job.current ? ' · ' + job.current : '' }}
    </p>
    <details v-if="job.lastGeneration">
      <summary>最近生成的实际参数与提示词</summary>
      <p>
        {{ job.lastGeneration.model }} · {{ job.lastGeneration.width }}×{{ job.lastGeneration.height }} ·
        {{ job.lastGeneration.params?.steps }} 步 · CFG {{ job.lastGeneration.params?.cfg }}
      </p>
      <p>正向：{{ job.lastGeneration.positive }}</p>
      <p>负向：{{ job.lastGeneration.negative }}</p>
    </details>
    <p v-if="job.lastError" role="status">{{ job.lastError }}</p>
    <p v-if="feedback" role="status">{{ feedback }}</p>
  </section>
</template>
<style scoped>
.queue-bar {
  border: 1px solid #8884;
  border-radius: 6px;
  padding: 12px 14px;
  margin: 14px 0;
}
.queue-tools {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.queue-tools label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.queue-tools input[type='number'] {
  max-width: 90px;
}
.queue-bar details {
  margin: 10px 0;
}
.queue-bar summary {
  cursor: pointer;
}
.queue-bar p {
  font-size: 0.85em;
  line-height: 1.6;
  margin: 8px 0;
}
.queue-bar label > .bbi-input {
  margin: 5px 0;
}
@media (max-width: 600px) {
  .queue-tools label {
    flex-wrap: wrap;
  }
}
</style>
