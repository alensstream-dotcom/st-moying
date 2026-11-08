import { beforeEach, expect, it, vi } from 'vitest';
import { galleryCharacterName, legacySettingsSeed, readCompatibleData } from './legacyCompatibility';

const mocks = vi.hoisted(() => ({ context: {} as any }));
vi.mock('@/st/context', () => ({ getContext: () => mocks.context }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
});

it('adopts the existing endpoint and channel from legacy baibai_image without modifying rollback data', async () => {
  const original = {
    nai: { url: 'https://nai.example.test', key: 'private-test-key' },
    assignments: { tagGen: 'channel-old' },
    channels: [{ id: 'channel-old', url: 'https://llm.example.test', key: 'test-key', model: 'test' }],
    autoTag: { autoGenerate: true },
  };
  const saved = JSON.stringify(original);
  mocks.context = { extensionSettings: { baibai_image: original }, saveSettingsDebounced: vi.fn() };
  const { hydrateSettings, settings } = await import('./settings');
  await hydrateSettings();
  expect(settings.nai.endpoints.some(e => e.key === 'private-test-key')).toBe(true);
  expect(settings.assignments.tagGen).toBe('channel-old');
  expect(settings.autoTag.autoGenerate).toBe(true);
  expect(mocks.context.extensionSettings.moying_image).toBeDefined();
  expect(JSON.stringify(original)).toBe(saved);
});

it('keeps an explicitly empty new store and never resurrects removed legacy entries', () => {
  const store = { moying_image: {}, baibai_image: { nai: { key: 'old' } } };
  expect(legacySettingsSeed(store)).toBe(store.moying_image);
  expect(readCompatibleData({ new: { entries: [] }, old: { entries: [1] } }, 'new', 'old')).toEqual({ entries: [] });
});

it('copies legacy character data independently for edits', () => {
  const old = { entries: [{ name: '霁月' }] };
  const adopted = readCompatibleData({ old }, 'new', 'old') as typeof old;
  adopted.entries[0].name = '更名';
  expect(old.entries[0].name).toBe('霁月');
});

it('recognizes both gallery namespaces without guessing unrelated directories', () => {
  expect(galleryCharacterName('墨影_霁月')).toBe('霁月');
  expect(galleryCharacterName('柏宝绘_霁月')).toBe('霁月');
  expect(galleryCharacterName('普通相册')).toBeNull();
});
