import { describe, expect, it } from 'vitest';
import { prepareTargetText } from './clean';
import { injectImageTags } from './protocol';
import { parseImageTags } from '@/st/imageTagRegex';
import type { ImageInsertion } from './protocol';
import {
  clothingAt, clothingBefore, clothingCaption, clothingRevision, enforceClothing, narrativeHash,
  parseClothingChanges, planClothingTimeline, type ClothingFloor, type ClothingState,
} from './outfitTimeline';
import { BBI_OUTFIT_EXTRA_KEY } from './outfitState';
import type { CharTagEntry } from '@/state/charTags';
import type { STMessage } from '@/st/context';

const name = '林澄';
const person: CharTagEntry = { name, fields: {} as CharTagEntry['fields'], history: [], desc: '', raw: '', nl: '', source: 'ai' };
const costume = () => ({ era: 'modern', culture: 'unknown', evidence: '', source: 'story' } as const);
const end = (story: string, line: number) => story.split('\n')[line].length;
const frame = (story: string, line: number): ImageInsertion => ({
  sourceLine: line, charOffset: end(story, line), position: 'P' + (line + 1),
  tag: '1girl, full body, orange dress',
  characters: [{ name, tag: '1girl, orange dress, long sleeves', nl: '' }],
  nl: '', negative: '', size: 'portrait',
});
const play = (text: string, start: ClothingState = new Map(), images: ImageInsertion[] = []) =>
  planClothingTimeline(text, [person], start, [], images, 'story', costume);
const tagAt = (story: string, start: ClothingState, result: ReturnType<typeof play>, line: number) =>
  clothingCaption(clothingAt(start, result.changes, 'story', line, end(story, line)).get(name)!).tag;

describe('服装按原文位置重放', () => {
  it('同一物理行逐次脱外套、解开衣领、脱下内搭，后面的画面不能回写前面', () => {
    const clauses = [
      '林澄穿着深蓝色外套、白色短袖衬衫、灰色长裤和浅色文胸。',
      '她脱下外套。',
      '随后她敞开衣领。',
      '她脱了内衣。',
      '她坐在沙发上继续看书。',
    ];
    const story = clauses.join('');
    let offset = 0;
    const images = clauses.map((clause) => ({ ...frame(story, 0), charOffset: offset += clause.length }));
    const before: ClothingState = new Map();
    const result = play(story, before, images);
    const pieces = images.map((image) =>
      clothingAt(before, result.changes, 'story', 0, image.charOffset).get(name)!.pieces);
    expect(pieces[0].find((p) => p.id === 'jacket')?.state.location).toBe('worn');
    expect(pieces[1].find((p) => p.id === 'jacket')?.state.location).toBe('removed');
    expect(pieces[1].find((p) => p.id === 'shirt')?.state.fastening).toBe('closed');
    expect(pieces[2].find((p) => p.id === 'shirt')?.state.fastening).toBe('open');
    expect(pieces[2].find((p) => p.id === 'bra')?.state.location).toBe('worn');
    expect(pieces[3].find((p) => p.id === 'bra')?.state.location).toBe('removed');
    expect(pieces[4]).toEqual(pieces[3]);
  });

  it('无图楼层换了单件后跨楼继承，镜头猜测和没描述过的颜色都不能复写', () => {
    const first = '林澄穿着白色短袖衬衫、灰色长裤和深蓝色外套。';
    const second = '林澄换上了红色衬衫。';
    const third = '她安静地看着窗外。';
    const chat: STMessage[] = [];
    for (const story of [first, second, third]) {
      const before = clothingBefore(chat, chat.length, [person]);
      const images = story === second ? [] : [frame(story, 0)];
      const result = play(story, before, images);
      const final = clothingAt(before, result.changes, 'story');
      if (story === third) {
        enforceClothing(images[0], final, true, true, [person], story);
        expect(images[0].characters[0].tag).toContain('red shirt');
        expect(images[0].characters[0].tag).toContain('grey pants');
        expect(images[0].characters[0].tag).not.toMatch(/orange dress|long sleeves|white shirt/);
        expect(result.changes).toEqual([]);
      }
      for (const image of images) enforceClothing(image, final, false, true, [person], story);
      const wardrobe: ClothingFloor = {
        v: 2, positioned: true, delta: true, sourceHash: narrativeHash(story),
        upstreamHash: clothingRevision(chat, chat.length), swipe: 0,
        start: [...before.values()], entries: [...final.values()], changes: result.changes, rejected: [], frames: [],
      };
      chat.push({ name, mes: injectImageTags(story, images), is_user: false, is_system: false, extra: { [BBI_OUTFIT_EXTRA_KEY]: wardrobe } });
    }
    expect(parseImageTags(chat[1].mes)).toHaveLength(0);
  });

  it('上班、就寝和次日上班各有自己的穿搭，跨场景事件只影响自己和之后的图', () => {
    const story = [
      '林澄去了公司上班。',
      '林澄换上了粉色长袖睡衣。',
      '晚上，她上床睡觉了。',
      '第二天一早，林澄走进办公室。',
      '她放下文件继续工作。',
    ].join('\n');
    const start = new Map();
    const result = play(story, start);
    expect(tagAt(story, start, result, 0)).toContain('black suit');
    expect(tagAt(story, start, result, 2)).toContain('pink pajamas');
    expect(tagAt(story, start, result, 3)).toBe(tagAt(story, start, result, 0));
    expect(tagAt(story, start, result, 4)).toBe(tagAt(story, start, result, 3));
    expect(result.changes.find((change) => change.activity === 'work' && change.sourceLine === 3)?.inferred)
      .toBe('scene');
  });

  it('同一句先报地点再写服装时，显式衣物优先，并储存为对应活动的穿搭', () => {
    const story = [
      '林澄坐在办公室，身穿深蓝色外套、白色短袖衬衫和灰色长裤。',
      '晚上林澄上床睡觉了。',
      '第二天一早林澄走进办公室。',
    ].join('\n');
    const start = new Map();
    const result = play(story, start);
    const initial = tagAt(story, start, result, 0);
    expect(initial).toContain('grey pants');
    expect(initial).toContain('short sleeves');
    expect(initial).not.toContain('pencil skirt');
    expect(tagAt(story, start, result, 1)).toContain('pajamas');
    expect(tagAt(story, start, result, 2)).toBe(initial);
  });

  it('忽略模型未引用正文的首套猜测，衬衫和内搭背心分别记录', () => {
    const story = '成年设计师林澄坐在办公室的绘图桌旁，她身穿深蓝色外套、白色短袖衬衫、灰色长裤和浅色背心。';
    const guessed = {
      name, operation: 'init' as const, position: 'P1', sourceLine: 0, charOffset: story.length, evidence: '',
      pieces: [{ id: 'outerwear', design: 'blue coat', state: { location: 'worn', fastening: 'open' } }],
    };
    const result = planClothingTimeline(story, [person], new Map(), [guessed], [frame(story, 0)], 'test', costume);
    const exact = clothingAt(new Map(), result.changes, 'test').get(name)!;
    expect(exact.activity).toBe('work');
    expect(exact.pieces.map((p) => p.design)).toEqual(['navy blue jacket', 'white shirt, short sleeves', 'grey pants', 'camisole']);
    expect(exact.pieces.map((p) => p.state.fastening)).toEqual(['closed', 'closed', 'closed', 'closed']);
  });

  it('明确没穿衣服就寝照记，次日到公司时才复原，路过另一房间不自动穿回', () => {
    const story = [
      '林澄穿着白色衬衫和黑色长裤。',
      '林澄没穿衣服，晚上躺下睡觉。',
      '她半夜走进客厅倒水。',
      '第二天，林澄去上班了。',
    ].join('\n');
    const start = new Map();
    const result = play(story, start);
    expect(tagAt(story, start, result, 1)).toContain('nude');
    expect(tagAt(story, start, result, 2)).toContain('nude');
    expect(tagAt(story, start, result, 3)).toContain('black suit');
    expect(tagAt(story, start, result, 3)).not.toContain('nude');
  });

  it('第一次出场无衣物可继承时先记现状，之后明确穿衣可以建套装', () => {
    const story = '林澄没穿衣服就躺下睡觉。\n次日林澄穿上了白色衬衫和灰色长裤。';
    const start = new Map();
    const result = play(story, start);
    expect(tagAt(story, start, result, 0)).toContain('nude');
    expect(tagAt(story, start, result, 1)).toContain('white shirt');
    expect(tagAt(story, start, result, 1)).not.toContain('nude');
  });

  it('验证代词的结构化穿脱事件，不让默认字段覆盖没动的部件', () => {
    const text = '林澄穿着白色衬衫和深蓝色外套。\n她脱掉了外套。\n她将白衬衫的衣领敞开。';
    const segments = prepareTargetText(text, []).segments;
    const events = parseClothingChanges([{
      name, position: segments.at(-1)!.id, operation: 'patch',
      evidence: '她将白衬衫的衣领敞开。', subjectEvidence: '林澄穿着白色衬衫和深蓝色外套。',
      pieces: [{ id: 'shirt', design: '', state: { fastening: 'open' } }],
    }], segments, text);
    const result = planClothingTimeline(text, [person], new Map(), events, [], 'test', costume);
    const record = clothingAt(new Map(), result.changes, 'test').get(name)!;
    expect(record.pieces.find((p) => p.id === 'shirt')?.state.fastening).toBe('open');
    expect(record.pieces.find((p) => p.id === 'jacket')?.state.location).toBe('removed');
  });
});
