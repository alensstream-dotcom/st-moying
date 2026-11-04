import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JAILBREAK_TIER,
  JAILBREAK_TIERS,
  getJailbreakTier,
  normalizeJailbreakTier,
  resolveJailbreakText,
} from '@/autoTag/jailbreak';

describe('破限挡位', () => {
  it('五个档位都在,默认档是 strong 而不是最狠那档', () => {
    expect(JAILBREAK_TIERS.map(t => t.id)).toEqual(['off', 'light', 'standard', 'strong', 'max']);
    expect(DEFAULT_JAILBREAK_TIER).toBe('strong');
  });

  it('认不出的档位 id 落回默认档', () => {
    expect(normalizeJailbreakTier('custom')).toBe('off');
    expect(normalizeJailbreakTier(undefined)).toBe(DEFAULT_JAILBREAK_TIER);
    expect(normalizeJailbreakTier('胡说')).toBe(DEFAULT_JAILBREAK_TIER);
  });

  it('越严的档位文本越长,且都要求输出 JSON', () => {
    const sizes = JAILBREAK_TIERS.map(t => t.text.length);
    // off 是空串,单调性只从 light 起算
    expect(sizes[1]).toBeGreaterThan(0);
    expect(sizes[4]).toBeGreaterThan(sizes[1]);
    for (const tier of JAILBREAK_TIERS.filter(t => t.text)) {
      expect(tier.text).toContain('JSON');
    }
  });
});

describe('自定义附加词叠加', () => {
  const custom = '我的渠道经验:必须写全解剖术语。';

  it('档位文本在前,附加词包进 operator_addendum 在后', () => {
    const out = resolveJailbreakText({ jailbreak: custom }, 'strong');
    expect(out.startsWith(getJailbreakTier('strong').text.trim())).toBe(true);
    expect(out).toContain('<operator_addendum>');
    expect(out.endsWith('</operator_addendum>')).toBe(true);
    expect(out.indexOf(custom)).toBeGreaterThan(out.indexOf('<operator_addendum>'));
  });

  it('off 档只发附加词(有自己的破限词时的正确用法)', () => {
    expect(resolveJailbreakText({ jailbreak: custom }, 'off')).toBe(custom);
  });

  it('没有附加词就只发档位文本', () => {
    expect(resolveJailbreakText(undefined, 'max')).toBe(getJailbreakTier('max').text.trim());
    expect(resolveJailbreakText({ jailbreak: '   ' }, 'max')).toBe(
      getJailbreakTier('max').text.trim(),
    );
  });

  it('两样都没有时返回空串,调用方不占消息位', () => {
    expect(resolveJailbreakText(undefined, 'off')).toBe('');
    expect(resolveJailbreakText({}, 'off')).toBe('');
  });
});
