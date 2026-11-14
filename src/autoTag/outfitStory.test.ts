import { describe, expect, it } from 'vitest';
import {
  adoptStoryClothing,
  clothingAt,
  clothingCaption,
  garmentKind,
  proseGarment,
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

function dayState(): ClothingState {
  const state: ClothingState = new Map();
  state.set('林晚晴', {
    name: '林晚晴',
    pieces: [
      { id: 'shirt', design: 'white shirt', state: { location: 'worn' } },
      { id: 'skirt', design: 'black skirt', state: { location: 'worn' } },
      { id: 'panties', design: 'white panties', state: { location: 'worn' } },
    ],
  } as never);
  return state;
}

function run(source: string, base = dayState(), names = ['林晚晴']) {
  const out = adoptStoryClothing(source, names.map(entry), base);
  const next = clothingAt(base, out.changes, 'probe');
  return { out, caption: clothingCaption(next.get(names[0])!).tag, next };
}

describe('正文自己点名的换装（不依赖模型 tag）', () => {
  describe('睡衣类归到 pajamas', () => {
    it('睡衣 / 睡裙 / 浴袍 / 睡裤 都认得出', () => {
      expect(garmentKind('pajamas')).toBe('pajamas');
      expect(garmentKind('淡粉色的睡衣')).toBe('pajamas');
      expect(garmentKind('丝绸睡裙')).toBe('pajamas');
      expect(garmentKind('白色浴袍')).toBe('pajamas');
      expect(garmentKind('棉质睡裤')).toBe('pajamas');
      expect(garmentKind('nightgown')).toBe('pajamas');
      expect(garmentKind('bathrobe')).toBe('pajamas');
    });

    it('proseGarment 不会被 skirt/pants 抢先', () => {
      // 睡裙含「裙」、睡裤含「裤」，旧词表顺序会把它们认成裙子/裤子，
      // 换睡衣于是只换了下半身，上装留在账本里。
      expect(proseGarment('她穿上睡裙，钻进被窝。')).toBe('pajamas');
      expect(proseGarment('林晚晴换上一身淡粉色的睡衣。')).toBe('pink pajamas');
    });
  });

  describe('账本推进', () => {
    it('「换上了睡衣」把白天那套整体换掉', () => {
      const { out, caption } = run('浴室水声停了。\n她换上了睡衣，钻进被窝里。');
      expect(out.changes).toHaveLength(1);
      expect(out.changes[0].operation).toBe('change');
      expect(caption).toContain('pajamas');
      expect(caption).not.toContain('white shirt');
      expect(caption).not.toContain('black skirt');
    });

    it('「换上一条红裙」只换裙子，上衣与内裤保留', () => {
      const { out, caption } = run('林晚晴换上一条红裙，站在镜前。');
      expect(out.changes[0].operation).toBe('patch');
      expect(caption).toContain('red skirt');
      expect(caption).toContain('white shirt');
      expect(caption).toContain('white panties');
      expect(caption).not.toContain('black skirt');
    });

    it('只写代词的换装句落到唯一的女性账本上', () => {
      const { out } = run('她换上了睡衣，钻进被窝。');
      expect(out.changes[0].name).toBe('林晚晴');
    });

    it('别人换装不算她的', () => {
      const { out } = run('陆沉换上西装，林晚晴在门口等他。', dayState(), ['林晚晴', '陆沉']);
      expect(out.changes.some((c) => c.name === '林晚晴')).toBe(false);
    });

    it('脱衣句不是换装', () => {
      expect(run('林晚晴把睡衣脱下来，扔在床脚。').out.changes).toHaveLength(0);
      expect(run('她没穿睡衣，只裹着浴巾。').out.changes).toHaveLength(0);
    });

    it('用户固定整套时一行都不改，只记原因', () => {
      const base = dayState();
      (base.get('林晚晴') as unknown as { suitMode: string }).suitMode = 'always';
      const out = adoptStoryClothing('林晚晴换上了睡衣。', [entry('林晚晴')], base);
      expect(out.changes).toHaveLength(0);
      expect(out.notes.join()).toContain('固定套装');
    });
  });

  describe('渲染', () => {
    it('睡衣整身脱掉渲染成 nude（covers 把 pajamas 当连体）', () => {
      const c = clothingCaption({
        name: 'x',
        pieces: [{ id: 'a', design: 'pink pajamas', state: { location: 'removed' } }],
      } as never);
      expect(c.tag).toContain('nude');
    });

    it('睡衣在穿时原样出现在 tag 里', () => {
      const c = clothingCaption({
        name: 'x',
        pieces: [{ id: 'a', design: 'pink pajamas', state: { location: 'worn' } }],
      } as never);
      expect(c.tag).toBe('pink pajamas');
      expect(c.nl).toBe('Wearing pink pajamas.');
    });
  });
});
