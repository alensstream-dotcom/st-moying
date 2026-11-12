import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 回归：「默认参数」里新建的生图配置预设，退出重进后不能丢。
 *
 * 旧实现 applyInto 是逐字段手抄的，genPresets / activeGenPreset / promptPresetLinks
 * 三个字段没进拷贝清单：hydrate 时内存里仍是 defaults()，于是界面上只剩内置几套；
 * 之后任何一次设置变动还会把这份默认值 persist 回 extensionSettings，把用户数据真正抹掉。
 */
const mocks = vi.hoisted(() => ({
  context: null as Record<string, any> | null,
}));

vi.mock('@/st/context', () => ({
  getContext: () => mocks.context,
}));

const customPreset = {
  id: 'gp-custom',
  name: '我的 4.5',
  forLore: false,
  promptKeys: [],
  backend: 'nai',
  model: 'nai-diffusion-4-5-full',
  undesiredContent: 'lowres',
  sampler: 'k_euler_ancestral',
  steps: 30,
  scale: 6,
  cfgRescale: 0.3,
  noiseSchedule: 'karras',
  varietyBoost: true,
  naturalLanguage: true,
};

async function hydrateWith(stored: Record<string, unknown>) {
  mocks.context = {
    extensionSettings: { moying_image: stored },
    saveSettingsDebounced: vi.fn(),
  };
  const mod = await import('@/state/settings');
  await mod.hydrateSettings();
  return mod.settings;
}

describe('生图配置预设的持久化', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('toastr', { info: vi.fn(), success: vi.fn(), error: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
  });

  it('hydrate 后保留用户新建的预设', async () => {
    const settings = await hydrateWith({ genPresets: [customPreset], activeGenPreset: 'gp-custom' });
    expect(settings.genPresets.map(preset => preset.id)).toContain('gp-custom');
    expect(settings.genPresets.find(preset => preset.id === 'gp-custom')?.name).toBe('我的 4.5');
    expect(settings.activeGenPreset).toBe('gp-custom');
  });

  it('保存的参数值原样回到内存,不被内置默认值覆盖', async () => {
    const settings = await hydrateWith({ genPresets: [customPreset] });
    const restored = settings.genPresets.find(preset => preset.id === 'gp-custom');
    expect(restored).toMatchObject({ steps: 30, scale: 6, cfgRescale: 0.3, undesiredContent: 'lowres' });
  });

  it('提示词项与预设的绑定关系同样不丢', async () => {
    const settings = await hydrateWith({
      genPresets: [customPreset],
      activeGenPreset: 'default',
      promptPresetLinks: { tagGen: 'gp-custom' },
    });
    expect(settings.promptPresetLinks).toEqual({ tagGen: 'gp-custom' });
  });

  it('一套预设都没存过时仍回落内置默认列表(normalize 不变式:恒非空)', async () => {
    const settings = await hydrateWith({});
    expect(settings.genPresets.map(preset => preset.id)).toEqual(['default', 'nai-4-5', 'lore']);
  });
});
