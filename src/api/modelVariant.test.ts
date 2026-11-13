import { describe, expect, it } from 'vitest';
import {
  antiTruncationModel,
  fallbackModels,
  looksLikeBadSchema,
  looksLikeMissingModel,
} from '@/api/modelVariant';

describe('网关抗截断模型变体', () => {
  it('给裸模型加抗截断前缀', () => {
    expect(antiTruncationModel('agy-gemini-3.8-flash-high')).toBe('抗截断-agy-gemini-3.8-flash-high');
    expect(antiTruncationModel('agy-gemini-4-argon-high')).toBe('抗截断-agy-gemini-4-argon-high');
  });

  it('已有前缀的模型不再叠加', () => {
    expect(antiTruncationModel('抗截断-agy-gemini-3.8-flash-high')).toBeNull();
  });

  it('先剥掉假流式前缀再加抗截断', () => {
    expect(antiTruncationModel('假流式-agy-gemini-3.8-flash-high')).toBe(
      '抗截断-agy-gemini-3.8-flash-high',
    );
  });

  it('假流式与抗截断叠加的模型已经是变体，不再叠加', () => {
    expect(antiTruncationModel('假流式-抗截断-agy-gemini-3.8-flash-high')).toBeNull();
  });

  it('空模型名无法切换', () => {
    expect(antiTruncationModel('')).toBeNull();
    expect(antiTruncationModel('   ')).toBeNull();
  });
});

describe('失败后的模型降级梯队', () => {
  it('agy 池:先换抗截断,再退到 2.5-flash（过滤口径更松）', () => {
    expect(fallbackModels('agy-gemini-3.8-flash-high')).toEqual([
      '抗截断-agy-gemini-3.8-flash-high',
      '抗截断-agy-gemini-2.5-flash',
    ]);
    expect(fallbackModels('agy-gemini-4-argon-high')).toEqual([
      '抗截断-agy-gemini-4-argon-high',
      '抗截断-agy-gemini-2.5-flash',
    ]);
  });

  it('pg 池没有 2.5 系列,退到实测最稳的 3.5-flash-lite', () => {
    expect(fallbackModels('pg-gemini-3.8-flash')).toEqual([
      '抗截断-pg-gemini-3.8-flash',
      '抗截断-pg-gemini-3.5-flash-lite',
    ]);
    // 关键:绝不能给 pg 造出 2.5 这种该池不存在的名字(会变成 NOMODEL 白跑一轮)
    expect(fallbackModels('pg-gemini-3.6-flash')).not.toContain('抗截断-pg-gemini-2.5-flash');
  });

  it('已经是梯队内那一级时不重复自己', () => {
    expect(fallbackModels('抗截断-agy-gemini-2.5-flash')).toEqual([]);
    expect(fallbackModels('抗截断-pg-gemini-3.5-flash-lite')).toEqual([]);
  });

  it('未知厂商只加抗截断前缀', () => {
    expect(fallbackModels('gpt-4o-mini')).toEqual(['抗截断-gpt-4o-mini']);
  });

  it('空名没有梯队', () => {
    expect(fallbackModels('')).toEqual([]);
  });
});

describe('识别「模型不存在」', () => {
  it('认得常见的模型缺失文案', () => {
    expect(looksLikeMissingModel('副 API 请求失败 (404): {"error":{"message":"model not found"}}')).toBe(true);
    expect(looksLikeMissingModel('The model `抗截断-x` does not exist')).toBe(true);
    expect(looksLikeMissingModel('模型不存在')).toBe(true);
  });

  it('拦截不算模型缺失,避免把降载路径带偏', () => {
    expect(looksLikeMissingModel('被渠道内容过滤拦下(finish_reason=content_filter)')).toBe(false);
    expect(looksLikeMissingModel('副 API 请求失败 (400): content_filter')).toBe(false);
  });

  it('普通错误不算', () => {
    expect(looksLikeMissingModel('副 API 返回空内容(finish_reason=stop)')).toBe(false);
    expect(looksLikeMissingModel('')).toBe(false);
  });
});

describe('识别「输出不是合规 JSON」', () => {
  it('pg 池的真实失败形态要认出来', () => {
    expect(looksLikeBadSchema('AI 没有返回可解析的 JSON 对象')).toBe(true);
    expect(looksLikeBadSchema('AI 返回的 JSON 缺少 images 数组')).toBe(true);
    expect(looksLikeBadSchema('AI 给出的 2 张图片都没有可落地的位置（position=P99 不在目标正文可选位置中）')).toBe(
      true,
    );
    expect(looksLikeBadSchema('Unexpected end of JSON input')).toBe(true);
  });

  it('拦截/截断/模型缺失各有各的路径，不在这里抢', () => {
    expect(looksLikeBadSchema('被渠道内容过滤拦下(finish_reason=content_filter)')).toBe(false);
    expect(looksLikeBadSchema('输出被截断(finish_reason=length)')).toBe(false);
    expect(looksLikeBadSchema('副 API 请求失败 (404): model not found')).toBe(false);
  });

  it('语义类校验失败不算(换模型照样会犯)', () => {
    expect(looksLikeBadSchema('第 1 张图景别过远，建议改成 close-up')).toBe(false);
    expect(looksLikeBadSchema('画面事实不符：正文这一格没有 1boy')).toBe(false);
    expect(looksLikeBadSchema('')).toBe(false);
  });
});
