import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 人物骨相(同人/脸型/体型)召回原先默认关闭,存量用户几乎全存着 faces: false。
 *
 * 只把默认值改成 true 治不了存量:normalize 见到显式的 false 就照抄。
 * 所以升级判据是「没有 faceLimit」这个新字段:缺它 = 升级前的配置,强制开一次;
 * 用户之后在设置页手动关掉会同时写下 faceLimit,不会被反复顶回开。
 */
const mocks = vi.hoisted(() => ({
  context: null as Record<string, any> | null,
}));

vi.mock('@/st/context', () => ({
  getContext: () => mocks.context,
}));

async function hydrateWithLore(lore: Record<string, unknown>) {
  mocks.context = {
    extensionSettings: { moying_image: { autoTag: { lore } } },
    saveSettingsDebounced: vi.fn(),
  };
  const { hydrateSettings, settings } = await import('@/state/settings');
  await hydrateSettings();
  return settings.autoTag.lore;
}

describe('骨相召回的升级迁移', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('toastr', { info: vi.fn(), success: vi.fn(), error: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
  });

  it('旧配置存着 faces:false 也升级成开', async () => {
    const lore = await hydrateWithLore({ faces: false, wardrobeLimit: 6 });
    expect(lore.faces).toBe(true);
  });

  it('新配置(带 faceLimit)手动关掉保持关', async () => {
    const lore = await hydrateWithLore({ faces: false, faceLimit: 8 });
    expect(lore.faces).toBe(false);
  });

  it('新配置手动开着保持开', async () => {
    const lore = await hydrateWithLore({ faces: true, faceLimit: 4 });
    expect(lore.faces).toBe(true);
    expect(lore.faceLimit).toBe(4);
  });

  // hydrate 有 ready 守门,同一模块实例只灌一次,夹紧的两个方向要分开跑
  it('faceLimit 上界被夹到 10', async () => {
    const lore = await hydrateWithLore({ faceLimit: 99 });
    expect(lore.faceLimit).toBe(10);
  });

  it('faceLimit 下界被夹到 2', async () => {
    const lore = await hydrateWithLore({ faceLimit: 1 });
    expect(lore.faceLimit).toBe(2);
  });
});
