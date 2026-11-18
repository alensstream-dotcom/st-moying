import { describe, expect, it } from 'vitest';
import { emptyCharFields, type CharTagEntry } from '@/state/charTags';
import { parseImageTagContent, serializeImageTag } from '@/st/imageTagRegex';
import { prepareTargetText } from './clean';
import { compileShotActions, draftKnownShot, independentShots, inventoryShots, verifiedShot } from './shotPlan';
import { parseImagePlan, type ImageInsertion, type ImagePlan } from './protocol';

const person = (name: string, sex: string): CharTagEntry =>
  ({ name, fields: { ...emptyCharFields(), sex }, raw: '', nl: '', desc: '', source: 'manual', history: [] });
const entries = [person('顾遥', '1girl'), person('乔明', '1boy')];
const empty: ImagePlan = { images: [], changes: [] };

function rank(text: string, plan = empty, min = 0) {
  return independentShots(inventoryShots(prepareTargetText(text, []).segments, plan, entries, [], text, min));
}

describe('grounded female-centered frame selection', () => {
  it('selects the three decisive moments even when the model authors only a quiet shot', () => {
    const text = '顾遥低头看了一会儿桌上的纸。玻璃杯从高架掉下来，顾遥用双手接住玻璃杯。乔明一手搂住顾遥的腰，俯身吻住她的嘴唇。顾遥张开双臂挡在乔明身前，护住他免受碎屑。顾遥整理袖口。';
    const segments = prepareTargetText(text, []).segments;
    const plan = parseImagePlan(JSON.stringify({
      candidates: [{ position: 'P1', evidence: segments[0].text, action: '读纸', visible: 3, value: 3, drawable: 3 }],
      images: [{ position: 'P1', after: segments[0].text, tag: '1girl, upper body', nl: 'She reads a page.', characters: [{ name: '顾遥', tag: '1girl' }] }],
    }), segments, 0, 3, text, true);
    expect(rank(text, plan).slice(0, 3).map((moment) => moment.segment.id)).toEqual(['P3', 'P2', 'P4']);
  });

  // 旧评分表只认九条日常动作，命中表项时还把模型自评分压到 8 分：亲吻 36 分压过插入 11 分，
  // 名额少时核心亲密必被挤掉。这条用例锁住「亲密强度参与排序」。
  it('ranks an explicit beat above a gentle table action', () => {
    const text = '乔明俯身吻住顾遥的嘴唇。乔明把顾遥按在床上，挺腰插进她的身体。';
    const moments = rank(text);
    expect(moments[0].segment.id).toBe('P2');
    expect(moments[0].actions).toContain('penetration');
    expect(moments[1].actions).toContain('kiss');
    expect(moments[0].score).toBeGreaterThan(moments[1].score);
  });

  it('rejects male-only shots, empty rooms and women mentioned solely in memories even with a positive minimum', () => {
    const text = '空大厅里只有一把椅子。乔明独自在机房打开柜子。他翻出顾遥的照片，想起她昨天站在窗边的样子。他低头看着她的照片。他盘算明天要不要去亲吻她。';
    const shots = rank(text, empty, 2);
    expect(shots).toEqual([]);
  });

  it('anchors a two-clause pose/action as one frame and keeps its two contacts after serialization', () => {
    const text = '乔明一手搂住顾遥的腰。紧接着两人接吻了。';
    const [moment, ...extras] = rank(text);
    expect(extras).toHaveLength(0);
    expect(moment.segment.id).toBe('P2');
    expect(moment.actions).toEqual(['kiss', 'waist']);
    const frame = draftKnownShot(moment)!;
    frame.tag = '1girl, solo, close-up, from front';
    frame.characters[0].tag = '1girl, black hair, navy coat, closed mouth';
    compileShotActions(frame, moment, true);
    const saved = parseImageTagContent(serializeImageTag(frame));
    expect(saved.tag).toContain('cowboy shot');
    expect(saved.tag).not.toContain('close-up');
    expect(saved.tag).not.toContain('solo');
    expect(saved.characters[0].tag).toContain('navy coat');
    expect(saved.characters[0].nl).toMatch(/kisses.*arm.*waist/);
    expect(saved.characters[1].tag).toContain('arm around waist');
    expect(saved.characters[1].nl).toMatch(/waist.*kissing/);
  });

  it('rejects a prompt that borrows another moment, even if its after quote is genuine', () => {
    const [moment] = rank('顾遥伸手接住掉下来的玻璃杯。');
    const frame: ImageInsertion = { ...draftKnownShot(moment)!, nl: 'She is kissing him.' };
    expect(verifiedShot(frame, moment)).toBe(false);
    const rebuilt = draftKnownShot(moment)!;
    compileShotActions(rebuilt, moment, false, false);
    const flat = parseImageTagContent(serializeImageTag(rebuilt));
    expect(flat.tag).toContain('catching');
    expect(flat.nl).toBe('');
  });

  it('keeps the pose and object together and widens the frame to show the knee and hand', () => {
    const source = '顾遥单膝跪在舞台边缘，伸手捡起红色皮球。';
    const [moment] = rank(source);
    const frame = draftKnownShot(moment)!;
    frame.characters[0].nl = 'She reaches down to pick up the ball.';
    compileShotActions(frame, moment, true);
    expect(frame.tag).toContain('full body');
    expect(frame.characters[0].nl).toMatch(/one knee.*pick up the red ball/);
  });

  it('keeps an ongoing pair when a compound action uses pronouns', () => {
    const [moment] = rank('顾遥和乔明在排练厅说着话。随后他一手搂住她的腰，俯身吻住她。');
    expect(moment.cast).toEqual(['乔明', '顾遥']);
    const frame = draftKnownShot(moment)!;
    compileShotActions(frame, moment, true);
    expect(frame.characters.find((c) => c.name === '乔明')?.nl).toMatch(/holds her waist.*kissing/);
  });

  it('carries the scene forward only as far as the next location and rejects a future location in the draft', () => {
    const text = '室内排练厅里，顾遥穿着深蓝外套，乔明正在调试一盏灯。顾遥双手接住掉下来的玻璃杯。乔明独自去了隔壁机房。顾遥走进浴室，敞开衬衫的领口。';
    const shots = rank(text);
    const first = draftKnownShot(shots.find((shot) => shot.segment.id === 'P2')!)!;
    first.tag = '1girl, cockpit, cowboy shot';
    compileShotActions(first, shots.find((shot) => shot.segment.id === 'P2')!, true);
    expect(first.tag).toContain('rehearsal hall');
    expect(first.tag).not.toContain('cockpit');
    const later = draftKnownShot(shots.find((shot) => shot.segment.id === 'P4')!)!;
    expect(later.tag).toContain('bathroom');
  });

  it('compiles an unrendered compound action from the original response without borrowing later action facts', () => {
    const source = '顾遥钻过横梁，同时扶紧栏杆。顾遥摸了摸墙上的油漆。';
    const segments = prepareTargetText(source, []).segments;
    const facts = [
      { subject: '顾遥', kind: 'action', confidence: 'explicit', evidence: '钻过横梁', value: 'ducking under the beam' },
      { subject: '顾遥', kind: 'action', confidence: 'explicit', evidence: '扶紧栏杆', value: 'gripping the railing' },
      { subject: '顾遥', kind: 'action', confidence: 'explicit', evidence: '摸了摸墙上的油漆', value: 'touching the paint' },
    ];
    const plan = parseImagePlan(JSON.stringify({ images: [], facts, candidates: [{ position: 'P1', evidence: segments[0].text,
      action: '钻过横梁同时扶紧栏杆', visible: 3, value: 3, novelty: 3, drawable: 3, unsure: 0 }] }), segments, 0, 3, source, true);
    const [moment] = rank(source, plan);
    const frame = draftKnownShot(moment, plan.facts)!;
    compileShotActions(frame, moment, true, true, plan.facts);
    expect(frame.characters[0].tag).toContain('ducking under the beam, gripping the railing');
    expect(frame.characters[0].nl).toContain('ducking under the beam while she is gripping the railing');
    expect(frame.characters[0].tag).not.toContain('paint');
  });
});
