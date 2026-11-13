import { describe, expect, it } from 'vitest';
import { actionSignature, buildShotLedger, shotLedgerBlock } from './shotLedger';
import { hasFemaleSignal } from './femaleSignal';
import { bandFromName, bodyPool, diversifyLook } from './lookDiversity';
import { emptyCharFields, type CharTagEntry, type CharTagField } from '@/state/charTags';
import type { STMessage } from '@/st/context';

type CharFields = Record<CharTagField, string>;

function entry(name: string, fields: Partial<CharTagEntry['fields']> = {}): CharTagEntry {
  return {
    name,
    fields: { hair: '', eyes: '', skin: '', body: '', extra: '', outfit: '', ...fields } as CharTagEntry['fields'],
    raw: '',
    nl: '',
    source: 'manual',
    desc: '',
    history: [],
  };
}

function look(parts: Partial<Record<'hair' | 'eyes' | 'body' | 'extra' | 'age', string>>): CharFields {
  return {
    ...emptyCharFields(),
    hair: parts.hair ?? '',
    eyes: parts.eyes ?? '',
    body: parts.body ?? '',
    extra: parts.extra ?? '',
    age: parts.age ?? '',
  };
}

describe('年龄档决定可选体型', () => {
  it('认得出「阿姨」这类称谓本身就是年龄证据', () => {
    expect(bandFromName('风阿姨')).toBe('mature female');
    expect(bandFromName('林太太')).toBe('mature female');
    expect(bandFromName('小师妹')).toBe('');
    expect(bandFromName('苏晚')).toBe('');
  });

  it('熟女的体型池里没有娇小,儿童的池里没有丰腴', () => {
    expect(bodyPool('mature female')).not.toContain('petite');
    expect(bodyPool('mature female')).toContain('voluptuous');
    expect(bodyPool('child')).not.toContain('voluptuous');
    expect(bodyPool('')).not.toContain('petite');
  });

  it('档案没写 body 时,熟女不会被塞一个娇小身材', () => {
    const result = diversifyLook(look({ age: 'mature female' }), [entry('甲', { body: 'petite' })], '', '风阿姨');
    expect(result.fields.body).not.toBe('petite');
    expect(result.fields.body.length).toBeGreaterThan(0);
  });

  it('已经写了娇小但年龄档是熟女时,换掉并记一条说明', () => {
    const result = diversifyLook(look({ age: 'mature female', body: 'petite' }), [], '', '风阿姨');
    expect(result.fields.body).not.toBe('petite');
    expect(result.notes.join('')).toContain('体型与年龄档');
  });

  it('正文明确写了娇小就以正文为准,不换', () => {
    const result = diversifyLook(
      look({ age: 'mature female', body: 'petite' }),
      [],
      '她个子娇小，只到他的胸口。',
      '风阿姨',
    );
    expect(result.fields.body).toBe('petite');
  });
});

describe('空楼跳过判据', () => {
  it('有「她」就算有女性线索', () => {
    expect(hasFemaleSignal('他点了根烟。')).toBe(false);
    expect(hasFemaleSignal('他点了根烟，她站在窗边。')).toBe(true);
  });

  it('情欲描写即使绕开代词也照常分析', () => {
    expect(hasFemaleSignal('两人交合，喘息声压得很低。')).toBe(true);
  });

  it('已建档女性用简称出现时也认得', () => {
    const names = ['林晚晴'];
    expect(hasFemaleSignal('晚晴推门进来。', names, [entry('林晚晴')])).toBe(true);
  });

  it('纯男性楼层判为可跳过', () => {
    expect(hasFemaleSignal('两人对饮，谈了些生意上的事。', ['林晚晴'], [entry('林晚晴')])).toBe(false);
  });
});

describe('已出过的画面账本', () => {
  function message(frames: Array<{ tag: string; sourceLine: number }>): STMessage {
    return { mes: '她被他压在墙上。\n她跪了下来。', extra: { bbiOutfitState: { frames } } } as unknown as STMessage;
  }

  it('动作签名只留接触词组,不把外貌与质量词带进去', () => {
    const signature = actionSignature(
      '1girl, long black hair, blue eyes, white shirt, hand on breast, best quality, looking at viewer',
    );
    expect(signature).toContain('hand on breast');
    expect(signature).not.toContain('long black hair');
    expect(signature).not.toContain('white shirt');
    expect(signature).not.toContain('best quality');
  });

  it('从 frames 里抽出取景与动作,渲染成【已出过的画面】', () => {
    const chat = [
      message([]),
      message([{ tag: '<bbi_image>1girl, hand on breast, upper body, from side</bbi_image>', sourceLine: 0 }]),
    ];
    const ledger = buildShotLedger(chat, 2, (floor) => chat[floor]?.mes ?? '');
    expect(ledger).toHaveLength(1);
    expect(ledger[0].action).toContain('hand on breast');
    const block = shotLedgerBlock(ledger);
    expect(block).toContain('【已出过的画面】');
    expect(block).toContain('第 1 楼');
    expect(block).toContain('她被他压在墙上');
  });

  it('没有历史时不渲染空块', () => {
    expect(shotLedgerBlock([])).toBe('');
    expect(buildShotLedger([], 0)).toEqual([]);
  });
});
