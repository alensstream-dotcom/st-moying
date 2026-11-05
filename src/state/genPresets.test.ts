import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: null as Record<string, unknown> | null,
}));

vi.mock('@/st/context', () => ({
  getContext: () => mocks.context,
}));

import {
  applyGenPreset,
  bindArtistGenPreset,
  inferPresetForArtistName,
  presetForArtist,
  selectArtistWithPreset,
  switchGenPreset,
} from '@/state/genPresets';
import { hydrateSettings, settings } from '@/state/settings';

describe('genPresets 画师串与生图参数预设联动', () => {
  beforeEach(async () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    mocks.context = {
      extensionSettings: { moying_image: {} },
      saveSettingsDebounced: vi.fn(),
    };
    await hydrateSettings();
  });

  it('默认预设列表自带「默认 (NAI 5)」「NAI 4.5 常用」与「素材库配图」三套', () => {
    expect(settings.genPresets.map(p => p.id)).toEqual(['default', 'nai-4-5', 'lore']);
    const p45 = settings.genPresets.find(p => p.id === 'nai-4-5')!;
    expect(p45.model).toBe('nai-diffusion-4-5-full');
    expect(p45.forLore).toBe(false);
  });

  it('多条画师串可以共用绑定同一套「NAI 4.5 常用」参数预设（多对一正向绑定）', () => {
    settings.nai.artistPresets = [
      { id: 'art-v45-a', name: '厚涂风 A', prompt: 'artist:a', quality: '', negative: '' },
      { id: 'art-v45-b', name: '赛璐璐 B', prompt: 'artist:b', quality: '', negative: '' },
      { id: 'art-v5-c', name: '新画风 C', prompt: 'artist:c', quality: '', negative: '' },
    ];
    bindArtistGenPreset('art-v45-a', 'nai-4-5');
    bindArtistGenPreset('art-v45-b', 'nai-4-5');
    bindArtistGenPreset('art-v5-c', 'default');

    expect(presetForArtist('art-v45-a')?.id).toBe('nai-4-5');
    expect(presetForArtist('art-v45-b')?.id).toBe('nai-4-5');
    expect(presetForArtist('art-v5-c')?.id).toBe('default');

    // 从 V5 切到第一条 4.5 画师串 -> 自动切到 NAI 4.5 模型与参数
    selectArtistWithPreset('art-v45-a');
    expect(settings.activeGenPreset).toBe('nai-4-5');
    expect(settings.nai.model).toBe('nai-diffusion-4-5-full');
    expect(settings.nai.activeArtistId).toBe('art-v45-a');

    // 再切到第二条共用 4.5 参数的画师串 -> 保持 NAI 4.5 参数且画师串不会跳回第一条
    selectArtistWithPreset('art-v45-b');
    expect(settings.activeGenPreset).toBe('nai-4-5');
    expect(settings.nai.model).toBe('nai-diffusion-4-5-full');
    expect(settings.nai.activeArtistId).toBe('art-v45-b');

    // 切回 V5 画师串 -> 自动切回 NAI 5 模型与参数
    selectArtistWithPreset('art-v5-c');
    expect(settings.activeGenPreset).toBe('default');
    expect(settings.nai.model).toBe('nai-diffusion-5-full');
    expect(settings.nai.activeArtistId).toBe('art-v5-c');
  });

  it('未手动绑定预设时，名称含 4.5 / v4.5 的画师串自动匹配 NAI 4.5 参数预设', () => {
    settings.nai.artistPresets = [
      { id: 'art-auto-45', name: '韩漫水润 v4.5', prompt: 'artist:kr', quality: '', negative: '' },
      { id: 'art-auto-v5', name: '日系清透 V5', prompt: 'artist:jp', quality: '', negative: '' },
    ];
    expect(inferPresetForArtistName('韩漫水润 v4.5')?.id).toBe('nai-4-5');
    expect(inferPresetForArtistName('日系清透 V5')?.id).toBe('default');

    selectArtistWithPreset('art-auto-45');
    expect(settings.activeGenPreset).toBe('nai-4-5');
    expect(settings.nai.model).toBe('nai-diffusion-4-5-full');

    selectArtistWithPreset('art-auto-v5');
    expect(settings.activeGenPreset).toBe('default');
    expect(settings.nai.model).toBe('nai-diffusion-5-full');
  });

  it('切换未绑定的画师串不会在 600ms 防抖后篡改当前参数预设的 activeArtistId', async () => {
    vi.useFakeTimers();
    try {
      const def = settings.genPresets.find(p => p.id === 'default')!;
      def.activeArtistId = 'art-bound';
      settings.nai.artistPresets = [
        { id: 'art-bound', name: '原绑定串', prompt: 'artist:1', quality: '', negative: '' },
        { id: 'art-free', name: '随手试串', prompt: 'artist:2', quality: '', negative: '' },
      ];
      applyGenPreset('default');
      expect(settings.nai.activeArtistId).toBe('art-bound');

      // 用户切到未绑定的画师串
      selectArtistWithPreset('art-free');
      vi.advanceTimersByTime(1000);

      // 原预设绑定的 activeArtistId 不应被篡改覆盖
      expect(def.activeArtistId).toBe('art-bound');
    } finally {
      vi.useRealTimers();
    }
  });

  it('手动切换到一个未固定画师串的参数预设时，保留当前正在使用的画师串不被清空', () => {
    settings.nai.artistPresets = [
      { id: 'art-my', name: '我的画师串', prompt: 'artist:me', quality: '', negative: '' },
    ];
    settings.nai.activeArtistId = 'art-my';
    switchGenPreset('nai-4-5');
    expect(settings.nai.model).toBe('nai-diffusion-4-5-full');
    expect(settings.nai.activeArtistId).toBe('art-my');
  });
});
