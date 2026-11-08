import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { STContext } from '@/st/context';
const mocks = vi.hoisted(() => ({ ctx: null as STContext | null, scene: vi.fn() }));
vi.mock('@/st/context', async original => ({ ...await original<typeof import('@/st/context')>(), getContext: () => mocks.ctx }));
vi.mock('@/state/sceneStore', () => ({ sceneAt: mocks.scene }));
import { getScene } from './api';
beforeEach(() => {
  mocks.ctx = { chat: [{ mes: '测试' }], getCurrentChatId: () => 'test-chat' } as unknown as STContext;
  mocks.scene.mockReset().mockReturnValue({ characters: [{ characterId: 'c1', name: '青云', work: '', aliases: ['青云'], identity: { gender: 'male', confirmed: true, evidence: '青云是男子', apiKey: 'SECRET' }, isHeroine: false,
    baseAppearance: { hair: 'black hair', apiKey: 'SECRET' }, currentAppearance: {},
    outfit: { outfitInstanceId: 'o1', design: 'robe', provenance: 'test', token: 'SECRET', garments: [{ id: 'outer', design: 'robe', state: { location: 'on_chair', apiKey: 'SECRET' } }] },
    visualBindings: [{ materialId: 'm1', version: 2, scope: 'outfit', materialSeed: 5, effectivePosition: { floor: 0, line: 0 }, reason: 'test', resolved: { key: 'SECRET', previewPath: '/private.png' } }],
  }], warnings: [] });
});
describe('authoritative public scene reads', () => {
  it('exposes identity and clothing without exporting private resolved material data', () => {
    const result = getScene();
    expect(result.characters[0].identity.gender).toBe('male');
    expect(result.characters[0].outfit?.garments[0].state.location).toBe('on_chair');
    expect(JSON.stringify(result)).not.toContain('SECRET'); expect(JSON.stringify(result)).not.toContain('/private.png');
  });
  it('returns a deep copy and passes the inclusive floor/line to the real state reader', () => {
    const result = getScene({ floor: 0, sourceLine: 2 }); result.characters[0].aliases.push('changed');
    expect(getScene().characters[0].aliases).toEqual(['青云']);
    expect(mocks.scene.mock.calls[0]).toEqual([0, 2]);
  });
  it('rejects invalid positions and normalizes native unloaded-history failures', () => {
    expect(() => getScene({ floor: 1 })).toThrow('范围');
    expect(() => getScene({ sourceLine: -1 })).toThrow('非负');
    mocks.scene.mockImplementation(() => { throw new Error('尚未载入历史'); });
    try { getScene(); } catch (e) { expect((e as {code:string}).code).toBe('backend_error'); }
  });
});
