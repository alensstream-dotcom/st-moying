import { describe, expect, it } from 'vitest';
import {
  antiTruncationModel,
  fallbackModels,
  looksLikeBadRequest,
  looksLikeBadSchema,
  looksLikeCredentialFailure,
  looksLikeMissingModel,
  looksLikeTimeout,
  looksLikeUpstreamJitter,
  needsCatalog,
} from '@/api/modelVariant';

describe('自建站(模型名没有厂商前缀)的同族挑选', () => {
  // 真实渠道清单(odyfree,8 个):实测只有带「防外审」的那个能承载插件那份 6.5 万字符请求。
  const CATALOG = [
    'gemini-4-hydrogen-单u300k支持工具',
    'gemini-4-hydrogen-防外审注入单u100k不支持工具',
    'gemini-4-hydrogen-原生1M支持工具',
    'gemini-4-hydrogen-low-原生1M支持工具',
    'gemini-4-hydrogen-medium-原生1M支持工具',
    'gemini-4-hydrogen-high-原生1M支持工具',
    'gemini-4-hydrogen-xhigh-原生1M支持工具',
    'gemini-4-hydrogen-原生1M防外审注入不支持工具',
  ];

  it('没有厂商前缀时按清单挑同族,而不是硬造 抗截断- 名字', () => {
    const ladder = fallbackModels('gemini-4-hydrogen-high-原生1M支持工具', CATALOG);
    expect(ladder.length).toBeGreaterThan(0);
    // 首选必须是实测 6/6 通过的那个
    expect(ladder[0]).toBe('gemini-4-hydrogen-原生1M防外审注入不支持工具');
    // 自建站上绝不出现「抗截断-」这种猜出来的名字:那个站没有这类变体,试了就是 400/404。
    // 0.2.0 的事故就是它无条件挂在梯队末位,把每一次「换模型重试」的最后一发都打空。
    expect(ladder.some((m) => m.startsWith('抗截断-'))).toBe(false);
  });

  it('「high/medium/low」这类档位词要往后排(实测它们全超时)', () => {
    const ladder = fallbackModels('gemini-4-hydrogen-原生1M支持工具', CATALOG);
    const best = ladder.indexOf('gemini-4-hydrogen-原生1M防外审注入不支持工具');
    const highTier = ladder.findIndex((m) => /-high-/.test(m) || /-medium-/.test(m) || /-low-/.test(m));
    if (highTier >= 0) expect(best).toBeLessThan(highTier);
  });

  it('没有清单时自建站拿不到任何备用名(不猜前缀)', () => {
    const ladder = fallbackModels('gemini-4-hydrogen-high-原生1M支持工具');
    // 自建站的模型名由站主自己起,加 `抗截断-` 前缀的猜中率接近零,
    // 与其发一次必然 400 的请求,不如老实承认「这家站没有别的名字可换」。
    expect(ladder).toEqual([]);
  });

  it('给了清单但没有同族兄弟时,同样不猜前缀', () => {
    const ladder = fallbackModels('gemini-4-hydrogen-high-原生1M支持工具', ['gpt-4o', 'claude-3-opus']);
    expect(ladder).toEqual([]);
  });
});

describe('什么时候需要拉渠道清单', () => {
  // 这条判据的第一版写错过:用「fallbackModels 返回空」判,结果永远不成立
  // (它总会追加一条「加抗截断前缀」的兜底),于是自建站从来走不到清单挑选。
  it('没有厂商前缀 → 需要清单', () => {
    expect(needsCatalog('gemini-4-hydrogen-high-原生1M支持工具')).toBe(true);
    expect(needsCatalog('gemini-4-hydrogen-原生1M防外审注入不支持工具')).toBe(true);
  });

  it('已知厂商 → 不需要清单(直接用 VENDOR_FALLBACK)', () => {
    expect(needsCatalog('agy-gemini-3.8-flash-high')).toBe(false);
    expect(needsCatalog('pg-gemini-3.6-flash')).toBe(false);
    expect(needsCatalog('抗截断-agy-gemini-4-argon-high')).toBe(false);
  });

  it('空名字不拉清单', () => {
    expect(needsCatalog('')).toBe(false);
  });
});

describe('上游超时也属于「该换模型」', () => {
  it('认得渠道回的 upstream_timeout', () => {
    expect(looksLikeTimeout('上游响应超时，请重试')).toBe(true);
    expect(looksLikeTimeout('{"error":{"code":"upstream_timeout"}}')).toBe(true);
    expect(looksLikeTimeout('rate_limit_exceeded')).toBe(true);
  });

  it('用户取消 / 本地 abort 不算(换模型毫无意义)', () => {
    expect(looksLikeTimeout('已取消')).toBe(false);
    expect(looksLikeTimeout('AbortError: aborted')).toBe(false);
    expect(looksLikeTimeout('')).toBe(false);
  });

  it('模型不存在不当成超时(它有自己的跳过逻辑)', () => {
    expect(looksLikeMissingModel('Model not found')).toBe(true);
    expect(looksLikeTimeout('Model not found')).toBe(false);
  });
});

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

  it('未知厂商(也不在梯队里)不给猜出来的名字', () => {
    // gpt-4o-mini 既没有厂商表项、也没有清单,猜 `抗截断-gpt-4o-mini` 只会换来一次 400。
    expect(fallbackModels('gpt-4o-mini')).toEqual([]);
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
  });

  it('上游抖动不算「模型不守协议」:同一级重发就过,换掉好模型才是损失', () => {
    // 实测 odyfree 第 5/6/7 楼:502 + `Unexpected end of JSON input`,是中转站解析它自己的
    // 上游时炸了,同一份请求重发就成功(探针连跑 5 次,失败的两次重发都过)。
    expect(looksLikeBadSchema('副 API 请求失败 (502): {"error":{"message":"Unexpected end of JSON input"}}')).toBe(
      false,
    );
    expect(looksLikeUpstreamJitter('副 API 请求失败 (502): {"error":{"message":"Unexpected end of JSON input"}}')).toBe(
      true,
    );
    expect(looksLikeUpstreamJitter('ApiError: Bad Gateway')).toBe(true);
    expect(
      looksLikeUpstreamJitter('{"error":{"message":"Invalid response body while trying to fetch https://x/v1/chat/completions: Premature close","code":"ERR_STREAM_PREMATURE_CLOSE"}}'),
    ).toBe(true);
    expect(looksLikeUpstreamJitter('fetch failed: socket hang up')).toBe(true);
    expect(looksLikeUpstreamJitter('ECONNRESET')).toBe(true);
    expect(looksLikeUpstreamJitter('副 API 请求失败 (503): Service Unavailable')).toBe(true);
    // 本地取消不是抖动:重发没有意义。
    expect(looksLikeUpstreamJitter('已取消')).toBe(false);
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

describe('识别「渠道上游没有可用凭据」', () => {
  // 实测 agy(gcli.ggchan.dev)号池空掉时的原始回执:429 + 这条 body。
  const AGY = '副 API 请求失败 (429): {"error":{"message":"no valid AGY credential available","type":"access_terminated","param":null,"code":"agy_credential_missing"}}';

  it('agy 号池空掉的真实回执要认出来', () => {
    expect(looksLikeCredentialFailure(AGY)).toBe(true);
    expect(looksLikeCredentialFailure('no valid AGY credential available')).toBe(true);
    expect(looksLikeCredentialFailure('access_terminated')).toBe(true);
    // 清单接口在号池空掉时只回这一条假模型。
    expect(looksLikeCredentialFailure('{"id":"当前无可用模型","object":"model"}')).toBe(true);
    expect(looksLikeCredentialFailure('insufficient_quota')).toBe(true);
  });

  it('凭据失效不能算抖动、也不能算超时:重发一百次还是同一句', () => {
    // 这是本轮最贵的那个 bug:429 本来落在抖动判据里,于是插件把「号池空」当限流
    // 原样重发,白耗 5 次重试(每次约 30 秒),用户看到「卡很久然后全失败」。
    expect(looksLikeUpstreamJitter(AGY)).toBe(false);
    expect(looksLikeTimeout(AGY)).toBe(false);
    // 限流本身仍然该算抖动(同一级重发确实可能过)。
    expect(looksLikeUpstreamJitter('副 API 请求失败 (429): Too Many Requests')).toBe(true);
  });

  it('普通失败不算凭据失效', () => {
    expect(looksLikeCredentialFailure('副 API 请求失败 (502): Bad Gateway')).toBe(false);
    expect(looksLikeCredentialFailure('副 API 请求超时(>300秒)')).toBe(false);
    expect(looksLikeCredentialFailure('被渠道内容过滤拦下(finish_reason=content_filter)')).toBe(false);
    expect(looksLikeCredentialFailure('已取消')).toBe(false);
    expect(looksLikeCredentialFailure('')).toBe(false);
  });
});
