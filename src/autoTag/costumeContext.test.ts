import { describe, expect, it } from 'vitest';
import {
  costumeAllows,
  costumeConflicts,
  inferStoryCostume,
  prepareCostumeRequest,
  type CostumeRequest,
} from './costumeContext';

const dialogue = '陈瑾狠狠的轻喝了一声，抬起头环顾巡视了一眼，口中喃喃自语着说道：“妈的，着要是古代就好了。';

const ancient = {
  era: 'ancient' as const,
  culture: 'unknown' as const,
  evidence: '',
  source: 'setting' as const,
};

describe('正文里的时代推断不认台词', () => {
  it('只有一句台词提到「古代」时仍算 unknown', () => {
    expect(inferStoryCostume(dialogue, 'story').era).toBe('unknown');
  });

  it('叙述里写了「这个世界是古代王朝」时采信古代', () => {
    const story = '这是一个架空的古代王朝，城里有高高的城墙。';
    expect(inferStoryCostume(story, 'story').era).toBe('ancient');
  });

  it('引号外的现代叙述说了两句也算现代', () => {
    const story = '她在现代都市的写字楼里加班。\n窗外的现代校园早已熄灯。';
    expect(inferStoryCostume(story, 'story').era).toBe('modern');
  });

  it('台词里的古代不会把整楼定成古代', () => {
    const request: CostumeRequest = {};
    prepareCostumeRequest(request, '', dialogue);
    expect(request.seed?.era).toBe('unknown');
  });
});

describe('现代基础款也算现代族', () => {
  // 这三件过去不在任何族里：既不上报冲突，也不进允许白名单，
  // 一旦时代被判成古代就被 removeUnbackedCostume 当无依据整条剥掉，人画成没穿。
  it.each(['blue cotton blouse, long sleeves', 'dark grey trousers', 'grey apron, cotton'])(
    '%s 归到 casual 族',
    (design) => {
      expect(costumeConflicts(design, ancient)).toEqual(['casual']);
    },
  );

  it('正文点了名就自证通过', () => {
    expect(costumeAllows('blue cotton blouse', ancient, '她穿着一件蓝布衬衫')).toBe(true);
  });
});
