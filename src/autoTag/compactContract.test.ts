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

describe('紧缩契约与双通道设计一致（nl 必须由模型写）', () => {
  it.each(['nl', 'identities', 'outfitChanges', 'costumeContexts'])('输出结构里出现 %s', (key) => {
    expect(COMPACT_PLAN_CONTRACT).toContain(key);
    expect(COMPACT_PLAN_CONTRACT_LOOSE).toContain(key);
  });

  // 旧版紧缩契约写着「不要输出 nl、不要写任何自然语言句子」，与新设计的
  // 「tag 管可枚举项、nl 管不可枚举项」正面打架：同一份请求里两套契约互斥，
  // 模型只能二选一，实测表现为画面回到纯 tag 的模板照。
  it('不再禁止模型写 nl', () => {
    expect(COMPACT_PLAN_CONTRACT).not.toContain('不要输出 nl');
    expect(COMPACT_PLAN_CONTRACT).not.toContain('不要写任何自然语言句子');
    expect(COMPACT_PLAN_CONTRACT_LOOSE).not.toContain('不要输出 nl');
    expect(COMPACT_PLAN_CONTRACT_LOOSE).not.toContain('不要写任何自然语言句子');
  });

  it('两份契约都要求 nl 只写一句', () => {
    expect(COMPACT_PLAN_CONTRACT).toContain('一句英文自然语言');
    expect(COMPACT_PLAN_CONTRACT_LOOSE).toContain('一句英文自然语言');
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

  // 宽松版不摆「禁止写」清单（严格版那种清单本身就是上游的拦截素材），
  // 但它仍允许写「正文里确实发生的衣物状态」，只是把器官名与行为词交给 act 补齐。
  it('宽松版不设禁止写清单，但保留衣物状态口径', () => {
    expect(COMPACT_PLAN_CONTRACT_LOOSE).not.toContain('禁止写');
    expect(COMPACT_PLAN_CONTRACT_LOOSE).toContain('衣物状态');
  });
});
