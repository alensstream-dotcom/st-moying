import { describe, expect, it } from 'vitest';
import type { STMessage } from '@/st/context';
import {
  BBI_OUTFIT_EXTRA_KEY,
  buildOutfitStateBlock,
  buildOutfitStatePayload,
  diagnoseGarment,
  diagnoseOutfit,
  extractGarment,
  latestOutfitStates,
  nextOutfitState,
  outfitRetryNote,
  readOutfitState,
  readWear,
  seedOutfitStates,
  type OutfitStateEntry,
} from './outfitState';

function message(floor: number, state: unknown, swipeId = 0): STMessage {
  return { mes: '', swipe_id: swipeId, extra: { [BBI_OUTFIT_EXTRA_KEY]: state } } as unknown as STMessage;
}

function entry(name: string, wear: OutfitStateEntry['wear'], garment = 'navy blazer', state = ''): OutfitStateEntry {
  return { name, wear, garment, state };
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
    expect(garment).not.toContain('bra');
  });

  it('同一部件只记一次', () => {
    const garment = extractGarment('1girl, dress, white dress, dress');
    expect(garment.split(', ').filter(word => word === 'dress')).toHaveLength(1);
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

describe('latestOutfitStates', () => {
  it('只读本楼之前的账本', () => {
    const chat = [message(0, { v: 1, entries: [entry('林夏', 'worn')] }), message(1, { v: 1, entries: [entry('苏晚', 'worn')] })];
    const merged = latestOutfitStates(chat, 1);
    expect([...merged.keys()]).toEqual(['林夏']);
  });

  it('后写的覆盖先写的', () => {
    const chat = [message(0, { v: 1, entries: [entry('林夏', 'worn')] }), message(1, { v: 1, entries: [entry('林夏', 'off', '')] })];
    expect(latestOutfitStates(chat, 2).get('林夏')?.wear).toBe('off');
  });

  it('后面楼层没提到的人保留旧状态(不会自动穿回去)', () => {
    const chat = [message(0, { v: 1, entries: [entry('林夏', 'partial')] }), message(1, { v: 1, entries: [entry('苏晚', 'worn')] })];
    expect(latestOutfitStates(chat, 2).get('林夏')?.wear).toBe('partial');
  });

  it('swipe 与当前页不符的账本跳过', () => {
    const chat = [message(0, { v: 1, entries: [entry('林夏', 'worn')] }, 1)];
    expect(latestOutfitStates(chat, 1).size).toBe(0);
  });

  it('楼层越界不报错', () => {
    expect(latestOutfitStates([], 99).size).toBe(0);
  });
});

describe('nextOutfitState', () => {
  it('画面里写了新衣着就覆盖', () => {
    const previous = new Map([['林夏', entry('林夏', 'worn', 'white dress')]]);
    const next = nextOutfitState(previous, [{ characters: [{ name: '林夏', tag: '1girl, red skirt' }] }]);
    expect(next.get('林夏')?.garment).toContain('skirt');
  });

  it('画面没写衣着且状态没变时沿用旧指纹', () => {
    const previous = new Map([['林夏', entry('林夏', 'worn', 'white dress')]]);
    const next = nextOutfitState(previous, [{ characters: [{ name: '林夏', tag: '1girl, looking at viewer' }] }]);
    expect(next.get('林夏')?.garment).toBe('white dress');
  });

  it('半脱会被记下来', () => {
    const next = nextOutfitState(new Map(), [{ characters: [{ name: '林夏', tag: '1girl, dress pulled aside' }] }]);
    expect(next.get('林夏')?.wear).toBe('partial');
  });

  it('单串后端没有角色块时,按名字认出在场的人', () => {
    const previous = new Map([['林夏', entry('林夏', 'worn', 'white dress')]]);
    const next = nextOutfitState(previous, [{ tag: '1girl, 林夏, black hair, white dress, pulled aside' }]);
    expect(next.get('林夏')?.wear).toBe('partial');
  });

  it('单串里没出现的角色保持原样', () => {
    const previous = new Map([['林夏', entry('林夏', 'worn', 'white dress')]]);
    const next = nextOutfitState(previous, [{ tag: '1girl, 苏晚, nude' }]);
    expect(next.get('林夏')?.wear).toBe('worn');
  });
});

describe('buildOutfitStatePayload / buildOutfitStateBlock', () => {
  it('全员只是穿着又没有衣着时不落账本', () => {
    expect(buildOutfitStatePayload(new Map([['林夏', entry('林夏', 'worn', '')]]), 0)).toBeUndefined();
  });

  it('有衣着就落账本', () => {
    const payload = buildOutfitStatePayload(new Map([['林夏', entry('林夏', 'worn', 'white dress')]]), 2);
    expect(payload?.entries).toHaveLength(1);
    expect(payload?.swipe).toBe(2);
  });

  it('区块措辞说明这是事实不是候选', () => {
    const block = buildOutfitStateBlock(new Map([['林夏', entry('林夏', 'worn', 'white dress')]]));
    expect(block).toContain('【服装现状】');
    expect(block).toContain('不是候选');
    expect(block).toContain('穿着');
    expect(block).toContain('white dress');
  });

  it('半脱条目带状态词', () => {
    const block = buildOutfitStateBlock(new Map([['林夏', entry('林夏', 'partial', 'dress', 'off shoulder')]]));
    expect(block).toContain('半脱');
    expect(block).toContain('off shoulder');
  });

  it('空账本返回空串', () => {
    expect(buildOutfitStateBlock(new Map())).toBe('');
  });
});

describe('diagnoseOutfit', () => {
  it('账本半脱、画面全裸时报警', () => {
    const gaps = diagnoseOutfit(
      { characters: [{ name: '林夏', tag: '1girl, nude' }] },
      new Map([['林夏', entry('林夏', 'partial', 'dress', 'off shoulder')]]),
    );
    expect(gaps[0]?.kind).toBe('half-to-nude');
  });

  it('半脱但还留着内衣时不算全裸', () => {
    const gaps = diagnoseOutfit(
      { characters: [{ name: '林夏', tag: '1girl, topless, panties' }] },
      new Map([['林夏', entry('林夏', 'partial', 'dress')]]),
    );
    expect(gaps).toEqual([]);
  });

  it('账本已脱、画面又写回整套衣着时报警', () => {
    const gaps = diagnoseOutfit(
      { characters: [{ name: '林夏', tag: '1girl, white dress' }] },
      new Map([['林夏', entry('林夏', 'off', '')]]),
    );
    expect(gaps[0]?.kind).toBe('undressed-again');
  });

  it('已脱但画面写 nude 时不报警', () => {
    const gaps = diagnoseOutfit(
      { characters: [{ name: '林夏', tag: '1girl, nude' }] },
      new Map([['林夏', entry('林夏', 'off', '')]]),
    );
    expect(gaps).toEqual([]);
  });

  it('账本里没有的人不判', () => {
    expect(diagnoseOutfit({ characters: [{ name: '苏晚', tag: '1girl, nude' }] }, new Map())).toEqual([]);
  });

  it('穿着状态不干预(挑哪套是别处的规则)', () => {
    const gaps = diagnoseOutfit(
      { characters: [{ name: '林夏', tag: '1girl, red skirt' }] },
      new Map([['林夏', entry('林夏', 'worn', 'white dress')]]),
    );
    expect(gaps).toEqual([]);
  });
});

describe('seedOutfitStates', () => {
  it('账本为空时用角色档案的固定着装垫底', () => {
    const seeded = seedOutfitStates(new Map(), [
      { name: '林夏', fields: { outfit: 'white dress, thighhighs' } },
      { name: '苏晚', fields: { outfit: '' } },
    ]);
    expect(seeded.get('林夏')).toEqual({
      name: '林夏',
      garment: 'white dress, thighhighs',
      wear: 'worn',
      state: '',
    });
    expect(seeded.has('苏晚')).toBe(false);
  });

  it('已被账本记过的角色不被固定着装覆盖', () => {
    const prior = new Map([['林夏', entry('林夏', 'partial', 'black shirt', 'off shoulder')]]);
    const seeded = seedOutfitStates(prior, [
      { name: '林夏', fields: { outfit: 'white dress' } },
    ]);
    expect(seeded.get('林夏')?.garment).toBe('black shirt');
    expect(seeded.get('林夏')?.wear).toBe('partial');
  });
});

describe('diagnoseGarment', () => {
  it('正文没有换装动词、衣着完全不重合时报告 garment-drift', () => {
    const gaps = diagnoseGarment(
      { characters: [{ name: '林夏', tag: '1girl, bikini, swimsuit' }] },
      new Map([['林夏', entry('林夏', 'worn', 'white dress, thighhighs')]]),
      '她走到窗边看向外面',
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      name: '林夏',
      kind: 'garment-drift',
      expected: 'white dress, thighhighs',
    });
  });

  it('有一件衣服重合时算同一套(如加了围裙或外套)', () => {
    const gaps = diagnoseGarment(
      { characters: [{ name: '林夏', tag: '1girl, white dress, apron' }] },
      new Map([['林夏', entry('林夏', 'worn', 'white dress, thighhighs')]]),
      '她端着盘子走出来',
    );
    expect(gaps).toEqual([]);
  });

  it('正文明确写了换装动词时不判漂移', () => {
    const gaps = diagnoseGarment(
      { characters: [{ name: '林夏', tag: '1girl, bikini' }] },
      new Map([['林夏', entry('林夏', 'worn', 'white dress')]]),
      '林夏换上了泳装走出更衣室',
    );
    expect(gaps).toEqual([]);
  });

  it('账本为半脱或已脱时交给 diagnoseOutfit,这里不重复判', () => {
    const gaps = diagnoseGarment(
      { characters: [{ name: '林夏', tag: '1girl, bikini' }] },
      new Map([['林夏', entry('林夏', 'partial', 'white dress', 'off shoulder')]]),
      '她站在原地',
    );
    expect(gaps).toEqual([]);
  });
});

describe('outfitRetryNote', () => {
  it('半脱与已脱给不同改法', () => {
    const note = outfitRetryNote([
      { name: '林夏', kind: 'half-to-nude', expected: '半脱', actual: '全裸' },
      { name: '苏晚', kind: 'undressed-again', expected: '已脱', actual: '又穿回' },
    ]);
    expect(note).toContain('不能直接 nude');
    expect(note).toContain('别再穿回去');
  });

  it('garment-drift 提示写回账本那一套衣服', () => {
    const note = outfitRetryNote([
      { name: '林夏', kind: 'garment-drift', expected: 'white dress', actual: 'bikini' },
    ]);
    expect(note).toContain('正文这一格没有写换衣服');
    expect(note).toContain('把衣着写回账本那一套');
  });
});
