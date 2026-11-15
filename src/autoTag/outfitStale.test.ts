import { describe, expect, it } from 'vitest';
import type { CharTagEntry } from '@/state/charTags';
import {
  clothingCaption,
  garmentKind,
  initialiseClothingFromImage,
  settleStaleUndress,
  synthesiseSceneClothing,
  type ClothingState,
} from './outfitTimeline';

const entry = (name: string): CharTagEntry =>
  ({ name, fields: {}, raw: '', nl: '', source: 'manual', desc: '', history: [] }) as unknown as CharTagEntry;

type Wardrobe = Map<string, { name: string; outfitId: string; source: string; pieces: Array<{ id: string; design: string; state: Record<string, string> }> }>;
const asState = (state: Wardrobe) => state as unknown as ClothingState;

function wardrobe(name: string, pieces: Array<[string, string]>): Wardrobe {
  return new Map([
    [
      name,
      {
        name,
        outfitId: 'probe',
        source: 'ai',
        pieces: pieces.map(([id, design]) => ({ id, design, state: { location: 'worn' } })),
      },
    ],
  ]);
}

describe('旧版账本里的走光词会陈旧回收', () => {
  it('连着两楼没再提就收回穿着，并清掉那串 legacy 词', () => {
    // 第 1 楼实际账本：模型把 off shoulder / breasts out 写进了 state.legacy，
    // 旧版只回收 location 与 exposure，这两位就一直跟到第 15 楼。
    const state = new Map([
      [
        '茉莉',
        {
          name: '茉莉',
          outfitId: 'legacy',
          source: '旧版记录（部件未确认）',
          pieces: [{ id: 'shirt', design: 'white shirt', state: { location: 'unknown', legacy: 'off shoulder, breasts out' } }],
        },
      ],
    ]);
    settleStaleUndress(asState(state), '茉莉坐在沙发上看书，窗外的雨停了。');
    settleStaleUndress(asState(state), '茉莉喝了口茶，继续翻页。');
    const piece = [...state.values()][0].pieces[0] as { state: Record<string, string> };
    expect(piece.state.stale).toBe('0');
    expect(piece.state.legacy).toBeUndefined();
  });

  it('这一楼还在写裸露时不回收', () => {
    const state = new Map([
      [
        '茉莉',
        {
          name: '茉莉',
          outfitId: 'legacy',
          source: '旧版记录（部件未确认）',
          pieces: [{ id: 'shirt', design: 'white shirt', state: { location: 'unknown', legacy: 'breasts out' } }],
        },
      ],
    ]);
    settleStaleUndress(asState(state), '茉莉闭着眼，胸口毫无遮挡地起伏。');
    expect([...state.values()][0].pieces[0].state.legacy).toBe('breasts out');
  });
});

describe('性行为进行中不把人穿回去', () => {
  it('射精吞精那两楼保持脱掉的账本', () => {
    const state = wardrobe('茉莉', [['shirt', 'white shirt']]);
    state.get('茉莉')!.pieces[0].state.location = 'removed';
    settleStaleUndress(asState(state), '她吞吐着肉棒，直到精液射进喉咙。');
    settleStaleUndress(asState(state), '她吞吐着肉棒，直到精液射进喉咙。');
    expect(state.get('茉莉')!.pieces[0].state.location).toBe('removed');
  });
});

describe('饰物不进服装账本', () => {
  it('发夹不算身体衣物', () => {
    expect(garmentKind('hairpin')).toBe('');
  });

  it('浴室场景推断不会把发夹记成湿着放在地上', () => {
    const state = wardrobe('茉莉', [
      ['hairpin', 'hairpin'],
      ['shirt', 'white shirt'],
    ]);
    const { changes } = synthesiseSceneClothing('茉莉走进浴室，用水冲洗身体。', [entry('茉莉')], asState(state));
    const pieces = changes.flatMap((change) => change.pieces.map((piece) => piece.id));
    expect(pieces).toContain('shirt');
    expect(pieces).not.toContain('hairpin');
  });

  it('建账时只剩饰物就不建这条空衣服', () => {
    const state: Wardrobe = new Map();
    initialiseClothingFromImage(
      { position: 'P1', tag: '1girl', nl: '', characters: [{ name: '茉莉', tag: '1girl, hairpin, long black hair' }] } as never,
      asState(state),
      '茉莉站在原地。',
      [entry('茉莉')],
    );
    expect(state.has('茉莉')).toBe(false);
  });
});

describe('引号里的台词不驱动当前服装', () => {
  it('回忆里的「洗澡」不给现在记湿衣服', () => {
    // 第 4 楼实际文案：这句是她在复述过去，旧版把整身记成 floor + wet。
    const story =
      '真田替她把外套拉好。\n「按主人的吩咐，茉莉全裸地绑上礼物彩带，在洗澡的时候把自己送给哥哥了。」\n茉莉低下头，把彩带递过去。';
    const state = wardrobe('茉莉', [['shirt', 'white shirt'], ['skirt', 'black skirt']]);
    const { changes } = synthesiseSceneClothing(story, [entry('茉莉')], asState(state));
    expect(changes).toHaveLength(0);
    const caption = clothingCaption({
      name: '茉莉',
      outfitId: 'probe',
      source: 'ai',
      pieces: [{ id: 'shirt', design: 'white shirt', state: { location: 'worn' } }],
    } as never);
    expect(caption.tag).toContain('white shirt');
  });
});
