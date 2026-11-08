import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { STContext, STMessage } from '@/st/context';

const mocks = vi.hoisted(() => ({ ctx: null as STContext | null, complete: vi.fn() }));
vi.mock('@/st/context', async importOriginal => ({ ...await importOriginal<typeof import('@/st/context')>(), getContext: () => mocks.ctx }));
vi.mock('@/api/client', () => ({ requestViaMainApi: mocks.complete, requestCompletion: mocks.complete }));
vi.mock('@/autoTag/bookMemory', () => ({ readBookMemory: () => null }));
vi.mock('@/autoTag/prompt', () => ({ autoTagProfile: () => ({ naiCharPrompts: true, nl: true, lockedSize: null }), buildAutoTagMessages: async () => [] }));

import { requestFloorTags, requestSlotTag } from './runner';
import { emptyCharFields, hydrateCharTags, readCharTagFloorDelta, upsertCharTag } from '@/state/charTags';
import { sceneAt, confirmIdentity, undoIdentityConfirmation, bindMaterialToCharacter, undoManualVisualEvent } from '@/state/sceneStore';
import { BUILTIN_VISUAL_MATERIALS, cloneVisual } from '@/state/visualDesign';
import { hydrateVisualLibrary, saveMaterial } from '@/state/visualLibrary';
import { recompileFloorVisuals } from './visualActions';
import { parseImageTagContent, parseImageTags } from '@/st/imageTagRegex';
import { buildNaiParameters } from '@/backends/nai';
import { settings } from '@/state/settings';

const message = (mes: string): STMessage => ({ name: 'narrator', mes, is_user: false, is_system: false });
const newCharacter = { name: '小雪', field: 'new', fields: { hair: 'long black hair', eyes: 'blue eyes', outfit: 'blue hanfu', sex: '1girl' }, nl: 'black-haired', reason: '首次视觉设计' };
const image = (position = 'P1') => ({ position, tag: '1girl, forest, blonde hair, blue hanfu', characters: [{ name: '小雪', tag: '1girl, blonde hair, blue hanfu, smile', nl: 'wearing blue hanfu' }] });
const wear = { name: '小雪', kind: 'outfit', operation: 'change', position: 'P1', evidence: '小雪穿着青色外袍和白色内衫。', garments: [
  { id: 'outer', design: 'blue hanfu', state: { location: 'on_body', fastening: 'closed' } },
  { id: 'inner', design: 'white shirt', state: { location: 'on_body' } },
] };
let response: Record<string, unknown>;

beforeEach(() => {
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('toastr', { warning: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() });
  mocks.ctx = {
    chat: [], chatMetadata: {}, extensionSettings: {}, name1: 'User', name2: 'Narrator', getCurrentChatId: () => 'chat-a',
    getRequestHeaders: () => ({}), saveMetadataDebounced: vi.fn(), saveChat: vi.fn(async () => {}),
    eventSource: { on: vi.fn(), emit: vi.fn(async () => {}) }, eventTypes: { MESSAGE_EDITED: 'edited', MESSAGE_UPDATED: 'updated' },
  } as unknown as STContext;
  hydrateCharTags();
  hydrateVisualLibrary();
  settings.autoTag.minImages = 0; settings.autoTag.maxImages = 4; settings.autoTag.retryCount = 0; settings.autoTag.autoGenerate = false;
  response = { images: [image()], changes: [newCharacter], sceneEvents: [wear,
    { name: '小雪', kind: 'identity', gender: 'female', isHeroine: true, position: 'P1', evidence: '小雪是女子。' }] };
  mocks.complete.mockReset().mockImplementation(async (_messages, opts) => {
    const raw = JSON.stringify(response); opts?.validate?.(raw); return raw;
  });
});

describe('actual runner persistence and compiled requests', () => {
  it('applies a versioned clothing binding at the selected paragraph, preserves state and can undo', async () => {
    const ctx = mocks.ctx!;
    ctx.chat.push(message('小雪是女子。小雪穿着青色外袍和白色内衫。\n小雪解开外袍系带。'));
    response.images = [image('P1'), image('P3')];
    (response.sceneEvents as unknown[]).push({ name: '小雪', kind: 'outfit', operation: 'patch', position: 'P3', evidence: '小雪解开外袍系带。', garments: [{ id: 'outer', state: { fastening: 'open' } }] });
    await requestFloorTags(0);
    const character = sceneAt(0).characters[0];
    const material = cloneVisual(BUILTIN_VISUAL_MATERIALS[0]); material.garments[0].design = 'black robe';
    bindMaterialToCharacter(character, material, 'outfit', 'preserve', 0, 1, 10);
    material.version = 20; material.garments[0].design = 'modern jacket';
    await recompileFloorVisuals(0);
    const tags = parseImageTags(ctx.chat[0].mes).map(parseImageTagContent);
    expect(tags[0].characters[0].tag).toContain('blue hanfu');
    expect(tags[1].characters[0].tag).toContain('black robe');
    expect(tags[1].characters[0].tag).toContain('open clothes');
    expect(tags[1].characters[0].tag).not.toContain('modern jacket');
    expect(sceneAt(0).characters[0].baseAppearance).toEqual(character.baseAppearance);
    undoManualVisualEvent();
    expect(sceneAt(0).characters[0].outfit?.design).toBe(character.outfit?.design);
  });
  it('persists ancient first-outfit bindings and respects explicit modern exceptions', async () => {
    const ctx = mocks.ctx!;
    ctx.characters = [{ name: '修仙卡', avatar: 'test', description: '仙侠宗门修仙世界' }]; ctx.characterId = 0;
    ctx.chat.push(message('小雪是女子，正在庭院交谈。'));
    response.sceneEvents = [];
    await requestFloorTags(0);
    const first = sceneAt(0).characters[0];
    expect(first.outfit?.design).toContain('hanfu'); expect(first.visualBindings?.[0].scope).toBe('outfit');
    saveMaterial({ ...first.visualBindings![0].resolved, garments: [{ id: 'outer', design: 'new changed template' }] });
    await requestFloorTags(0, { replace: true });
    expect(sceneAt(0).characters[0].visualBindings?.[0].version).toBe(1);
    expect(sceneAt(0).characters[0].outfit?.design).not.toContain('new changed template');
    ctx.chat.push(message('小雪换上现代外套。'));
    response = { images: [image()], changes: [], sceneEvents: [{ ...wear, evidence: '小雪换上现代外套。', garments: [{ id: 'outer', design: 'modern jacket', state: { location: 'on_body' } }] }] };
    await requestFloorTags(1);
    expect(sceneAt(1).characters[0].outfit?.design).toBe('modern jacket');
    expect(sceneAt(0).characters[0].outfit?.outfitInstanceId).toBe(first.outfit?.outfitInstanceId);
  });
  it('blocks feminine drawing tags from changing a known male or putting him in the heroine view', async () => {
    const ctx = mocks.ctx!;
    ctx.chat.push(message('小雪是长发俊美男子。'));
    response.sceneEvents = [{ name: '小雪', kind: 'identity', position: 'P1', evidence: '小雪是长发俊美男子。', gender: 'male', isHeroine: true }];
    await requestFloorTags(0);
    const state = sceneAt(0);
    expect(state.characters[0].identity.gender).toBe('male');
    expect(state.characters[0].isHeroine).toBe(false);
    const content = parseImageTagContent(parseImageTags(ctx.chat[0].mes)[0]);
    const params = buildNaiParameters({ ...settings.nai, model: 'nai-diffusion-4-5-full' }, { prompt: content.tag, characters: content.characters, seed: 1 });
    expect(JSON.stringify(params.v4_prompt)).not.toContain('1girl');
    expect(JSON.stringify(params.v4_prompt)).toContain('1boy');
    expect((readCharTagFloorDelta(ctx.chat[0])!.ops[0] as { fields: { sex: string } }).fields.sex).toBe('1boy');
  });
  it('preserves initial appearance when analysing the same floor again', async () => {
    const ctx = mocks.ctx!;
    ctx.chat.push(message('小雪是女子。小雪穿着青色外袍和白色内衫。'));
    await requestFloorTags(0);
    response.changes = [{ ...newCharacter, fields: { ...newCharacter.fields, hair: 'silver hair' } }];
    await requestFloorTags(0, { replace: true });
    expect(sceneAt(0).characters[0].baseAppearance.hair).toBe('long black hair');
  });
  it('keeps immutable IDs and existing identity corrections across a manual rename', () => {
    const ctx = mocks.ctx!;
    const fields = { ...emptyCharFields(), sex: '1girl', hair: 'black hair', eyes: 'blue eyes' };
    const original = { name: '小雪', fields, raw: '', nl: '', source: 'manual' as const, desc: '', history: [] };
    upsertCharTag(original);
    const id = sceneAt(-1).characters[0].characterId;
    confirmIdentity(sceneAt(-1).characters[0], 'male', false);
    upsertCharTag({ ...original, name: '雪儿' }, '小雪');
    const updated = sceneAt(-1).characters[0];
    expect(updated.characterId).toBe(id);
    expect(updated.aliases).toContain('小雪');
    expect(updated.identity.gender).toBe('male');
  });
  it('persists state with the narrative and inherits clothing across later floors into real NAI parameters', async () => {
    const ctx = mocks.ctx!;
    ctx.chat.push(message('小雪是女子。小雪穿着青色外袍和白色内衫。'));
    await requestFloorTags(0);
    const first = readCharTagFloorDelta(ctx.chat[0]);
    expect(first?.scene?.events).toHaveLength(2);
    const initial = sceneAt(0).characters[0].outfit;
    ctx.chat.push(message('小雪把外袍放在椅上。'));
    response = { images: [image()], changes: [{ name: '小雪', field: 'outfit', value: 'modern jacket', position: 'P1', reason: 'guess' }], sceneEvents: [
      { name: '小雪', kind: 'outfit', operation: 'patch', position: 'P1', evidence: '小雪把外袍放在椅上。', garments: [{ id: 'outer', state: { location: 'on_chair' } }] },
    ] };
    await requestFloorTags(1);
    expect(sceneAt(1).characters[0].outfit?.outfitInstanceId).toBe(initial?.outfitInstanceId);
    expect(sceneAt(1).characters[0].outfit?.garments[0].state.location).toBe('on_chair');
    expect(readCharTagFloorDelta(ctx.chat[1])?.ops).toEqual([]);
    for (let i = 0; i < 10; i++) {
      ctx.chat.push(message('小雪继续交谈。'));
      response = { images: [image()], changes: [], sceneEvents: [] };
      await requestFloorTags(ctx.chat.length - 1);
    }
    expect(sceneAt(11).characters[0].outfit).toEqual(sceneAt(1).characters[0].outfit);
    const content = parseImageTagContent(parseImageTags(ctx.chat[11].mes)[0]);
    const params = buildNaiParameters({ ...settings.nai, model: 'nai-diffusion-4-5-full' }, { prompt: content.tag, nl: content.nl, characters: content.characters, seed: 123 });
    expect(JSON.stringify(params.v4_prompt)).toContain('white shirt');
    expect(JSON.stringify(params.v4_prompt)).not.toContain('blonde');
    expect(content.characters[0].tag).not.toContain('blue hanfu');
    expect(content.characters[0].nl).toContain('on chair, not worn');
    expect(sceneAt(0).characters[0].outfit?.garments[0].state.location).toBe('on_body');
  });
  it('compiles before/after paragraph frames in narrative order and preserves the target frame on slot rewrite', async () => {
    const ctx = mocks.ctx!;
    ctx.chat.push(message('小雪是女子。小雪穿着青色外袍和白色内衫。\n小雪解开外袍系带。'));
    response.images = [image('P3'), image('P1')];
    (response.sceneEvents as unknown[]).push({ name: '小雪', kind: 'outfit', operation: 'patch', position: 'P3', evidence: '小雪解开外袍系带。', garments: [{ id: 'outer', state: { fastening: 'open' } }] });
    await requestFloorTags(0);
    const tags = parseImageTags(ctx.chat[0].mes).map(parseImageTagContent);
    expect(tags[0].characters[0].tag).not.toContain('open clothes');
    expect(tags[1].characters[0].tag).toContain('open clothes');
    const prior = JSON.stringify(readCharTagFloorDelta(ctx.chat[0]));
    response = { images: [image('P3')], sceneEvents: [], changes: [] };
    await requestSlotTag(0, 0);
    expect(parseImageTagContent(parseImageTags(ctx.chat[0].mes)[0]).characters[0].tag).not.toContain('open clothes');
    expect(JSON.stringify(readCharTagFloorDelta(ctx.chat[0]))).toBe(prior);
  });
  it('rejects a late parser response after an earlier message edit', async () => {
    const ctx = mocks.ctx!;
    ctx.chat.push(message('上一楼'), message('小雪是女子。小雪穿着青色外袍和白色内衫。'));
    mocks.complete.mockImplementationOnce(async (_messages, opts) => {
      opts.validate(JSON.stringify(response));
      ctx.chat[0].mes = '上游已被编辑';
      return JSON.stringify(response);
    });
    await requestFloorTags(1);
    expect(ctx.chat[1].extra?.bbiCharChanges).toBeUndefined();
    expect(parseImageTags(ctx.chat[1].mes)).toEqual([]);
  });
  it('rolls back narrative and state together if persistence fails', async () => {
    const ctx = mocks.ctx!, original = '小雪是女子。小雪穿着青色外袍和白色内衫。';
    ctx.chat.push(message(original));
    ctx.saveChat = vi.fn().mockRejectedValue(new Error('disk failure'));
    await requestFloorTags(0);
    expect(ctx.chat[0].mes).toBe(original);
    expect(ctx.chat[0].extra).toBeUndefined();
  });
  it('offers non-destructive manual gender correction and undo, and blocks in-flight overwrites', async () => {
    const ctx = mocks.ctx!;
    ctx.chat.push(message('小雪是女子。小雪穿着青色外袍和白色内衫。'));
    await requestFloorTags(0);
    const original = ctx.chat[0].mes;
    confirmIdentity(sceneAt(0).characters[0], 'male', false);
    expect(sceneAt(0).characters[0].identity.gender).toBe('male');
    expect(sceneAt(0).characters[0].isHeroine).toBe(false);
    undoIdentityConfirmation();
    expect(sceneAt(0).characters[0].identity.gender).toBe('female');
    ctx.chat.push(message('小雪继续交谈。'));
    response = { images: [image()], changes: [], sceneEvents: [] };
    mocks.complete.mockImplementationOnce(async (_messages, opts) => {
      opts.validate(JSON.stringify(response));
      confirmIdentity(sceneAt(0).characters[0], 'male', false);
      return JSON.stringify(response);
    });
    await requestFloorTags(1);
    expect(ctx.chat[1].extra).toBeUndefined();
    expect(ctx.chat[0].mes).toBe(original);
  });
});
