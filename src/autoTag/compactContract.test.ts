import { describe, expect, it } from 'vitest';

import {
  COMPACT_PLAN_CONTRACT,
  COMPACT_PLAN_CONTRACT_LOOSE,
  bansExplicitWords,
  compactContractFor,
  useCompactContract,
} from '@/autoTag/compactContract';

describe('紧缩契约只在 gemini 档启用', () => {
  it.each(['off', 'light', 'standard', 'strong', 'max', undefined])('%s 档不启用', (tier) => {
    expect(useCompactContract(tier)).toBe(false);
  });

  it('gemini 档启用', () => {
    expect(useCompactContract('gemini')).toBe(true);
    // 三个 Gemini 档都必须走紧缩契约:漏一个,用户切到新档就会被当成普通档
    // 用「一条 user 塞满正文」的布局发出去,于是「切了档还是被拦」。
    expect(useCompactContract('gemini-strict')).toBe(true);
    expect(useCompactContract('gemini-loose')).toBe(true);
  });
});

describe('紧缩契约砍掉的字段与保留的结构', () => {
  it.each(['nl', 'identities', 'outfitChanges', 'costumeContexts'])('禁止输出 %s', (key) => {
    expect(COMPACT_PLAN_CONTRACT).toContain(key);
  });

  it('明确写出「不要输出」', () => {
    expect(COMPACT_PLAN_CONTRACT).toContain('不要输出');
  });
});

describe('紧缩契约保留 characters 挂载点', () => {
  // characters 是 enforceAppearance / enforceClothing 的挂载点。砍掉它，
  // 同楼多图会各画各的脸（用户报过的「同一楼同一女主形象会变」）。
  it('输出结构里保留 characters', () => {
    expect(COMPACT_PLAN_CONTRACT).toContain('"characters"');
    expect(COMPACT_PLAN_CONTRACT).toContain('档案里的规范名');
  });
});

describe('3.x 严格版禁解剖词', () => {
  it('严格版含「禁止写」段落', () => {
    expect(COMPACT_PLAN_CONTRACT).toContain('禁止写');
  });

  it.each(['breasts', 'nipples', 'pussy', 'penis'])('严格版把 %s 列进禁止清单', (banned) => {
    const lines = COMPACT_PLAN_CONTRACT.split('\n').filter((line) => line.includes(banned));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.includes('禁止写'))).toBe(true);
  });
});

describe('白名单给出景别与机位可选项', () => {
  it.each(['upper body', 'cowboy shot', 'from front', 'from above'])('包含 %s', (word) => {
    expect(COMPACT_PLAN_CONTRACT).toContain(word);
  });
});

describe('按模型拆档（3.x 严 / 4 系松）', () => {
  it('3.8-flash 走严格版', () => {
    expect(bansExplicitWords('gemini', 'agy-gemini-3.8-flash-high')).toBe(true);
    expect(compactContractFor('gemini', 'agy-gemini-3.8-flash-high')).toBe(COMPACT_PLAN_CONTRACT);
  });

  it('4-argon / 4-hydrogen 走宽松版', () => {
    expect(bansExplicitWords('gemini', '抗截断-agy-gemini-4-argon-high')).toBe(false);
    expect(compactContractFor('gemini', '抗截断-agy-gemini-4-argon-high')).toBe(COMPACT_PLAN_CONTRACT_LOOSE);
    expect(compactContractFor('gemini', '抗截断-pg-gemini-4-hydrogen')).toBe(COMPACT_PLAN_CONTRACT_LOOSE);
  });

  it('包装前缀不影响判档', () => {
    expect(bansExplicitWords('gemini', '假流式-抗截断-agy-gemini-3.8-flash')).toBe(true);
    expect(bansExplicitWords('gemini', '假流式-抗截断-agy-gemini-4-argon')).toBe(false);
  });

  it('模型名缺失时按严格版（宁保守不砍图）', () => {
    expect(bansExplicitWords('gemini', undefined)).toBe(true);
    expect(compactContractFor('gemini', undefined)).toBe(COMPACT_PLAN_CONTRACT);
  });

  it('非 gemini 档一律不锁解剖词', () => {
    expect(bansExplicitWords('strong', 'agy-gemini-3.8-flash')).toBe(false);
    expect(bansExplicitWords('max', 'agy-gemini-4-argon')).toBe(false);
  });

  // 用户之所以会去手选,往往正是因为自动判断猜错了 —— 比如自建站的模型名里没有
  // \`gemini-4\`,但上游其实是 4 系。这时手选的档必须压过模型名猜测。
  it('手选严格/宽松优先于模型名猜测', () => {
    // 名字看着像 3.x,但用户手选了宽松 → 按宽松走
    expect(compactContractFor('gemini-loose', 'agy-gemini-3.8-flash-high')).toBe(COMPACT_PLAN_CONTRACT_LOOSE);
    expect(bansExplicitWords('gemini-loose', 'agy-gemini-3.8-flash-high')).toBe(false);
    // 名字看着像 4 系,但用户手选了严格 → 按严格走
    expect(compactContractFor('gemini-strict', 'agy-gemini-4-argon-high')).toBe(COMPACT_PLAN_CONTRACT);
    expect(bansExplicitWords('gemini-strict', 'agy-gemini-4-argon-high')).toBe(true);
    // 自动档仍按模型名猜
    expect(compactContractFor('gemini', 'agy-gemini-4-argon-high')).toBe(COMPACT_PLAN_CONTRACT_LOOSE);
  });

  it('新渠道模型名不含 gemini-4 时,手选宽松才是正解', () => {
    // 实测:gemini-4-hydrogen-high-原生1M支持工具 是 4 系,但自动判断会当 3.x 压成严格版,
    // 于是画面被压成 SFW。手选宽松即可。
    expect(bansExplicitWords('gemini', 'gemini-4-hydrogen-high-原生1M支持工具')).toBe(false);
    expect(bansExplicitWords('gemini', 'gemini-4-hydrogen-原生1M防外审注入不支持工具')).toBe(false);
  });

  it('宽松版允许写身体状态词（否则 NSFW 剧情会被压成 SFW 图）', () => {
    expect(COMPACT_PLAN_CONTRACT_LOOSE).toContain('nude');
    expect(COMPACT_PLAN_CONTRACT_LOOSE).toContain('breasts out');
    expect(COMPACT_PLAN_CONTRACT_LOOSE).not.toContain('禁止写');
  });
});
