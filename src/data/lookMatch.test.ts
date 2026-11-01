import { describe, expect, it } from 'vitest';
import {
  LOOK_PIN_MIN_DIMENSIONS,
  compareLook,
  isLookPin,
  lookTextOf,
  mergeLook,
  scanLook,
} from '@/data/lookMatch';
import type { FandomPreset } from '@/data/loreTypes';

const preset = (over: Partial<FandomPreset> = {}): FandomPreset => ({
  id: 'fx-test',
  name: '测试骨相',
  franchise: 'Test',
  tags: '0.6::test girl::, white hair, long hair, purple eyes, elf',
  aliases: ['测试'],
  nsfw: 0,
  hair: 'white hair, long hair',
  eyes: 'purple eyes',
  ...over,
});

describe('外形相似度', () => {
  it('按维度抽词,同一概念的中英说法归到同一个值', () => {
    const chinese = scanLook('银白长发、紫瞳、尖耳精灵');
    const english = scanLook('white hair, long hair, purple eyes, elf');
    // 「银白」归 white、「紫瞳」归 purple、「尖耳/精灵」归 elf,两边必须抽成同一个值集合。
    expect(chinese.get('hairColor')).toEqual(new Set(['white']));
    expect(english.get('hairColor')).toEqual(new Set(['white']));
    expect(chinese.get('eyeColor')).toEqual(new Set(['purple']));
    expect(chinese.get('race')).toEqual(new Set(['elf']));
  });

  it('多维重合判「就是这个人」,并在三维处设阈值', () => {
    const match = compareLook(scanLook('银白长发紫瞳的精灵'), scanLook(lookTextOf(preset())));
    expect(match.matched).toBeGreaterThanOrEqual(LOOK_PIN_MIN_DIMENSIONS);
    expect(match.conflicts).toEqual([]);
    expect(match.ratio).toBe(1);
    expect(isLookPin(match)).toBe(true);
  });

  it('只对上两维不算认出来,免得把不相干的脸硬塞进来', () => {
    const match = compareLook(scanLook('白发紫瞳'), scanLook('white hair, purple eyes'));
    expect(match.matched).toBe(2);
    expect(isLookPin(match)).toBe(false);
  });

  it('同维度撞到不同值算冲突,冲突后直接不认', () => {
    // 白毛紫瞳 vs 白毛金瞳:瞳色不同就是另一张脸。
    const match = compareLook(scanLook('银白长发紫瞳精灵'), scanLook('white hair, long hair, gold eyes, elf'));
    expect(match.conflicts).toContain('eyeColor');
    expect(match.ratio).toBe(0);
    expect(isLookPin(match)).toBe(false);
  });

  it('发色撞了也算冲突,哪怕其它维度全对上', () => {
    const match = compareLook(scanLook('黑长短发蓝瞳'), scanLook('white hair, long hair, blue eyes'));
    expect(match.conflicts).toContain('hairColor');
    expect(isLookPin(match)).toBe(false);
  });

  it('mergeLook 把多段描写的维度并成一份', () => {
    const merged = mergeLook(scanLook('白色长发'), scanLook('紫瞳精灵'));
    expect(merged.get('hairColor')).toEqual(new Set(['white']));
    expect(merged.get('eyeColor')).toEqual(new Set(['purple']));
    expect(merged.get('race')).toEqual(new Set(['elf']));
  });

  it('空文本抽不出维度,也不与任何东西成冲突', () => {
    expect(scanLook('').size).toBe(0);
    const match = compareLook(scanLook(''), scanLook(lookTextOf(preset())));
    expect(match.matched).toBe(0);
    expect(isLookPin(match)).toBe(false);
  });

  it('条目侧只取 hair/eyes/tags,不把 note 里的中文备注算进相似度', () => {
    const text = lookTextOf(preset({ note: '金瞳碧眼的完全不同的角色' }));
    expect(scanLook(text).get('eyeColor')).toEqual(new Set(['purple']));
  });
});
