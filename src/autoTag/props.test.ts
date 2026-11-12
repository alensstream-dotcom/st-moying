import { describe, expect, it } from 'vitest';
import { extractGarment } from '@/autoTag/outfitState';

describe('extractGarment: 道具不进服装账本', () => {
  it('刀架在脖子上不会被记成衣服', () => {
    expect(extractGarment('1girl, white blouse, pleated skirt, knife at neck')).toBe(
      'white blouse, pleated skirt',
    );
  });

  it('手铐、绳、托盘、杯子都不算', () => {
    expect(extractGarment('1girl, white shirt, handcuffs')).toBe('white shirt');
    expect(extractGarment('1girl, white shirt, rope')).toBe('white shirt');
    expect(extractGarment('1girl, maid dress, tray, teacup')).toBe('maid dress');
  });

  it('裸 collar 不进账本，但 sailor collar / collared shirt 照常是衣服', () => {
    expect(extractGarment('1girl, white shirt, black collar')).toBe('white shirt');
    expect(extractGarment('1girl, sailor collar, serafuku')).toBe('sailor collar, serafuku');
    expect(extractGarment('1girl, collared shirt, black skirt')).toBe('collared shirt, black skirt');
  });

  it('choker、项链、耳环这些真饰品仍然保留', () => {
    expect(extractGarment('1girl, black choker, red dress')).toBe('black choker, red dress');
    expect(extractGarment('1girl, silver necklace, white dress')).toBe('silver necklace, white dress');
  });
});
