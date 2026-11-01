import { describe, expect, it } from 'vitest';
import { CHAR_AGE_BANDS, charAgeBuild, normalizeCharAge } from '@/state/charTags';

describe('charTags 年龄段', () => {
  it('五档齐全且互不重复', () => {
    const tags = CHAR_AGE_BANDS.map(band => band.tag);
    expect(tags).toEqual(['child', 'teenager', 'young adult', 'mature female', 'old']);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('每一档都带骨架伴生词,光一个年龄词压不住画风', () => {
    for (const band of CHAR_AGE_BANDS) {
      expect(band.build.length).toBeGreaterThan(10);
      // 骨架词必须和年龄档同现,否则模型只拿到「teenager」又会画回成年脸。
      expect(band.build).toContain(band.tag);
    }
    // 成年档不许写成幼女骨架,幼女档不许写成丰腴。
    expect(charAgeBuild('mature female')).not.toContain('flat chest');
    expect(charAgeBuild('child')).toContain('flat chest');
    expect(charAgeBuild('')).toBe('');
  });

  it('中文身份词归一成规范英文档', () => {
    expect(normalizeCharAge('高中生')).toBe('teenager');
    expect(normalizeCharAge('刚毕业的大学生')).toBe('young adult');
    expect(normalizeCharAge('熟女')).toBe('mature female');
    expect(normalizeCharAge('小女孩')).toBe('child');
    expect(normalizeCharAge('老婆婆')).toBe('old');
  });

  it('已规范的词原样保留,不做二次改写', () => {
    expect(normalizeCharAge('mature female')).toBe('mature female');
    expect(normalizeCharAge('  young adult ')).toBe('young adult');
  });

  it('岁数跟在规范词后面保留,它比骨架词更能定住年龄', () => {
    expect(normalizeCharAge('大学生，22岁')).toBe('young adult, 22岁');
    expect(normalizeCharAge('teenager, 17 years old')).toBe('teenager, 17 years old');
  });

  it('认不出的写法清掉标点分隔符后原样留下,不硬塞一档', () => {
    expect(normalizeCharAge('中年 / 四十上下')).toBe('中年, 四十上下');
    expect(normalizeCharAge('')).toBe('');
  });
});
