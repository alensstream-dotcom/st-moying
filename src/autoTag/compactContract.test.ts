import { describe, expect, it } from 'vitest';

import { COMPACT_PLAN_CONTRACT, useCompactContract } from '@/autoTag/compactContract';

describe('gemini 档的紧缩契约', () => {
  it('只在 gemini 档启用', () => {
    expect(useCompactContract('gemini')).toBe(true);
    expect(useCompactContract('strong')).toBe(false);
    expect(useCompactContract('max')).toBe(false);
    expect(useCompactContract('off')).toBe(false);
    expect(useCompactContract(undefined)).toBe(false);
  });

  it('明确禁止模型写 nl/identities/outfitChanges/costumeContexts', () => {
    for (const key of ['nl', 'identities', 'outfitChanges', 'costumeContexts']) {
      expect(COMPACT_PLAN_CONTRACT).toContain(key);
    }
    expect(COMPACT_PLAN_CONTRACT).toContain('不要输出');
  });

  it('保留 characters —— 外貌与服装锁定都挂在它上面', () => {
    expect(COMPACT_PLAN_CONTRACT).toContain('"characters"');
    expect(COMPACT_PLAN_CONTRACT).toContain('档案里的规范名');
  });

  it('白名单里不含身体部位名、衣物状态与行为词', () => {
    expect(COMPACT_PLAN_CONTRACT).toContain('禁止写');
    for (const banned of ['breasts', 'pussy', 'lifted', 'slipped']) {
      // 这些词只应出现在「禁止写」那一行
      const lines = COMPACT_PLAN_CONTRACT.split('\n').filter((line) => line.includes(banned));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('禁止');
    }
  });

  it('给出景别与机位的可选项,否则出图会缺构图项', () => {
    expect(COMPACT_PLAN_CONTRACT).toContain('upper body');
    expect(COMPACT_PLAN_CONTRACT).toContain('cowboy shot');
    expect(COMPACT_PLAN_CONTRACT).toContain('from front');
    expect(COMPACT_PLAN_CONTRACT).toContain('from above');
  });
});
