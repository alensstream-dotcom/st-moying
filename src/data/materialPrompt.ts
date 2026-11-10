import type { GenerationMeta } from '@/generationMeta';
/** Display the immutable request that produced the picture, never today's edited tags. */
export function materialPrompt(meta: GenerationMeta | undefined, original: string): string {
  if (!meta) return '素材标签：' + original + '\n旧图或导入图片没有完整生成记录，无法还原当时的固定提示词。';
  const p = meta.params;
  return [
    `${meta.model} · ${meta.width}×${meta.height}`,
    `采样：${p?.sampler || '工作流默认'} · 步数 ${p?.steps ?? '未知'} · CFG ${p?.cfg ?? '未知'} · CFG Rescale ${p?.cfgRescale ?? '默认'} · 噪声表 ${p?.noiseSchedule || p?.scheduler || '默认'}`,
    '完整正向提示词：\n' + meta.positive,
    '完整负向提示词：\n' + meta.negative,
  ].join('\n\n');
}
