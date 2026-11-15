/**
 * 受控枚举 → danbooru 复合 tag 的护栏。
 *
 * 这些断言全部来自真实翻车现场（第 16–19 节），不是想象出来的边界：
 * - 「一口含在了她蜜穴之上」被判成「她给男口交」（方向反了）；
 * - 「抚摸阴蒂」配 `upper body, from above, pov`，看点被裁成大头照；
 * - 后入 + `pov` + `all fours` + `looking back`，屁股后面画出一根黑柱。
 */

import { describe, expect, it } from 'vitest';
import {
  ACT_ENUM_RULE,
  actExpansion,
  alignMouthAct,
  enforceActFraming,
  normalizeAct,
  normalizeGiver,
} from '@/autoTag/actTags';
import { explicitTagsFor, mouthSide } from '@/autoTag/explicitTags';

describe('normalizeAct', () => {
  it('认枚举码本身，容忍大小写/空格/下划线/引号包裹', () => {
    expect(normalizeAct('mouth-on-her')).toBe('mouth-on-her');
    expect(normalizeAct(' Mouth_On_Her ')).toBe('mouth-on-her');
    expect(normalizeAct('"mouth-on-him"')).toBe('mouth-on-him');
    expect(normalizeAct('act:"digit"')).toBe('digit');
  });

  it('把模型照抄的 danbooru 原词与中文归一', () => {
    expect(normalizeAct('fellatio')).toBe('mouth-on-him');
    expect(normalizeAct('cunnilingus')).toBe('mouth-on-her');
    expect(normalizeAct('doggystyle')).toBe('rear');
    expect(normalizeAct('抚摸')).toBe('digit');
    expect(normalizeAct('口交')).toBe('mouth-on-him');
  });

  it('认不出返回 null：不补 tag，但绝不丢图', () => {
    expect(normalizeAct('none')).toBeNull();
    expect(normalizeAct('')).toBeNull();
    expect(normalizeAct('something-weird')).toBeNull();
    expect(normalizeAct(undefined)).toBeNull();
  });

  it('giver 只认两方', () => {
    expect(normalizeGiver('1boy')).toBe('1boy');
    expect(normalizeGiver('1girl')).toBe('1girl');
    expect(normalizeGiver('everyone')).toBeNull();
  });
});

describe('actExpansion', () => {
  it('口交两种方向给出完全不同的器官 tag', () => {
    const her = actExpansion('mouth-on-her');
    expect(her.base).toContain('cunnilingus');
    expect(her.base).not.toContain('fellatio');
    expect(her.source).toContain('head between legs');

    const him = actExpansion('mouth-on-him');
    expect(him.base).toContain('fellatio');
    expect(him.base).not.toContain('cunnilingus');
  });

  it('没给枚举时是空展开，不给画面强加任何东西', () => {
    expect(actExpansion(null).base).toEqual([]);
    expect(actExpansion(null).framing).toBeNull();
  });
});

describe('alignMouthAct', () => {
  it('正文说男含女，就把模特的 mouth-on-him 掰回来', () => {
    expect(alignMouthAct('mouth-on-him', 'on-her')).toBe('mouth-on-her');
    expect(alignMouthAct('mouth-on-her', 'on-him')).toBe('mouth-on-him');
  });

  it('正文判不出方向、或不是嘴上动作时，原样不动', () => {
    expect(alignMouthAct('mouth-on-him', null)).toBe('mouth-on-him');
    expect(alignMouthAct('digit', 'on-her')).toBe('digit');
    expect(alignMouthAct(null, 'on-her')).toBeNull();
  });
});

describe('mouthSide：方向靠器官距离判，不靠词表猜', () => {
  it('男给女口交不补成 fellatio', () => {
    const text = '李斌伸手扶起温婉的腰肢，再次张开嘴巴一口含住了温婉鲜嫩的蜜穴，贪婪的吮吸舔舐了起来。';
    expect(mouthSide(text)).toBe('on-her');
    expect(explicitTagsFor(text)).not.toContain('fellatio');
  });

  it('女给男口交才补 fellatio', () => {
    const text = '温婉只是稍微犹豫了一下，竟然直接一口含住了李斌的肉棒。';
    expect(mouthSide(text)).toBe('on-him');
    const tags = explicitTagsFor(text);
    expect(tags).toContain('fellatio');
    expect(tags).not.toContain('cunnilingus');
  });

  it('两侧都远时判不出方向，宁可少补也不补反', () => {
    expect(mouthSide('她轻轻咬住嘴唇，眼神躲开。')).toBeNull();
  });
});

describe('enforceActFraming', () => {
  it('后入 + pov + 四足跪趴 = 前景黑柱，必须降成第三人称背后机位', () => {
    const tag = '1girl, 1boy, indoors, cowboy shot, from behind, pov, all fours, arched back, looking back';
    const fixed = enforceActFraming(tag, 'rear');
    expect(fixed).not.toContain('pov');
    expect(fixed).toContain('from behind');
  });

  it('模型没给枚举时也照样修——构图本身踩了就该修', () => {
    const tag = '1girl, 1boy, pov, all fours, looking back';
    const fixed = enforceActFraming(tag, null);
    expect(fixed).not.toContain('pov');
    expect(fixed).toContain('from behind');
  });

  it('看点在下体却被裁成 upper body 时，兜回能拍到躯干以下的景别', () => {
    const tag = '1girl, 1boy, bathroom, upper body, from above, pov, hand on lower body';
    const fixed = enforceActFraming(tag, 'digit');
    expect(fixed).toContain('cowboy shot');
    expect(fixed).not.toContain('upper body');
    expect(fixed).not.toContain('pov');
  });

  it('本来就合适的构图一个字都不改', () => {
    const tag = '1girl, 1boy, bedroom, lower body, from below, fingering';
    expect(enforceActFraming(tag, 'digit')).toBe(tag);
  });
});

describe('ACT_ENUM_RULE', () => {
  it('枚举值本身不含解剖词——网关会对成段露骨英文做输出侧过滤', () => {
    for (const word of ['fellatio', 'penis', 'pussy', 'cunnilingus', 'doggystyle']) {
      expect(ACT_ENUM_RULE.toLowerCase()).not.toContain(word);
    }
  });

  it('写清「方向由枚举值固定」，避免模型再自己编施受', () => {
    expect(ACT_ENUM_RULE).toContain('act');
  });
});
