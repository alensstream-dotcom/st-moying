import { describe, expect, it } from 'vitest';
import { enforceShotCoverage, seeNeeds } from './shotCoverage';

describe('景别覆盖', () => {
  it('正文写了下半身，上半身特写要换成全身', () => {
    const needs = seeNeeds('她穿着黑色过膝袜和高跟鞋站在门口');
    expect(needs.lower).toBe(true);
    const out = enforceShotCoverage('1girl, doorway, upper body, from front', needs);
    expect(out.tag).toContain('full body');
    expect(out.tag).not.toContain('upper body');
  });

  it('正文只写表情，close-up 不动', () => {
    const needs = seeNeeds('她抬眼看他，嘴角微微上扬');
    const out = enforceShotCoverage('1girl, close-up, from side', needs);
    expect(out.tag).toBe('1girl, close-up, from side');
    expect(out.changed).toHaveLength(0);
  });

  it('写到手在做的事，脸特写要换成牛仔镜头', () => {
    const needs = seeNeeds('他的手按住她的腰');
    const out = enforceShotCoverage('1girl, close-up, dim lighting', needs);
    expect(out.tag).toContain('cowboy shot');
  });

  it('没有景别词就不动，不替模型发明构图', () => {
    const out = enforceShotCoverage('1girl, bedroom, soft lighting', seeNeeds('丝袜'));
    expect(out.tag).toBe('1girl, bedroom, soft lighting');
  });
});
