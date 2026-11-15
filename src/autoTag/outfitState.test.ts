import { describe, expect, it } from 'vitest';
import type { STMessage } from '@/st/context';
import {
  BBI_OUTFIT_EXTRA_KEY,
  extractGarment,
  readOutfitState,
  readWear,
} from './outfitState';

function message(floor: number, state: unknown, swipeId = 0): STMessage {
  return { mes: '', swipe_id: swipeId, extra: { [BBI_OUTFIT_EXTRA_KEY]: state } } as unknown as STMessage;
}

describe('extractGarment', () => {
  it('只取衣着词,发色体型表情不混进来', () => {
    const garment = extractGarment('1girl, black hair, large breasts, smiling, white dress, red scarf');
    expect(garment).toContain('dress');
    expect(garment).toContain('scarf');
    expect(garment).not.toContain('hair');
    expect(garment).not.toContain('smiling');
  });

  it('整词边界:bra 不会被 bracelet 命中', () => {
    const garment = extractGarment('1girl, silver bracelet');
    expect(garment).toBe('silver bracelet');
    expect(garment.split(', ')).not.toContain('bra');
  });

  it('同一部件只记一次', () => {
    const garment = extractGarment('1girl, dress, white dress, dress');
    expect(garment.split(', ').filter(word => word === 'dress')).toHaveLength(1);
  });

  it('保留颜色与版型修饰词:white dress 不丢掉 white', () => {
    const garment = extractGarment('1girl, navy school blazer, white collared shirt, dark pleated skirt');
    expect(garment).toContain('navy school blazer');
    expect(garment).toContain('white collared shirt');
    expect(garment).toContain('dark pleated skirt');
  });

  it('没有衣着词时返回空串', () => {
    expect(extractGarment('1girl, black hair, blue eyes')).toBe('');
  });
});

describe('readWear', () => {
  it('普通衣着是 worn', () => {
    expect(readWear('1girl, white dress').wear).toBe('worn');
  });

  it('全裸是 off 并记下判据词', () => {
    const result = readWear('1girl, completely nude');
    expect(result.wear).toBe('off');
    expect(result.state).toContain('nude');
  });

  it('露肩这种移位算 partial', () => {
    const result = readWear('1girl, white dress, off shoulder');
    expect(result.wear).toBe('partial');
    expect(result.state).toContain('off shoulder');
  });

  it('衣服褪到腰上算 partial', () => {
    expect(readWear('1girl, dress around waist').wear).toBe('partial');
  });

  it('裸体但只穿内裤算 partial(不是全裸)', () => {
    expect(readWear('1girl, topless, panties').wear).toBe('partial');
  });

  it('移位词与脱落词同时出现时按移位算', () => {
    expect(readWear('1girl, nude, panties on the floor, unbuttoned shirt').wear).toBe('partial');
  });
});

describe('readOutfitState', () => {
  it('没有 extra 时返回 null', () => {
    expect(readOutfitState({ mes: '' } as STMessage)).toBeNull();
  });

  it('版本号不对时返回 null', () => {
    expect(readOutfitState(message(0, { v: 2, entries: [] }))).toBeNull();
  });

  it('丢掉没有名字的条目', () => {
    const state = readOutfitState(message(0, { v: 1, entries: [{ name: '' , wear: 'worn' }, { name: '林夏', wear: 'partial' }] }));
    expect(state?.entries).toHaveLength(1);
    expect(state?.entries[0].name).toBe('林夏');
  });

  it('未知的 wear 回落成 worn', () => {
    const state = readOutfitState(message(0, { v: 1, entries: [{ name: '林夏', wear: 'x' }] }));
    expect(state?.entries[0].wear).toBe('worn');
  });
});