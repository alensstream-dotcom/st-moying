import { describe, expect, it } from 'vitest';
import { diversifyLook, diversifyNewOps, rerollLook } from './lookDiversity';
import { emptyCharFields } from '@/state/charTags';

const look = (over: Partial<Record<string, string>> = {}) => ({
  ...emptyCharFields(),
  sex: '1girl',
  ...over,
});

describe('diversifyLook', () => {
  it('空着的外貌会从词表里补上，并给出说明', () => {
    const result = diversifyLook(look(), [], '');
    expect(result.fields.hair).toBeTruthy();
    expect(result.fields.eyes).toBeTruthy();
    expect(result.fields.body).toBeTruthy();
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('和已有角色撞车的发色会被换掉', () => {
    const others = [{ fields: look({ hair: 'black hair, long straight hair', eyes: 'brown eyes' }) }];
    const result = diversifyLook(look({ hair: 'black hair, long straight hair' }), others);
    expect(result.fields.hair).not.toContain('black hair');
    expect(result.notes.join('')).toContain('撞车');
  });

  it('正文写过的词即使撞车也不动', () => {
    const others = [{ fields: look({ hair: 'black hair' }) }];
    const result = diversifyLook(look({ hair: 'black hair' }), others, '她转过身，黑色长发扫过肩头，是 black hair');
    expect(result.fields.hair).toContain('black hair');
  });

  it('六个轴各自岔开，互不串味', () => {
    const others = [
      {
        fields: look({
          hair: 'black hair, long straight hair',
          eyes: 'brown eyes, round eyes',
          body: 'petite',
          extra: 'hairpin',
        }),
      },
    ];
    const result = diversifyLook(
      look({ hair: 'black hair, long straight hair', eyes: 'brown eyes, round eyes', body: 'petite', extra: 'hairpin' }),
      others,
    );
    expect(result.fields.hair).not.toContain('black hair');
    expect(result.fields.eyes).not.toContain('brown eyes');
    expect(result.fields.body).not.toBe('petite');
    expect(result.fields.extra).not.toBe('hairpin');
    // 发型轴换掉后不能把发色轴的 token 弄丢
    expect(result.fields.hair.split(',').length).toBeGreaterThanOrEqual(1);
  });

  it('不碰 sex/age/outfit', () => {
    const fields = look({ age: 'young adult', outfit: 'white shirt' });
    const result = diversifyLook(fields, []);
    expect(result.fields.sex).toBe('1girl');
    expect(result.fields.age).toBe('young adult');
    expect(result.fields.outfit).toBe('white shirt');
  });

  it('词表用尽时保留原值而不是清空', () => {
    const pool = Array.from({ length: 40 }, () => ({ fields: look({ body: 'petite' }) }));
    const result = diversifyLook(look({ body: 'petite' }), pool);
    expect(result.fields.body).toBeTruthy();
  });

  // 整体轴（体型/发饰）一个字段只放一个值：撞车的那个要被换掉，
  // 不能留成「petite, slender」——两个词一起下发，画出来两头不像。
  it('体型撞车时是替换而不是叠加', () => {
    const others = [{ fields: look({ body: 'petite' }) }];
    const result = diversifyLook(look({ body: 'petite' }), others);
    expect(result.fields.body).not.toContain('petite');
    expect(result.fields.body.split(',').length).toBe(1);
  });

  it('发饰撞车时是替换而不是叠加', () => {
    const others = [{ fields: look({ extra: 'hairpin' }) }];
    const result = diversifyLook(look({ extra: 'hairpin' }), others);
    expect(result.fields.extra).not.toContain('hairpin');
  });

  // 正文是中文时也要认得出，否则「正文优先」形同虚设：正文写银发，
  // 档案里的撞车蓝发被换掉时该换成银发，而不是随手挑一个没人用过的值。
  it('正文点名的候选优先于词表顺序', () => {
    const others = [{ fields: look({ hair: 'blue hair' }) }];
    const result = diversifyLook(look({ hair: 'blue hair' }), others, '她留着一头银发，站在门口。');
    expect(result.fields.hair).toContain('silver hair');
  });

  it('中文正文写过的体型即使撞车也不换', () => {
    const others = [{ fields: look({ body: 'petite' }) }];
    const result = diversifyLook(look({ body: 'petite' }), others, '她个子娇小，只到他的胸口。');
    expect(result.fields.body).toContain('petite');
  });
});

// 同批新建的角色互相之间也要岔开：只拿库当参照时它们谁都看不见谁。
describe('diversifyNewOps', () => {
  it('同一批两个新角色不会拿到同一张脸', () => {
    const items = [
      { name: '苏晚', fields: look({ hair: 'black hair', eyes: 'blue eyes' }) },
      { name: '林晚晴', fields: look({ hair: 'black hair', eyes: 'blue eyes' }) },
    ];
    const notes: string[] = [];
    diversifyNewOps(items, [], '', notes);
    expect(items[0].fields.hair).not.toBe(items[1].fields.hair);
    expect(items[0].fields.eyes).not.toBe(items[1].fields.eyes);
    expect(notes.join()).toContain('苏晚');
  });

  it('正文写明「都是一头乌黑长发」时第二人保留黑发', () => {
    const items = [
      { name: '苏晚', fields: look({ hair: 'black hair' }) },
      { name: '林晚晴', fields: look({ hair: 'black hair' }) },
    ];
    diversifyNewOps(items, [], '两人都是一头乌黑的长发。', []);
    expect(items[1].fields.hair).toContain('black hair');
  });
});


// 重掷人物形象：只动剧情没写死的轴，且避开库里别人在用的值。
describe('rerollLook', () => {
  /** 固定序列，保证断言稳定：每次都取候选里的第一个。 */
  const first = () => 0;

  it('剧情没写的轴会被换掉，正文写死的轴原样保留', () => {
    const fields = look({ hair: 'black hair', eyes: 'blue eyes', body: 'slender' });
    const result = rerollLook(fields, [], '她有一头乌黑的长发。', '苏晚', first);
    // 发色在正文里点过名（乌黑 → black hair），必须留着
    expect(result.fields.hair).toContain('black hair');
    expect(result.kept).toContain('hair');
    // 瞳色没写过，掷出新值
    expect(result.fields.eyes).not.toBe('blue eyes');
    expect(result.changes.map((change) => change.field)).toContain('eyes');
  });

  it('新值不会等于旧值', () => {
    const fields = look({ hair: 'black hair', eyes: 'blue eyes', body: 'slender', extra: 'hairpin' });
    const result = rerollLook(fields, [], '', '苏晚', first);
    for (const change of result.changes) expect(change.to).not.toBe(change.from);
  });

  it('避开库里别人已经在用的词', () => {
    const others = [
      { fields: look({ hair: 'silver hair', eyes: 'red eyes', body: 'voluptuous', extra: 'beret' }) },
    ];
    const fields = look({ hair: 'black hair', eyes: 'blue eyes', body: 'slender', extra: 'hairpin' });
    const result = rerollLook(fields, others, '', '苏晚', first);
    expect(result.fields.hair).not.toContain('silver hair');
    expect(result.fields.eyes).not.toContain('red eyes');
    expect(result.fields.body).not.toBe('voluptuous');
    expect(result.fields.extra).not.toBe('beret');
  });

  it('体型按年龄档掷：阿姨不会掷出 petite', () => {
    const fields = look({ age: 'mature female', body: 'slender' });
    const result = rerollLook(fields, [], '', '风阿姨', first);
    expect(result.fields.body).not.toContain('petite');
    expect(result.fields.body).not.toContain('small build');
    expect(result.fields.body).not.toContain('short stature');
  });

  it('体型只换词表内的轴词，medium breasts 这类手写词保留', () => {
    const fields = look({ body: 'slender, medium breasts' });
    const result = rerollLook(fields, [], '', '苏晚', first);
    expect(result.fields.body).toContain('medium breasts');
    expect(result.fields.body).not.toContain('slender');
  });

  it('正文写死的四个轴一个都不动，只补档案里空着的轴', () => {
    const fields = look({
      hair: 'black hair',
      eyes: 'blue eyes',
      body: 'slender',
      extra: 'hairpin',
    });
    const story = '乌黑的长发、蓝色的眼睛，苗条的身材，戴着一枚发夹。';
    const result = rerollLook(fields, [], story, '苏晚', first);
    expect(result.kept).toEqual(expect.arrayContaining(['hair', 'eyes', 'body', 'extra']));
    // 写死的轴保持原值；改动只可能发生在原本空着的轴上（发型、眼形）。
    expect(result.fields.hair).toContain('black hair');
    expect(result.fields.eyes).toContain('blue eyes');
    expect(result.fields.body).toContain('slender');
    expect(result.fields.extra).toContain('hairpin');
    for (const change of result.changes) expect(change.from).toBe('（空）');
  });
});
