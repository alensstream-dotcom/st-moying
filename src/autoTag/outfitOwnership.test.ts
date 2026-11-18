import { describe, expect, it } from 'vitest';
import { acceptClothingChanges, applyTextQualifiers, dropForeignWear, enforceClothing } from '@/autoTag/outfitTimeline';
import type { ClothingChange, ClothingState } from '@/autoTag/outfitTimeline';
import type { CharTagEntry } from '@/state/charTags';

function entry(name: string): CharTagEntry {
  return {
    name,
    fields: {
      fandom: '',
      sex: '1girl',
      age: '',
      hair: 'black hair',
      eyes: 'brown eyes',
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

function dressed(): ClothingState {
  const state: ClothingState = new Map();
  state.set('温岚', {
    name: '温岚',
    outfitId: 'outfit_probe',
    source: 'ai',
    pieces: [
      { id: 'top', design: 'white shirt', state: { location: 'worn' } },
      { id: 'bottom', design: 'blue jeans', state: { location: 'worn' } },
    ],
  } as never);
  return state;
}

function change(evidence: string, over: Partial<ClothingChange> = {}): ClothingChange {
  return {
    name: '温岚',
    reportedName: '温岚',
    position: 'P1',
    sourceLine: 0,
    charOffset: 0,
    operation: 'patch',
    evidence,
    pieces: [
      { id: 'top', design: 'white shirt', state: { location: 'removed' } },
      { id: 'bottom', design: 'blue jeans', state: { location: 'removed' } },
    ],
    ...over,
  } as ClothingChange;
}

/** 把证据句放进正文，charOffset 落在证据句末尾（事件在这句完成处生效）。 */
function withSource(evidence: string): { source: string; at: number } {
  const head = '李斌靠在门边，看着她。';
  return { source: `${head}${evidence}`, at: head.length + evidence.length };
}

const ENTRIES = [entry('温岚'), entry('李斌')];

describe('穿脱证据必须归属到本人', () => {
  it('句子里有「她」，但脱衣那一句的主语是他时，不认这条变化', () => {
    const head = '温岚坐在床边。';
    const evidence = '她抬眼看他，而他自己把肉棒上挂着的小姨子的内裤脱下';
    const source = `${head}${evidence}`;
    const out = acceptClothingChanges(
      [change(evidence, { charOffset: source.length })],
      source,
      dressed(),
      ENTRIES,
    );
    expect(out.changes).toHaveLength(0);
    expect(out.rejected.join('|')).toContain('没有落在该人物身上');
  });

  it('他是动作主语、她只是领属定语时，不认这条变化', () => {
    const evidence = '他伸手把她的内裤褪到脚踝';
    const { source, at } = withSource(evidence);
    const out = acceptClothingChanges([change(evidence, { charOffset: at })], source, dressed(), ENTRIES);
    expect(out.changes).toHaveLength(0);
  });

  it('她本人脱衣的动作照收', () => {
    const evidence = '温岚把内裤褪到脚踝，赤着脚踩在凉席上';
    const { source, at } = withSource(evidence);
    const out = acceptClothingChanges([change(evidence, { charOffset: at })], source, dressed(), ENTRIES);
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0].pieces.map((p) => p.state.location)).toEqual(['removed', 'removed']);
  });

  it('主体用代词但前一句点了她的名字，照收', () => {
    const evidence = '她脱下衬衫，随手扔在椅背上';
    const subject = '温岚低下头。';
    const { source, at } = withSource(`${subject}${evidence}`);
    const out = acceptClothingChanges(
      [
        change(evidence, {
          charOffset: at,
          subjectEvidence: subject,
        }),
      ],
      source,
      dressed(),
      ENTRIES,
    );
    expect(out.changes).toHaveLength(1);
  });
  it('别人戴的眼镜不能进她的 tag', () => {
    const text = '李斌推了推眼镜，看着温岚的侧脸。';
    expect(dropForeignWear('1girl, glasses, nightgown', text, ['温岚'])).toBe('1girl, nightgown');
  });

  it('眼镜确实挂在她的鼻梁上时保留', () => {
    const text = '温岚的眼镜滑到鼻尖，她抬手推了回去。';
    expect(dropForeignWear('1girl, glasses, nightgown', text, ['温岚'])).toBe('1girl, glasses, nightgown');
  });

  it('她自己摘眼镜的动作也算长在她身上', () => {
    const text = '她摘下眼镜，慢慢揉着眼角。';
    expect(dropForeignWear('1girl, glasses', text, ['温岚'])).toBe('1girl, glasses');
  });

  it('男主独有的胡子和眼镜在这段里没她的份', () => {
    const text = '他笑了笑，把烟按灭。';
    expect(dropForeignWear('1girl, glasses, mustache', text, ['温岚'])).toBe('1girl');
  });
});

describe('账本裸体残影不许跨楼传播', () => {
  it('正文写到其他人物时，不改动她已记录在账本里的穿脱状态', () => {
    // 实测第 7 节：李斌洗澡自慰（赤裸、精液），温岚只是上楼回家。
    // 旧账本把她记成 removed，于是这一楼她没有衣服可穿，出图全身裸。
    const state: ClothingState = new Map();
    state.set('温岚', {
      name: '温岚',
      outfitId: 'o1',
      source: 'ai',
      pieces: [{ id: 'nightgown', design: 'nightgown, short dress', state: { location: 'removed' } }],
    } as never);
    const target = {
      position: 'P3',
      sourceLine: 0,
      charOffset: 10,
      tag: '1girl, hallway',
      nl: '',
      characters: [{ name: '温岚', tag: '1girl, completely nude, naked, nipples, no bra, no panties', nl: '' }],
      size: 'portrait' as const,
    };
    const text = '而自己，赤裸的身体上还残留着精液，依旧保持着充血状态的肉棒。温岚上楼回家。';
    enforceClothing(target as never, state, true, false, [entry('温岚')], text);
    const tag = target.characters[0].tag;
    expect(tag).not.toMatch(/(?:^|, )nightgown(?:,|$)/);
    expect(state.get('温岚')?.pieces[0].state.location).toBe('removed');
  });
});

describe('「而自己」当主语的裸体句不许记到她账上', () => {
  it('evidence 用「自己」当主语时，subjectEvidence 点到她的名字也不能翻案', () => {
    const ev = '而自己，赤裸的身体上还残留着自己淫秽的精液，依旧还保持着充血状态的肉棒上挂着黏糊糊的小姨子的内裤和丝袜。';
    const sub = '李斌清楚的看到，小姨子温岚精致姣好的脸上满是愤怒与错愕。';
    const src = '“啊！！！～～”\n惊愕的尖叫声响起。\n' + sub + '\n' + ev + '\n这模样，简直猥琐至极！';
    const out = acceptClothingChanges([change(ev, { subjectEvidence: sub } as never)], src, dressed(), [entry('温岚')]);
    expect(out.changes.length).toBe(0);
    expect(out.rejected.length).toBe(1);
  });
});

describe('露点词要有正文撑腰', () => {
  const image = (tag: string): any => ({
    position: 'P1',
    tag,
    nl: '',
    characters: [{ name: '温岚', tag: '1girl, white blouse, breasts out', nl: '' }],
  });
  it('正文只写锁骨与衣领敞开时，breasts out 被摘掉', () => {
    const one = image('1girl, hallway, breasts out');
    applyTextQualifiers(one, '她领口微微敞开，露出锁骨和一小片雪白的肌肤。');
    expect(one.tag).not.toContain('breasts out');
    expect(one.characters[0].tag).not.toContain('breasts out');
  });
  it('正文写胸口时 cleavage 成立、breasts out 仍不成立', () => {
    const two = image('1girl, hallway, cleavage, breasts out');
    applyTextQualifiers(two, '她衣领敞得很开，乳沟若隐若现。');
    expect(two.tag).toContain('cleavage');
    expect(two.tag).not.toContain('breasts out');
    expect(two.characters[0].tag).not.toContain('breasts out');
  });
  it('正文真写到乳头才留 breasts out', () => {
    const three = image('1girl, hallway, breasts out');
    applyTextQualifiers(three, '她胸口大开，乳头都露在外面。');
    expect(three.characters[0].tag).toContain('breasts out');
  });
});

describe('nl 不复述 tag 里的服装', () => {
  const one = (nl: string): any => ({
    position: 'P1',
    tag: '1girl, hallway',
    nl: '',
    characters: [{ name: '温岚', tag: '1girl, white blouse, short sleeves, denim shorts', nl }],
  });
  it('She wears … 的从句被删掉，留下动作', () => {
    const img = one('She wears a damp white shirt, her hairstyle swaying in the breeze.');
    applyTextQualifiers(img, '她站在走廊里，头发被风吹起。');
    expect(img.characters[0].nl).not.toMatch(/shirt|denim/i);
  });
  it('整句只是服装就清空', () => {
    const img = one('She wears a white blouse and denim shorts.');
    applyTextQualifiers(img, '她站在走廊里。');
    expect(img.characters[0].nl).toBe('');
  });
  it('写衣领怎么被拉开的句子保留', () => {
    const img = one('Her collar is unbuttoned as she raises a hand to cover her chest.');
    applyTextQualifiers(img, '她抬手掩住衣领。');
    expect(img.characters[0].nl).toContain('raises a hand');
  });
});
