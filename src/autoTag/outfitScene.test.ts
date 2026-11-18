import { describe, expect, it } from 'vitest';
import type { CharTagEntry } from '@/state/charTags';
import { clothingBefore, narrativeHash, redressForNewScene, settleStaleUndress, type ClothingState } from './outfitTimeline';

const entry = (name: string): CharTagEntry =>
  ({ name, fields: {}, raw: '', nl: '', source: 'manual', desc: '', history: [] }) as unknown as CharTagEntry;
const asState = (state: Map<string, unknown>) => state as unknown as ClothingState;

function stripped(name: string) {
  return {
    name,
    outfitId: 'probe',
    source: 'ai',
    pieces: [
      { id: 'shirt', design: 'white shirt', state: { location: 'removed' } },
      { id: 'skirt', design: 'black skirt', state: { location: 'floor', wetness: 'wet' } },
    ],
  };
}

describe('假设句里的「第二天」不算场景翻篇', () => {
  // 第 9 楼原文：「如果有路人偷拍，那么第二天这萝莉的艳照和视频就会成为…」
  // 旧版只要命中「第二天」就把上一楼脱掉的衣物全部穿回，正在做爱的那一楼账本
  // 直接被复位成「穿好」，画面立刻变回一身衣服。
  const worry = '「如果有路人偷拍，那么第二天恐怕这萝莉的艳照和视频就会传遍网络。」真田低声说，手指却没停。';
  const really = '第二天一早，茉莉换好校服出门上学。';

  it('担忧里的第二天不触发穿回', () => {
    const before = new Map([['茉莉', stripped('茉莉')]]);
    const out = redressForNewScene(worry, [entry('茉莉')], asState(before));
    expect(out.changes).toHaveLength(0);
  });

  it('真的第二天仍然触发穿回', () => {
    const before = new Map([['茉莉', stripped('茉莉')]]);
    const out = redressForNewScene(really, [entry('茉莉')], asState(before));
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0].pieces.map((piece) => piece.state.location)).toEqual(['worn', 'worn']);
  });

  it('性行为进行中即使写了第二天也不穿回', () => {
    const before = new Map([['茉莉', stripped('茉莉')]]);
    const out = redressForNewScene('第二天，她吞吐着肉棒。', [entry('茉莉')], asState(before));
    expect(out.changes).toHaveLength(0);
  });

  it('陈旧回收同样不被假设句触发', () => {
    const state = new Map([['茉莉', stripped('茉莉')]]);
    settleStaleUndress(asState(state), worry);
    const pieces = [...state.values()][0] as { pieces: Array<{ state: Record<string, string> }> };
    expect(pieces.pieces[0].state.location).toBe('removed');
  });
});

describe('历史账本里的饰物部件在读取时被剔除', () => {
  it('发夹不会被当成一件可以湿在浴室的衣服', () => {
    // 第 4 楼真实账本：piece(hairpin) 与 dress 一起被写进 entries。
    const chat = [0, 1, 2].map((floor) => ({
      mes: floor === 1 ? '茉莉站在原地。' : '',
      swipe_id: 0,
      extra: {
        bbiOutfitState: {
          v: 2,
          swipe: 0,
          sourceHash: narrativeHash(floor === 1 ? '茉莉站在原地。' : ''),
          upstreamHash: 'x',
          start: ['茉莉'],
          delta: false,
          entries: [
            {
              name: '茉莉',
              outfitId: 'legacy',
              source: '旧版记录（部件未确认）',
              pieces: [
                { id: 'piece', design: 'hairpin', state: { location: 'floor', wetness: 'wet' } },
                { id: 'dress', design: 'sheer white dress', state: { location: 'worn' } },
              ],
            },
          ],
          changes: [],
          frames: [],
        },
      },
    }));
    const state = clothingBefore(chat as never, 2, [entry('茉莉')]);
    const ids = [...state.values()][0].pieces.map((piece) => piece.id);
    expect(ids).toEqual(['dress']);
  });
});
