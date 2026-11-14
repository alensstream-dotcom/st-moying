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
  it('agy 池:先退到实测最稳的 4-argon,再给自己加抗截断前缀', () => {
    // 实测(配紧缩契约):裸 3.8-flash 24/30,抗截断 3.8-flash 4/12 → 加前缀是降级;
    // 裸 4-argon 6/15,抗截断 4-argon 12/15 → 换到 4-argon 才是升级。
    expect(fallbackModels('agy-gemini-3.8-flash-high')).toEqual([
      '抗截断-agy-gemini-4-argon-high',
      '抗截断-agy-gemini-3.8-flash-high',
    ]);
    // 用户选的就是 4-argon 时两级重合,去重后只剩一个
    expect(fallbackModels('agy-gemini-4-argon-high')).toEqual(['抗截断-agy-gemini-4-argon-high']);
  });

  it('pg 池:退到同代的 hydrogen,不退老一代', () => {
    expect(fallbackModels('pg-gemini-3.8-flash')).toEqual([
      '抗截断-pg-gemini-4-hydrogen',
      '抗截断-pg-gemini-3.8-flash',
    ]);
    // 关键:绝不能给 pg 造出 2.5 这种该池不存在的名字(会变成 NOMODEL 白跑一轮)
    expect(fallbackModels('pg-gemini-3.6-flash')).not.toContain('抗截断-pg-gemini-2.5-flash');
  });

  it('退到别的模型时不许退到 3.8 之前的低智力模型', () => {
    // 用户明确要求(m11627):智力不够的模型不许进梯队。过滤问题由紧缩契约解决,
    // 不靠降智换通过率。第一级只是给用户自己选的模型加 `抗截断-` 前缀(同一模型、同一代),
    // 真正换模型的是厂商兜底级 —— 那些必须落在 3.8 或 4.x 上。
    for (const start of [
      'agy-gemini-3.8-flash-high',
      'agy-gemini-4-argon-high',
      'pg-gemini-3.8-flash',
      'pg-gemini-3.6-flash',
    ]) {
      for (const level of fallbackModels(start)) {
        const bare = level.replace(/^(?:假流式-|抗截断-)+/, '');
        // 只有「原本就是用户选的模型」允许保留它自己的代号
        if (bare === start) continue;
        expect(bare).toMatch(/gemini-(?:3\.8|4)-/);
      }
    }
  });

  it('已经是梯队内那一级时不重复自己', () => {
    expect(fallbackModels('抗截断-agy-gemini-4-argon-high')).toEqual([]);
    expect(fallbackModels('抗截断-pg-gemini-4-hydrogen')).toEqual([]);
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
