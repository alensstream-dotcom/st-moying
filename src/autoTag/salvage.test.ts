import { describe, expect, it } from 'vitest';
import { salvageJsonObject } from '@/autoTag/salvage';

/** 断在写第三张图的中途:前两张完整。 */
const HALF_WRITTEN = `{"images":[
{"position":"P1","tag":"1girl, solo, smile","size":"portrait"},
{"position":"P2","tag":"1girl, sitting, window","size":"landscape"},
{"position":"P3","tag":"1girl, brush on pu`;

describe('半截 JSON 抢救', () => {
  it('救回断点之前的完整图片,补上收尾括号', () => {
    const out = salvageJsonObject(HALF_WRITTEN);
    expect(out).not.toBeNull();
    const plan = JSON.parse(out!);
    expect(plan.images).toHaveLength(2);
    expect(plan.images[1].position).toBe('P2');
  });

  it('救回来的结果必须是能 JSON.parse 的完整对象', () => {
    const out = salvageJsonObject(HALF_WRITTEN)!;
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out.endsWith('}')).toBe(true);
  });

  it('断在字符串中间也认:把半截字符串整条丢掉', () => {
    const out = salvageJsonObject('{"images":[{"position":"P1","tag":"ok","size":"portrait"},{"position":"P2","tag":"半截');
    expect(JSON.parse(out!).images).toHaveLength(1);
  });

  it('括号错位时以前面可信的部分为准', () => {
    const out = salvageJsonObject('{"images":[{"position":"P1","tag":"a","size":"portrait"}],"changes":[{"name":"x"');
    expect(JSON.parse(out!).images).toHaveLength(1);
  });

  // 截在第一张中间、一条完整的都没有:补尾巴能保住这一张(position 与 tag 都写完了),
  // 比整份丢掉重试好——重试再被切就一张图都没有。
  it('一张完整都没有时补尾巴救回那半张', () => {
    const out = salvageJsonObject('{"images":[{"position":"P1","tag":"半截');
    expect(JSON.parse(out!).images).toHaveLength(1);
    expect(JSON.parse(out!).images[0].tag).toBe('半截');
  });

  it('连 position 都没有时救不出,交给重试', () => {
    expect(salvageJsonObject('{"images":[]')).toBeNull();
    expect(salvageJsonObject('{"images":[{"positi')).toBeNull();
    expect(salvageJsonObject('')).toBeNull();
  });

  it('没有 JSON 起点时返回 null', () => {
    expect(salvageJsonObject('<thinking>想想</thinking>')).toBeNull();
  });

  it('字符串里的括号不参与配平', () => {
    const raw = '{"images":[{"position":"P1","tag":"a { b [ c","size":"portrait"},{"position":"P2","tag":"x';
    const plan = JSON.parse(salvageJsonObject(raw)!);
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0].tag).toBe('a { b [ c');
  });
});
