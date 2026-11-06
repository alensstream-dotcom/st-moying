import { describe, expect, it } from 'vitest';
import {
  matchFandomItems,
  rollFandom,
  rollPoolSize,
  rollPose,
  rollWardrobe,
} from './loreRoll';
import { allFandomItems } from './loreIndex';

describe('loreRoll 素材抽取与随机生成', () => {
  it('服装：留空时应从全库完全随机抽取，且返回合法结构', () => {
    const rolled = rollWardrobe('');
    expect(rolled).not.toBeNull();
    expect(rolled?.kind).toBe('wardrobe');
    expect(rolled?.tags.length).toBeGreaterThan(10);
    expect(rolled?.seed).toBeTypeOf('number');
  });

  it('服装：精准关键词命中收录条目', () => {
    const rolled = rollWardrobe('jk');
    expect(rolled).not.toBeNull();
    expect(rolled?.kind).toBe('wardrobe');
    expect(rolled?.tags).toMatch(/sailor|uniform|skirt|blouse|shirt/);
  });

  it('服装：未收录的冷门词不应报错返回 null，而应基于自由词生成', () => {
    const rolled = rollWardrobe('极光星尘战甲');
    expect(rolled).not.toBeNull();
    expect(rolled?.kind).toBe('wardrobe');
    expect(rolled?.name).toContain('极光星尘战甲');
    expect(rolled?.tags).toContain('极光星尘战甲');
  });

  it('姿势：留空时随机抽取姿势', () => {
    const rolled = rollPose('');
    expect(rolled).not.toBeNull();
    expect(rolled?.kind).toBe('pose');
    expect(rolled?.tags.length).toBeGreaterThan(5);
  });

  it('姿势：命中姿势词', () => {
    const rolled = rollPose('kneeling');
    expect(rolled).not.toBeNull();
    expect(rolled?.tags).toContain('kneeling');
  });

  it('同人：留空时从全库 200+ 角色完全随机抽取', () => {
    const rolled = rollFandom('');
    expect(rolled).not.toBeNull();
    expect(rolled?.kind).toBe('fandom');
    expect(rolled?.tags.length).toBeGreaterThan(10);
    expect(rolled?.category).toBeTruthy();
  });

  it('同人：按角色名命中知名角色（如 芙宁娜 / 雷电将军）', () => {
    const furina = rollFandom('芙宁娜');
    expect(furina).not.toBeNull();
    expect(furina?.tags.toLowerCase()).toContain('furina');

    const raiden = rollFandom('雷电将军');
    expect(raiden).not.toBeNull();
    expect(raiden?.tags.toLowerCase()).toContain('raiden');
  });

  it('同人：按作品名命中系列角色', () => {
    const genshin = rollFandom('原神');
    expect(genshin).not.toBeNull();
    expect(genshin?.tags.length).toBeGreaterThan(10);
  });

  it('同人：未收录词按自由同人生成而不抛错', () => {
    const custom = rollFandom('xyz999未收录角色');
    expect(custom).not.toBeNull();
    expect(custom?.kind).toBe('fandom');
    expect(custom?.name).toContain('xyz999未收录角色');
  });

  it('rollPoolSize 应能正确计算各分类在留空与有关键词时的条目数', () => {
    const totalWardrobe = rollPoolSize('', 'wardrobe');
    const totalPose = rollPoolSize('', 'pose');
    const totalFandom = rollPoolSize('', 'fandom');

    expect(totalWardrobe).toBeGreaterThan(500);
    expect(totalPose).toBeGreaterThan(200);
    expect(totalFandom).toBeGreaterThan(200);

    const matchJk = rollPoolSize('jk', 'wardrobe');
    expect(matchJk).toBeGreaterThan(0);
    expect(matchJk).toBeLessThan(totalWardrobe);

    const matchFurina = rollPoolSize('芙宁娜', 'fandom');
    expect(matchFurina).toBeGreaterThan(0);
  });

  it('matchFandomItems 支持按发色瞳色与别名多维度召回', () => {
    const all = allFandomItems();
    const purpleHair = matchFandomItems(all, 'purple hair');
    expect(purpleHair.length).toBeGreaterThan(0);
  });
});
