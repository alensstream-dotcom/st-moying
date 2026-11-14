import { describe, expect, it } from 'vitest';

import {
  acceptClothingChanges,
  adoptStoryClothing,
  clothingAt,
  clothingCaption,
  proseGarment,
  proseGarments,
  synthesiseSceneClothing,
} from '@/autoTag/outfitTimeline';
import type { ClothingState } from '@/autoTag/outfitTimeline';
import type { CharTagEntry } from '@/state/charTags';

function entry(name: string): CharTagEntry {
  return {
    name,
    fields: {
      fandom: '',
      sex: '1girl',
      age: '',
      hair: 'black hair',
      eyes: 'purple eyes',
      skin: '',
      body: '',
      extra: '',
      outfit: '',
    },
    raw: '',
    nl: '',
    source: 'ai',
    desc: '',
    history: [],
  } as unknown as CharTagEntry;
}

const entries = [entry('林晚晴'), entry('苏晚')];

function state(pairs: Record<string, string[]>): ClothingState {
  const map: ClothingState = new Map();
  for (const [name, designs] of Object.entries(pairs)) {
    map.set(name, {
      name,
      pieces: designs.map((design) => ({ id: design, design, state: { location: 'worn' } })),
    } as never);
  }
  return map;
}

const catchAll = (name: string): ClothingState => {
  const record = state({ [name]: [] }).get(name)!;
  record.pieces = [
    { id: 'shirt', design: 'white shirt', state: { location: 'worn' } },
    { id: 'skirt', design: 'long skirt', state: { location: 'worn' } },
    { id: 'bra', design: 'bra', state: { location: 'worn' } },
    { id: 'panties', design: 'panties', state: { location: 'worn' } },
  ] as never;
  const map: ClothingState = new Map();
  map.set(name, record);
  return map;
};

const BATH =
  '"我先去洗个澡。"林晚晴站起来，把杯子放在茶几上。她一边走一边解开衬衫的扣子，把衬衫从肩上褪下来搭在手臂上，然后拉开长裙侧面的拉链，让裙子顺着腿滑落到脚踝。她把衬衫和长裙一起放进洗衣篮，解开内衣的搭扣，让胸罩也落进篮子里，最后弯下腰，把内裤从腿上褪下来。浴室里很快响起水声。';

const BATH_ROOM = '林晚晴走进浴室，站在花洒下面，让热水从头顶淋下来。';

const NIGHT =
  '苏晚把吹风机放在床头柜上，没有退开，反而低下头，在林晚晴的侧脸上吻了一下。林晚晴偏过头，回吻她。两个人倒在床上，粉色的睡衣被推到胸口上方，睡裤连同内裤一起被褪到膝盖，然后被踢到床脚。';

const MORNING =
  '第二天早上，林晚晴先醒，她把被子往上拉了拉，盖住苏晚的肩膀，然后下床，走到衣柜前。她拉开抽屉，拿出一件干净的白色衬衫和一条黑色长裙，穿上内衣和内裤，把衬衫扣好，把长裙的拉链拉到顶。';

describe('服装连续性：洗澡场景', () => {
  it('「我先去洗个澡。」后面才出现人名时也能认出是谁在洗', () => {
    const out = synthesiseSceneClothing(BATH, entries, catchAll('林晚晴'));
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0].name).toBe('林晚晴');
    // 洗澡要按「脱下放进篮子」处理：全部离开身体且湿掉。
    const ids = out.changes[0].pieces.map((piece) => piece.id);
    expect(ids).toEqual(expect.arrayContaining(['shirt', 'skirt', 'bra', 'panties']));
    for (const piece of out.changes[0].pieces) {
      expect(piece.state.location).toBe('floor');
      expect(piece.state.wetness).toBe('wet');
    }
  });

  it('只写「走进浴室 / 花洒」而不写「洗澡」也算洗澡场景', () => {
    const out = synthesiseSceneClothing(BATH_ROOM, entries, catchAll('林晚晴'));
    expect(out.changes).toHaveLength(1);
    expect(out.notes.join()).toContain('洗澡');
  });
});

describe('服装连续性：脱衣动作兜底', () => {
  it('没有做爱/洗澡词、只写「睡衣被推到胸口上方、睡裤褪到膝盖」也要记', () => {
    const before = state({ 林晚晴: ['pink pajamas'] });
    const out = synthesiseSceneClothing(NIGHT, entries, before);
    const lq = out.changes.find((change) => change.name === '林晚晴');
    expect(lq, '林晚晴的睡衣必须被记成被移开').toBeTruthy();
    // 「被推到胸口上方」是位置移动，不是脱掉：不能渲染成 no pajamas。
    const piece = lq!.pieces[0];
    expect(piece.state.arrangement).toBeDefined();
    expect(piece.state.location ?? 'worn').toBe('worn');
  });

  it('「从头顶脱掉」记成真正脱下', () => {
    const before = state({ 苏晚: ['grey pajamas'] });
    const out = synthesiseSceneClothing('苏晚的睡裙也被从下往上掀起来，从头顶脱掉。', entries, before);
    const sw = out.changes.find((change) => change.name === '苏晚');
    expect(sw).toBeTruthy();
    expect(sw!.pieces[0].state.location).toBe('removed');
  });
});

describe('服装连续性：一句里多件衣物', () => {
  it('proseGarments 认出一句里的所有衣物，且不把睡裙拆成裙', () => {
    expect(proseGarments('拿出一件干净的白色衬衫和一条黑色长裙')).toEqual(['white shirt', 'black skirt']);
    expect(proseGarments('换上了浅灰色的睡裙')).toEqual(['grey pajamas']);
    expect(proseGarment('换上了浅灰色的睡裙')).toBe('grey pajamas');
  });

  it('隔夜换衣（拿出衬衫和长裙穿上）要整套重记并让睡衣退出账本', () => {
    const before = state({ 林晚晴: ['pink pajamas'], 苏晚: ['grey pajamas'] });
    const out = adoptStoryClothing(MORNING, entries, before);
    expect(out.changes).toHaveLength(1);
    const change = out.changes[0];
    expect(change.name).toBe('林晚晴');
    expect(change.operation).toBe('change');
    const designs = change.pieces.map((piece) => piece.design);
    expect(designs).toEqual(expect.arrayContaining(['white shirt', 'black skirt']));
    // 关键：穿衬衫时那件连体睡衣必须一起离开账本，否则渲染成叠穿。
    expect(designs).not.toContain('pink pajamas');
    const accepted = acceptClothingChanges(out.changes, MORNING, before, entries);
    expect(accepted.rejected).toEqual([]);
    expect(accepted.changes).toHaveLength(1);
    const after = clothingAt(before, accepted.changes, 'scope');
    const lq = after.get('林晚晴')!;
    const worn = lq.pieces.filter((piece) => (piece.state.location ?? 'worn') === 'worn').map((p) => p.design);
    expect(worn).toEqual(expect.arrayContaining(['white shirt', 'black skirt']));
    expect(worn.join()).not.toContain('pajamas');
    expect(clothingCaption(lq).tag).not.toContain('no shirt');
  });

  it('主语是「她」时不把换装记到被盖被子的另一个人头上', () => {
    const before = state({ 林晚晴: ['pink pajamas'], 苏晚: ['grey pajamas'] });
    const out = adoptStoryClothing(MORNING, entries, before);
    expect(out.changes.map((change) => change.name)).toEqual(['林晚晴']);
  });

  it('只写代词的换装句带上主语句原文，否则校验会判「缺少可定位的证据」', () => {
    const before = state({ 林晚晴: ['pink pajamas'], 苏晚: ['grey pajamas'] });
    const out = adoptStoryClothing(MORNING, entries, before);
    const accepted = acceptClothingChanges(out.changes, MORNING, before, entries);
    expect(accepted.changes).toHaveLength(1);
  });
});

describe('服装连续性：换装与脱衣互相不干扰', () => {
  it('亲吻与隔着衣服抚摸不动账本', () => {
    const before = catchAll('林晚晴');
    const out = synthesiseSceneClothing(
      '林晚晴低下头，在他唇上吻了一下。他隔着衣服揉着她的胸。',
      entries,
      before,
    );
    expect(out.changes.filter((change) => change.name === '林晚晴')).toEqual([]);
  });

  it('洗完澡换睡衣：先把旧的放桌上，再穿新的', () => {
    const before = catchAll('林晚晴');
    const text =
      '洗完澡，林晚晴用浴巾把自己裹起来。她从抽屉里拿出一套淡粉色的睡衣，先穿上睡裤，再套上睡衣的上衣。';
    const out = adoptStoryClothing(text, entries, before);
    const change = out.changes.find((item) => item.name === '林晚晴');
    expect(change, '换睡衣必须被采纳').toBeTruthy();
    expect(change!.pieces.map((piece) => piece.design).join()).toContain('pajamas');
  });
});

describe('服装连续性：事件落点必须落在证据句所在行', () => {
  // 正文里的旧 <bbi_image> tag 被剔除后会留下连续的十几个空行。
  // 旧版用 `index + evidence.length`（index 是命中的那几个字的位置，不是句首）估算落点，
  // 一旦跨过一段空行，事件就整段往后挪，排到了插图之后 —— 插图于是全部取到「还没脱」的旧状态。
  const padded = [
    '第四章·夜里',
    '',
    '吹风机关掉以后，苏晚低下头，在林晚晴的侧脸上吻了一下。',
    '',
    '林晚晴偏过头，回吻她。',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '两个人倒在床上，粉色的睡衣被推到胸口上方，睡裤连同内裤一起被褪到膝盖，然后被踢到床脚。',
    '',
    '',
    '',
    '',
    '',
    '',
    '苏晚的睡裙也被从下往上掀起来，从头顶脱掉。被子被扯过来盖住两个人。',
  ].join('\n');

  it('空行不会把脱衣事件推后（sourceLine 必须指向证据句本身）', () => {
    const before = state({ 林晚晴: ['pink pajamas'], 苏晚: ['grey pajamas'] });
    const lines = padded.split('\n');
    const out = synthesiseSceneClothing(padded, entries, before);
    const lq = out.changes.find((change) => change.name === '林晚晴');
    const sw = out.changes.find((change) => change.name === '苏晚');
    expect(lq, '林晚晴的睡衣必须被记').toBeTruthy();
    expect(sw, '苏晚的睡裙必须被记').toBeTruthy();
    expect(lines[lq!.sourceLine]).toContain('两个人倒在床上');
    expect(lines[sw!.sourceLine]).toContain('苏晚的睡裙');
  });

  it('落点行与 preceding 一致：把事件套到插图位置能分别取到脱前/脱后', () => {
    const before = state({ 林晚晴: ['pink pajamas'], 苏晚: ['grey pajamas'] });
    const out = synthesiseSceneClothing(padded, entries, before);
    const lines = padded.split('\n');
    const inception = lines.findIndex((line) => line.includes('两个人倒在床上'));
    const earlier = clothingAt(before, out.changes, 'scope', inception - 2, 0);
    const later = clothingAt(before, out.changes, 'scope', lines.length, 0);
    expect(clothingCaption(earlier.get('林晚晴')!).tag).toContain('pajamas');
    expect(clothingCaption(later.get('苏晚')!).tag).not.toContain('pajamas');
  });
});

describe('服装连续性：旧版遗留记录（部件状态 unknown）', () => {
  const legacy = (name: string): ClothingState => {
    const map: ClothingState = new Map();
    map.set(name, {
      name,
      outfitId: 'legacy_1qm1lj0',
      source: '旧版记录（部件未确认）',
      pieces: [
        { id: 'shirt', design: 'white shirt', state: { location: 'unknown' } },
        { id: 'skirt', design: 'long skirt', state: { location: 'unknown' } },
        { id: 'panties', design: 'panties', state: { location: 'unknown' } },
      ],
    } as never);
    return map;
  };

  it('人名写在动作句之后时，洗澡推断能通过人物定位校验', () => {
    const before = legacy('林晚晴');
    const out = synthesiseSceneClothing(BATH, entries, before);
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0].subjectEvidence ?? '').toContain('林晚晴');
    const accepted = acceptClothingChanges(out.changes, BATH, before, entries);
    // 旧版这里恒为 0 条：subjectEvidence 落在 charOffset 之后，preceding 里找不到它。
    expect(accepted.rejected).toEqual([]);
    expect(accepted.changes).toHaveLength(1);
    const after = clothingAt(before, accepted.changes, 'scope');
    expect(clothingCaption(after.get('林晚晴')!).tag).toContain('nude');
  });
});
