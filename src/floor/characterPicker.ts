import { h, render } from 'vue';

import CharacterPicker from '@/components/CharacterPicker.vue';

/**
 * 点图选角色。挂插件 shadow root——与灯箱/确认弹窗同一处，才有 dist/index.css
 * 与 --bbi-* 主题变量；挂 body 会裸奔。
 */
export function openCharacterPicker(options: {
  src: string;
  cast: Array<{ name: string; tag: string; nl?: string }>;
  chat?: string;
  onPick: (value: { name: string; tag: string }) => void;
}): void {
  const root = document.getElementById('bbi-app-host')?.shadowRoot;
  if (!root) {
    toastr.error('插件界面尚未就绪，请先打开墨影');
    return;
  }
  const host = document.createElement('div');
  root.append(host);
  const close = () => {
    render(null, host);
    host.remove();
  };
  render(
    h(CharacterPicker, {
      src: options.src,
      cast: options.cast,
      chat: options.chat,
      onClose: close,
      onPick: (value: { name: string; tag: string }) => {
        close();
        options.onPick(value);
      },
    }),
    host,
  );
}
