import { describe, expect, it } from 'vitest';
import {
  acceptClothingChanges,
  clothingAt,
  clothingCaption,
  synthesiseSceneClothing,
} from './outfitTimeline';
import type { CharTagEntry } from '@/state/charTags';

/**
 * 第 16 楼真实原文（用户在真机里核对过的那一楼）。
 *
 * 故障现象：正文第 2 句已经写明「双手娴熟的褪下温婉的衣服和裤子」，
 * 第 5 句又写「脱下温婉的内裤…放在浴缸之中」，第二张图（浴缸）里她却仍然
 * 穿着一身白衬衫和内衣。
 *
 * 三个叠加的根因，本文件逐条盯住：
 * 1. `undress` 那一层只认 DISPLACE_ACTION（「衣物＋被推到/掀到」），
 *    网文最常写的「褪下 / 脱下」一个都不认；
 * 2. `pieceMentioned` 只认具体件名，「衣服 / 裤子」这种泛称对任何部件都不成立；
 * 3. 动作主语取到施动者（李斌），他没有账本记录 → `if (!record) continue` 丢整条。
 */
const entries = [
  { name: '温婉', tag: 'girl, long black hair', aliases: [] },
  { name: '李斌', tag: 'boy, short black hair', aliases: [] },
] as unknown as CharTagEntry[];

function record(pieces: Array<[string, string, string]>) {
  return {
    name: '温婉',
    outfitId: 'probe',
    source: 'ai',
    pieces: pieces.map(([id, design, legacy]) => ({
      id,
      design,
      state: legacy ? { location: 'unknown', legacy } : { location: 'worn' },
    })),
  };
}

const wardrobe = new Map([
  [
    '温婉',
    record([
      ['shirt_story', 'open shirt', 'open shirt, pulled down'],
      ['bra_story', 'bra pulled down', 'open shirt, pulled down'],
    ]),
  ],
]);

const FLOOR16 = [
  '李斌俯身吻住温婉的唇，手掌贴上她的腰侧。',
  '但是这一次，李斌不管不顾的只是亲吻着温婉雪嫩的肌肤，双手娴熟的褪下温婉的衣服和裤子。',
  '手掌温柔的揉捏着温婉饱满柔软的美乳，轻抚着温婉纤细的腰肢和光滑的背脊。',
  '李斌横抱着温婉，一步步走进浴室。',
  '他温柔的脱下温婉的内裤，将妻子温婉放在浴缸之中。',
  '李斌将身子也一同沉入浴缸中，垫起温婉修长雪嫩的玉腿，开始轻柔的抚摸、按压。',
].join('\n');

describe('第 16 楼：泛称衣服 + 施动者主语', () => {
  it('「褪下她的衣服和裤子」要落成脱衣事件，主语取衣服的主人不取施动者', () => {
    const scene = synthesiseSceneClothing(FLOOR16, entries, wardrobe as never, []);
    const undress = scene.changes.find((c) => /褪下温婉的衣服和裤子/.test(c.evidence));
    expect(undress, '褪下衣服和裤子这一句必须产生一条换装事件').toBeTruthy();
    expect(undress?.name).toBe('温婉');
    expect(undress?.pieces.map((p) => p.id).sort()).toEqual(['bra_story', 'shirt_story']);
    expect(undress?.pieces.every((p) => p.state.location === 'removed')).toBe(true);
  });

  it('脱衣事件与后面洗浴推断并存，后者不能把前者整楼压掉', () => {
    const scene = synthesiseSceneClothing(FLOOR16, entries, wardrobe as never, []);
    expect(scene.changes.length).toBeGreaterThanOrEqual(2);
    expect(scene.changes.some((c) => /浴缸/.test(c.evidence))).toBe(true);
  });

  it('最终渲染是 nude，不能残留 legacy 的「open shirt, pulled down」', () => {
    const scene = synthesiseSceneClothing(FLOOR16, entries, wardrobe as never, []);
    const accepted = acceptClothingChanges(scene.changes, FLOOR16, wardrobe as never, entries);
    const state = clothingAt(wardrobe as never, accepted.changes, 'probe');
    const warm = [...state.values()].find((r) => r.name === '温婉');
    const caption = clothingCaption(warm as never);
    expect(caption.tag).toContain('completely nude');
    expect(caption.tag).toContain('no shirt');
    expect(caption.tag).not.toContain('open shirt');
    expect(caption.tag).not.toContain('pulled down');
  });

  it('泛称「衣服」不会顺手把内裤也脱掉（中文里「裤子」不含内裤）', () => {
    const inner = record([
      ['shirt_story', 'white shirt', ''],
      ['panties_story', 'white panties', ''],
    ]);
    const own = new Map([['温婉', inner]]);
    const line = '李斌伸手褪下温婉的衣服和裤子。';
    const scene = synthesiseSceneClothing(line, entries, own as never, []);
    const touched = scene.changes.flatMap((c) => c.pieces.map((p) => p.id));
    expect(touched).toContain('shirt_story');
    expect(touched).not.toContain('panties_story');
  });
});
