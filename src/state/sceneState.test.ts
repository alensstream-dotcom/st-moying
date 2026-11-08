import { describe, expect, it } from 'vitest';
import { emptyCharFields, makeCharTagFloorDelta } from './charTags';
import { applySceneEvents, legacyCharacter, parseSceneEvents, replayScene, resolveSceneCharacter, transcriptRevision, validateSceneEvents,
  type SceneEvent, type SceneState } from './sceneState';
import type { STMessage } from '@/st/context';

export const entry = (name = '小雪') => ({ name, fields: { ...emptyCharFields(), sex: '1girl', hair: 'long black hair', eyes: 'blue eyes', outfit: 'blue hanfu' },
  raw: '', nl: '', source: 'ai' as const, desc: '', history: [] });
const state = (): SceneState => ({ characters: [legacyCharacter(entry(), 'chat-a')], warnings: [] });
export const dressing: SceneEvent = { name: '小雪', kind: 'outfit', operation: 'change', sourceLine: 0, evidence: '小雪穿着青色外袍和白色内衫', garments: [
  { id: 'outer', design: 'blue hanfu, white trim', state: { location: 'on_body', fastening: 'closed', leftSleeve: 'on_arm', rightSleeve: 'on_arm' } },
  { id: 'inner', design: 'white shirt', state: { location: 'on_body', fastening: 'closed' } },
] };
export const patch = (change: Record<string, string>, sourceLine = 1): SceneEvent => ({ name: '小雪', kind: 'outfit', operation: 'patch', sourceLine,
  evidence: '小雪解开外袍系带', garments: [{ id: 'outer', design: 'modern jacket', state: change }] });
const message = (mes: string): STMessage => ({ name: 'narrator', is_user: false, is_system: false, mes, swipe_id: 0 });
function save(chat: STMessage[], floor: number, events: SceneEvent[]) {
  chat[floor].extra = { bbiCharChanges: makeCharTagFloorDelta([], chat[floor].swipe_id ?? 0, {
    v: 1, revision: transcriptRevision(chat, floor), events, rejected: [],
  }) };
}

describe('versioned character and outfit state', () => {
  it('blocks compilation across unloaded native-host history instead of silently resetting clothing', () => {
    const chat = [message('既有剧情'), null, message('当前剧情')] as unknown as STMessage[];
    expect(() => transcriptRevision(chat, 2)).not.toThrow();
    expect(() => replayScene([entry()], chat, 2, 'a')).toThrow('尚未载入');
  });
  it('accepts named identity quotes from provided cards/worldbooks but never static clothing resets', () => {
    const identity: SceneEvent = { name: '小雪', kind: 'identity', sourceLine: 0, evidence: '小雪是女子', evidenceSource: 'card', gender: 'female' };
    expect(validateSceneEvents([identity], '她继续交谈', { card: '小雪是女子' }).events).toHaveLength(1);
    expect(validateSceneEvents([identity], '她继续交谈', { card: '别人的设定' }).events).toHaveLength(0);
    expect(validateSceneEvents([{ ...dressing, evidenceSource: 'worldbook' }], '她继续交谈', { worldbook: dressing.evidence }).events).toHaveLength(0);
  });
  it('read-only migrates old visual records without treating 1girl as gender evidence', () => {
    const original = entry(), before = JSON.stringify(original), c = legacyCharacter(original, 'a');
    expect(c.identity.gender).toBe('unknown');
    expect(c.isHeroine).toBe(false);
    expect(c.outfit?.provenance).toBe('legacy_unparsed_design');
    expect(JSON.stringify(original)).toBe(before);
    expect(legacyCharacter(original, 'a').characterId).toBe(c.characterId);
    expect(legacyCharacter(original, 'b').characterId).not.toBe(c.characterId);
  });
  it('keeps the entire outfit and instance through ten messages without clothing events', () => {
    const chat = [message(dressing.evidence), ...Array.from({ length: 10 }, () => message('她继续交谈。'))];
    save(chat, 0, [dressing]);
    const initial = replayScene([entry()], chat, 0, 'a').characters[0].outfit;
    expect(replayScene([entry()], chat, 10, 'a').characters[0].outfit).toEqual(initial);
  });
  it('only patches fastening, preserving design, sleeves, inner clothing and instance ID', () => {
    const before = applySceneEvents(state(), [dressing], 'a', 'v1', 0);
    const after = applySceneEvents(before, [patch({ fastening: 'open' })], 'a', 'v2', 1);
    const expected = JSON.parse(JSON.stringify(before.characters[0].outfit));
    expected.garments[0].state.fastening = 'open';
    expect(after.characters[0].outfit).toEqual(expected);
    expect(before.characters[0].outfit?.garments[0].state.fastening).toBe('closed');
  });
  it('a face closeup and omitted events cannot reset unseen clothing', () => {
    const initial = applySceneEvents(state(), [dressing, patch({ location: 'on_chair', fastening: 'open' })], 'a', 'v1', 0);
    expect(applySceneEvents(initial, [], 'a', 'v2', 1)).toEqual(initial);
  });
  it('separates temporal appearance from base design', () => {
    const after = applySceneEvents(state(), [{ name: '小雪', kind: 'appearance', sourceLine: 1, evidence: '小雪染红了头发', appearance: { hair: 'red hair' } }], 'a', 'v', 0);
    expect(after.characters[0].baseAppearance.hair).toBe('long black hair');
    expect(after.characters[0].currentAppearance.hair).toBe('red hair');
  });
  it('keeps unknown garments unchanged instead of guessing an outfit reset', () => {
    const before = state(), after = applySceneEvents(before, [patch({ fastening: 'open' })], 'a', 'v', 0);
    expect(after.characters[0].outfit).toEqual(before.characters[0].outfit);
    expect(after.warnings).toContain('小雪: unknown garment outer, state retained');
  });
  it('uses the paragraph time slice, including old-floor requests', () => {
    const chat = [message(`${dressing.evidence}\n${patch({}).evidence}`), message('后文')];
    save(chat, 0, [dressing, patch({ fastening: 'open' })]);
    expect(replayScene([entry()], chat, 0, 'a', 0).characters[0].outfit?.garments[0].state.fastening).toBe('closed');
    expect(replayScene([entry()], chat, 0, 'a', 1).characters[0].outfit?.garments[0].state.fastening).toBe('open');
  });
  it('isolates abandoned swipes and invalidates downstream events after an earlier edit', () => {
    const chat = [message(dressing.evidence), message(patch({}).evidence)];
    save(chat, 0, [dressing]); save(chat, 1, [patch({ fastening: 'open' })]);
    chat[0].swipe_id = 1;
    expect(replayScene([entry()], chat, 1, 'a').characters[0].outfit?.garments).toEqual([]);
    chat[0].swipe_id = 0; chat[0].mes = '修改旧消息';
    const result = replayScene([entry()], chat, 1, 'a');
    expect(result.characters[0].outfit?.garments).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });
  it('ignores tag insertions but detects upstream semantic reanalysis in its version', () => {
    const chat = [message(dressing.evidence), message('下文')];
    save(chat, 0, [dressing]);
    const old = transcriptRevision(chat, 1);
    chat[1].mes += '\n\n<bbi_image><tag>x</tag></bbi_image>';
    expect(transcriptRevision(chat, 1)).toBe(old);
    save(chat, 0, []);
    expect(transcriptRevision(chat, 1)).not.toBe(old);
  });
  it('rejects fabricated/future quotes and clothing events without clothing evidence', () => {
    expect(validateSceneEvents([dressing], '她微笑')).toEqual({ events: [], rejected: ['小雪: evidence missing at position'] });
    expect(validateSceneEvents([{ ...dressing, evidence: '她微笑' }], '她微笑').events).toEqual([]);
    expect(validateSceneEvents([{ ...dressing, sourceLine: 0 }], `她微笑\n${dressing.evidence}`).events).toEqual([]);
  });
  it('long-haired handsome men do not enter the heroine view even when AI reports female', () => {
    const event: SceneEvent = { name: '青云', kind: 'identity', gender: 'female', isHeroine: true, evidence: '青云是长发俊美男子', sourceLine: 0 };
    const wrong = applySceneEvents({ characters: [], warnings: [] }, [event], 'a', 'v', 0);
    expect(wrong.characters[0].identity.gender).toBe('unknown');
    expect(wrong.characters[0].isHeroine).toBe(false);
    const correct = applySceneEvents(wrong, [{ ...event, gender: 'male' }], 'a', 'v', 0);
    expect(correct.characters[0].identity.gender).toBe('male');
    expect(correct.characters[0].isHeroine).toBe(false);
  });
  it('does not infer female from beauty, dressing, dreams or transformations', () => {
    for (const evidence of ['她长发秀美，身穿女装', '梦境中青云变成女子', '假设青云是女子', '青云女扮男装']) {
      const result = applySceneEvents({ characters: [], warnings: [] }, [{ name: '青云', kind: 'identity', gender: 'female', isHeroine: true, evidence, sourceLine: 0 }], 'a', 'v', 0);
      expect(result.characters[0].identity.gender).toBe('unknown');
      expect(result.characters[0].isHeroine).toBe(false);
    }
  });
  it('preserves confirmed manual identities and reports conflicts', () => {
    const original = legacyCharacter({ ...entry(), source: 'manual', fields: { ...entry().fields, sex: '1boy' } }, 'a');
    const result = applySceneEvents({ characters: [original], warnings: [] }, [{ name: '小雪', kind: 'identity', gender: 'female', isHeroine: true, evidence: '小雪是女子', sourceLine: 0 }], 'a', 'v', 0);
    expect(result.characters[0].identity.gender).toBe('male');
    expect(result.characters[0].identity.conflict).toBe('小雪是女子');
    expect(result.characters[0].isHeroine).toBe(false);
  });
  it('isolates same-name characters by work and resolves explicit Chinese/English/traditional aliases', () => {
    const result = applySceneEvents({ characters: [], warnings: [] }, ['作品A', '作品B'].map(work => ({ name: '小雪', work, kind: 'identity', gender: 'female', sourceLine: 0, evidence: '小雪又名Xiao Xue、小雪兒，是女子', aliases: work === '作品A' ? ['Xiao Xue', '小雪兒'] : [] })), 'a', 'v', 0);
    expect(result.characters[0].characterId).not.toBe(result.characters[1].characterId);
    expect(resolveSceneCharacter(result, '小雪')).toBeUndefined();
    expect(resolveSceneCharacter(result, 'Xiao Xue')?.characterId).toBe(result.characters[0].characterId);
    expect(resolveSceneCharacter(result, '小雪兒')?.characterId).toBe(result.characters[0].characterId);
    expect(resolveSceneCharacter(result, '小雪', '作品B')?.characterId).toBe(result.characters[1].characterId);
  });
  it('validates enums and removes unrecognised state fields at the protocol boundary', () => {
    const parsed = parseSceneEvents([{ name: '小雪', kind: 'outfit', position: 'P1', evidence: dressing.evidence, operation: 'patch', garments: [
      { id: 'outer', state: { location: 'both_body_and_chair', fastening: 'open', sex: 'female' } },
    ] }], new Map([['P1', 0]]));
    expect(parsed[0].garments?.[0].state).toEqual({ fastening: 'open' });
  });
});
