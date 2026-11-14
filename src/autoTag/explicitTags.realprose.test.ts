import { describe, expect, it } from 'vitest';

import { explicitTagsFor } from '@/autoTag/explicitTags';

/**
 * 用户那本小说开篇的真实句子（保留原写法）。
 *
 * 这三个用例来自一次实机事故：
 * ① 同一句里只有手指与震动棒，旧规则却补出 `penis`，画面里女主面前凭空多出一根；
 * ② 写「揉搓乳球 / 拨弄樱桃」的句子一条 tag 都补不出来（词表缺 `乳球/乳峰` 与动词窗口）；
 * ③ 真性交句子被误判成自慰。
 */
const SOLO_TOY =
  '探入裙底的纤细玉手死死按着震动棒，在瘙痒难耐淫水流满的小穴内反复来回抽送。';
const BREAST_PLAY =
  '柔软乳球被埋入得近乎消失的手指肆意揉搓，挺拔娇粉的樱桃被双指夹住拨弄。';
const REAL_SEX = '两人滚到床上做爱，他插了进去，抽送了十几下，最后射在里面。';

describe('真实网文写法 → 本地补 tag', () => {
  it('道具自慰不补 penis(凭空多出一根就是这么来的)', () => {
    const tags = explicitTagsFor(SOLO_TOY, '1girl, solo');
    expect(tags).toContain('vibrator');
    expect(tags).toContain('masturbation');
    expect(tags).not.toContain('penis');
  });

  it('「揉搓乳球 / 拨弄樱桃」这种名词在动词后的语序也要认出来', () => {
    const tags = explicitTagsFor(BREAST_PLAY, '1girl, solo');
    expect(tags).toContain('breast play');
    expect(tags).toContain('nipples');
  });

  it('真性交仍然补 vaginal sex(不因为改了道具分支就丢掉)', () => {
    const tags = explicitTagsFor(REAL_SEX, '1girl, 1boy');
    expect(tags).toContain('vaginal sex');
    expect(tags).toContain('creampie');
  });

  it('有男主、没有明写男根时只补 vaginal sex 与 pussy,不硬塞 penis', () => {
    const tags = explicitTagsFor('他扶着自己慢慢插了进去。', '1girl, 1boy');
    expect(tags).toContain('vaginal sex');
    expect(tags).toContain('pussy');
  });
});
