import { describe, expect, it } from 'vitest';
import { classifyFailure } from '@/autoTag/outcome';

describe('结局分类', () => {
  it('超时归为失败并提示换变体', () => {
    const v = classifyFailure('副 API 请求超时(>300秒)');
    expect(v.status).toBe('failed');
    expect(v.reason).toContain('超时');
  });
  it('空计划归为“没画面”而不是失败', () => {
    const v = classifyFailure('返回了空 images');
    expect(v.status).toBe('no_frame');
  });
  it('内容拦截提示换渠道', () => {
    const v = classifyFailure('被渠道内容过滤拦下(mouth)');
    expect(v.status).toBe('failed');
    expect(v.reason).toContain('拦截');
  });
  it('凭据失效提示补号', () => {
    expect(classifyFailure('agy_credential_missing').reason).toContain('凭据');
  });
  it('截断与其它错误分开', () => {
    expect(classifyFailure('输出被截断(no closing brace)').reason).toContain('截断');
    expect(classifyFailure('随便什么错').status).toBe('failed');
  });
});
