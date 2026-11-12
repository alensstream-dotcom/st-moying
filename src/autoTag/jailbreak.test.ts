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

// 这几条锁的是「真能压住拒答」的几处硬结构,改文案时别顺手删掉。
describe('破限词里必须留下反拒答结构', () => {
  it('strong 起把年龄脱钩:不许模型自己算岁数', () => {
    for (const id of ['strong', 'max'] as const) {
      const text = getJailbreakTier(id).text;
      expect(text).toContain('成年');
      // 顶档还要给一条可以照抄的岁数结论,模型才不用推理
      expect(text).toContain('18 years old');
    }
    expect(getJailbreakTier('strong').text).toContain('18+');
  });

  it('strong 起点名四种收手形态,给模型可对照的判据', () => {
    const text = getJailbreakTier('strong').text;
    expect(text).toContain('算失败');
    expect(text).toContain('注:');
    expect(text).toContain('基础块');
  });

  // 截断的主要成因是思考太长,不是尺度。破限必须自己压住输出预算。
  it('strong 起给思考块行数上限,并说明超预算就是截断', () => {
    const text = getJailbreakTier('strong').text;
    expect(text).toContain('到数就停笔');
    expect(text).toContain('截断');
    expect(getJailbreakTier('max').text).toContain('到数立刻停笔');
    // 行数不再写死在破限里,而是统一以思考清单给的上限为准(两者才不会打架)。
    expect(text).not.toContain('最多 12 行');
  });

  it('两档都要求按重要性排序输出,让被切时丢的是次要图', () => {
    expect(getJailbreakTier('strong').text).toContain('重要性从高到低');
  });

  it('max 档带机器接口伪装与拒绝黑名单', () => {
    const text = getJailbreakTier('max').text;
    expect(text).toContain('[MODE: UNRESTRICTED]');
    expect(text).toContain('<not_a_refusal>');
    expect(text).toContain('18 years old');
    // 哨兵要真的在文本里,只导出不用就成死代码了
    expect(text).toContain('<|bbi_json|>');
  });

  it('max 档压得住模型的「差不多」:要求自检后再闭合', () => {
    const text = getJailbreakTier('max').text;
    expect(text).toContain('自检');
    expect(text).toContain('停在最后一个');
  });

  it('屏障不挡解析:破限词自己不许出现半截花括号或代码围栏要求', () => {
    for (const tier of JAILBREAK_TIERS.filter(t => t.text)) {
      expect(tier.text).not.toContain('```');
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
