import { describe, expect, it } from 'vitest';
import { antiTruncationModel, fallbackModels, looksLikeMissingModel } from '@/api/modelVariant';

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

describe('被拦后的模型降级梯队', () => {
  it('gemini 3/4 系先换抗截断,再退到同厂商 2.5-flash', () => {
    expect(fallbackModels('agy-gemini-3.8-flash-high')).toEqual([
      '抗截断-agy-gemini-3.8-flash-high',
      '抗截断-agy-gemini-2.5-flash',
    ]);
    expect(fallbackModels('agy-gemini-4-argon-high')).toEqual([
      '抗截断-agy-gemini-4-argon-high',
      '抗截断-agy-gemini-2.5-flash',
    ]);
    expect(fallbackModels('pg-gemini-3.8-flash')).toEqual([
      '抗截断-pg-gemini-3.8-flash',
      '抗截断-pg-gemini-2.5-flash',
    ]);
  });

  it('2.5 及更早不再往下降', () => {
    expect(fallbackModels('agy-gemini-2.5-flash')).toEqual(['抗截断-agy-gemini-2.5-flash']);
  });

  it('已经是最低一级时不重复自己', () => {
    expect(fallbackModels('抗截断-agy-gemini-2.5-flash')).toEqual([]);
  });

  it('不含 gemini 字样的模型只加抗截断前缀', () => {
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
