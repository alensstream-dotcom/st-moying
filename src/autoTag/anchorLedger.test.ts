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
});

describe('anchorBlock', () => {
  it('已建档角色只给着装，未建档才给外貌', () => {
    const text = anchorBlock(
      [
        { name: '林晚晴', appear: 'long hair', costume: 'white dress', floor: 3 },
        { name: '郑小雨', appear: 'short hair', costume: 'jeans', floor: 3 },
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
    const text = anchorBlock([{ name: '林晚晴', appear: '', costume: 'jeans', floor: 1 }]);
    expect(text).toContain('逐字复用');
    expect(text).toContain('以正文为准');
  });
});
