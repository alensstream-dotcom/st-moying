import { describe, expect, it } from 'vitest';
import { isGenericCharacterName } from '@/autoTag/genericName';
import { anchorBlock, buildAnchors } from '@/autoTag/anchorLedger';
import type { STMessage } from '@/st/context';

function floor(tag: string, name = '小雪', mes = '') {
  return {
    mes,
    extra: {
      bbiOutfitState: {
        frames: [{ tag: `<bbi_image>1girl, classroom<characters>[{"name":"${name}","tag":"${tag}","nl":""}]</characters></bbi_image>` }],
      },
    },
  } as unknown as STMessage;
}

describe('isGenericCharacterName', () => {
  it('把路人/关系称呼判成通用', () => {
    for (const name of ['路人', '少女', '姐姐', '老师', '陌生女子', 'NPC', 'stranger', 'woman', 'girl', '某女'])
      expect(isGenericCharacterName(name), name).toBe(true);
  });

  it('单字也算通用', () => {
    expect(isGenericCharacterName('琳')).toBe(true);
    expect(isGenericCharacterName('')).toBe(true);
  });

  it('真名放行', () => {
    for (const name of ['林晚晴', '风千华', 'Kate', 'Asuna'])
      expect(isGenericCharacterName(name), name).toBe(false);
  });
});

describe('buildAnchors', () => {
  it('拆出外貌与着装，跳过通用称呼', () => {
    const chat = [floor('girl, long black hair, red eyes, white dress'), floor('1girl, long black hair, red eyes, white dress', '少女')];
    const anchors = buildAnchors(chat, 2);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].appear).toBe('girl, long black hair, red eyes');
    expect(anchors[0].costume).toBe('white dress');
  });

  it('越近的楼层覆盖越早的', () => {
    const chat = [floor('long black hair, red dress'), floor('long black hair, blue dress')];
    expect(buildAnchors(chat, 2)[0].costume).toBe('blue dress');
  });

  it('keep 过滤掉离场角色', () => {
    const chat = [floor('long black hair, red dress', '林晚晴'), floor('short hair, jeans', '郑小雨')];
    expect(buildAnchors(chat, 2, (name) => name === '林晚晴').map((entry) => entry.name)).toEqual(['林晚晴']);
  });

  it('只取目标楼层之前的记录', () => {
    const chat = [floor('a'), floor('b'), floor('c')];
    expect(buildAnchors(chat, 1)).toHaveLength(1);
  });

  it('刀这类道具不算外貌，正文不再提就丢掉', () => {
    const chat = [floor('long black hair, white dress, knife at neck', '林晚晴')];
    const withKnife = buildAnchors(chat, 1, () => true, '男人的刀架在她脖子上');
    expect(withKnife[0].props).toBe('knife at neck');
    expect(withKnife[0].appear).toBe('long black hair');
    const withoutKnife = buildAnchors(chat, 1, () => true, '第二天她回到教室');
    expect(withoutKnife[0].props).toBe('');
  });

  it('choker 是常驻饰品，裸 collar 与手铐只在本楼还提到时保留', () => {
    const chat = [floor('long hair, choker, black collar, handcuffs', '林晚晴')];
    const pressed = buildAnchors(chat, 1, () => true, '他用手把她按住')[0];
    expect(pressed.props).toBe('');
    expect(pressed.appear).toBe('long hair, choker');
    const bound = buildAnchors(chat, 1, () => true, '脖颈上的黑色项圈，手腕被手铐铐住')[0];
    expect(bound.props).toBe('black collar, handcuffs');
  });

  it('锚点按档案主名归并，别名不会变成第二个人的锚点', () => {
    const chat = [floor('long black hair, white dress', '晚晴'), floor('long black hair, red dress', '林晚晴')];
    const entries = [{ name: '林晚晴' }] as never;
    const anchors = buildAnchors(chat, 2, () => true, '', entries);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].costume).toBe('red dress');
  });
});

describe('anchorBlock', () => {
  it('已建档角色只给着装，未建档才给外貌', () => {
    const text = anchorBlock(
      [
        { name: '林晚晴', props: '', appear: 'long hair', costume: 'white dress', floor: 3 },
        { name: '郑小雨', props: '', appear: 'short hair', costume: 'jeans', floor: 3 },
      ],
      ['林晚晴'],
    );
    expect(text).toContain('【上镜锚点】');
    expect(text).toContain('林晚晴');
    expect(text).toContain('当前着装: white dress');
    expect(text).not.toContain('上镜外貌: long hair');
    expect(text).toContain('上镜外貌: short hair');
  });

  it('没有条目时返回空串', () => {
    expect(anchorBlock([], ['林晚晴'])).toBe('');
  });

  it('逐字复用与「正文优先」的口径写在区块里', () => {
    const text = anchorBlock([{ name: '林晚晴', appear: '', costume: 'jeans', props: '', floor: 1 }]);
    expect(text).toContain('逐字复用');
    expect(text).toContain('以正文为准');
  });
});
