import { describe, expect, it } from 'vitest';
import {
  acceptClothingChanges, adoptStoryClothing, clothingAt, clothingCaption, englishDesign, garmentKind,
  proseGarment, proseGarments,
} from '@/autoTag/outfitTimeline';
import type { CharTagEntry } from '@/state/charTags';

const entry = (name: string): CharTagEntry => ({
  name,
  fields: { hair: 'black hair', eyes: 'purple eyes' } as CharTagEntry['fields'],
  raw: '',
  nl: '',
  source: 'book',
  desc: '',
  history: [],
});
const record = (pieces: Array<{ id: string; design: string; state: Record<string, string> }>) =>
  ({ name: '林晚晴', outfitId: 'probe', source: 'ai', pieces }) as unknown as Parameters<typeof clothingCaption>[0];

const DAY = [
  { id: 'shirt', design: 'white shirt', state: { location: 'worn' } },
  { id: 'skirt', design: 'black skirt', state: { location: 'worn' } },
  { id: 'panties', design: 'white panties', state: { location: 'worn' } },
];

describe('泳装等款式必须先被认成类别', () => {
  it('泳衣 / 泳装 / 比基尼 / 死库水 归 swim', () => {
    for (const design of ['swimsuit', 'bikini', 'one-piece swimsuit', 'school swimsuit', '泳衣', '泳装', '比基尼', '死库水', '白色泳衣'])
      expect(garmentKind(design), design).toBe('swim');
  });

  it('bikini top 不再被 bra 抢走、one-piece swimsuit 不再被 dress 抢走', () => {
    expect(garmentKind('bikini top')).toBe('swim');
    expect(garmentKind('one-piece swimsuit')).toBe('swim');
  });

  it('中文半身裙不再被 dress 吃掉', () => {
    expect(garmentKind('黑色长裙')).toBe('skirt');
    expect(garmentKind('短裙')).toBe('skirt');
    expect(garmentKind('百褶裙')).toBe('skirt');
    expect(garmentKind('连衣裙')).toBe('dress');
    expect(garmentKind('旗袍')).toBe('dress');
    expect(garmentKind('睡裙')).toBe('pajamas');
  });

  it('proseGarments 认得出泳装句', () => {
    expect(proseGarments('林晚晴换上了泳衣。')).toEqual(['swimsuit']);
    expect(proseGarments('她穿着黑色比基尼。')).toEqual(['black swimsuit']);
    expect(proseGarment('换上死库水。')).toBe('swimsuit');
  });
});

describe('泳装换装要落进账本', () => {
  it('「林晚晴换上了泳衣」整套换掉白天那套', () => {
    const before = new Map([['林晚晴', record(DAY)]]) as never;
    const { changes } = adoptStoryClothing('林晚晴换上了泳衣。', [entry('林晚晴')], before);
    expect(changes).toHaveLength(1);
    expect(changes[0].operation).toBe('change');
    expect(changes[0].pieces.map((p) => [p.id, p.design])).toEqual([['swim', 'swimsuit']]);
  });

  it('「换上白色泳装」保留颜色', () => {
    const before = new Map([['林晚晴', record(DAY)]]) as never;
    const { changes } = adoptStoryClothing('“我换好了。”林晚晴穿着白色泳装走出来。', [entry('林晚晴')], before);
    expect(changes[0].pieces.map((p) => p.design)).toEqual(['white swimsuit']);
  });

  it('泳装穿着时渲染成 swimsuit，脱掉之后算全身脱光', () => {
    expect(clothingCaption(record([{ id: 'swim', design: '白色泳衣', state: { location: 'worn' } }])).tag).toBe(
      'white swimsuit',
    );
    expect(clothingCaption(record([{ id: 'swim', design: '白色泳衣', state: { location: 'removed' } }])).tag).toBe('nude');
  });

  it('中文款式翻成英文 tag，长裙是 skirt 不是 dress', () => {
    expect(englishDesign('黑色长裙')).toBe('black skirt');
    expect(englishDesign('白连衣')).toBe('white dress');
    expect(englishDesign('淡粉色的睡衣')).toBe('pink pajamas');
    expect(englishDesign('white swimsuit')).toBe('white swimsuit');
  });
});

describe('换泳装的整条链路', () => {
  // 用户报的「剧情里换泳装换不出来」有两层：词表认不出 swim（已修），
  // 以及 acceptClothingChanges 三道 change 闸门只认「换上/换装/更衣」。
  // 网文真正的写法是「她拉开塑料帘走出来，身上只剩一件白色泳衣」——
  // 没有换装动词，但账本必须跟着换，否则 enforceClothing 会用白天的衬衫长裙覆盖模型画的泳装。
  const before = () =>
    new Map([
      [
        '林晚晴',
        record([
          { id: 'shirt', design: 'white shirt', state: { location: 'worn' } },
          { id: 'skirt', design: 'black skirt', state: { location: 'worn' } },
          { id: 'panties', design: 'white panties', state: { location: 'worn' } },
        ]),
      ],
    ]) as unknown as Parameters<typeof acceptClothingChanges>[2];

  it('「身上只剩一件白色泳衣」被采纳为整身换，旧衬衫长裙退出账本', () => {
    // 真实正文不会只写一句：上一句点名「林晚晴站在镜子前」，下一句才用「她」。
    const story = [
      '林晚晴站在更衣室的镜子前，白色衬衫的扣子被一颗颗解开。',
      '"换好了。"她拉开塑料帘走出来，身上只剩一件白色泳衣，肩带细得像两根线。',
    ].join('\n');
    const state = before();
    const { changes } = adoptStoryClothing(story, [entry('林晚晴')], state);
    expect(changes).toHaveLength(1);
    expect(changes[0].operation).toBe('change');
    const accepted = acceptClothingChanges(changes, story, state, [entry('林晚晴')]);
    expect(accepted.rejected).toEqual([]);
    expect(accepted.changes).toHaveLength(1);
    const after = clothingAt(state, accepted.changes, 'scope');
    expect(clothingCaption(after.get('林晚晴')!).tag).toBe('white swimsuit');
  });

  it('「更衣室」是地点不是换装动作，不能凭空记一件衬衫', () => {
    const story = ['林晚晴站在更衣室的镜子前，白色衬衫的扣子被一颗颗解开。'].join('\n');
    const state = before();
    const { changes } = adoptStoryClothing(story, [entry('林晚晴')], state);
    expect(changes).toEqual([]);
  });

  it('没有换装动词也没有新类别时仍然拒（避免外观描述悄悄改写账本）', () => {
    const story = '林晚晴穿着一条黑色长裙，站在门口。';
    const state = before();
    const { changes } = adoptStoryClothing(story, [entry('林晚晴')], state);
    // 同类部件只改款式，不整套重置。
    expect(changes.every((c) => c.operation !== 'change')).toBe(true);
  });
});
