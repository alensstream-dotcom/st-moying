import { h, render } from 'vue';
import HairLockDialog from '@/components/HairLockDialog.vue';
export function openHairLock(options: {
  src: string;
  cast: Array<{ name: string; tag: string }>;
  chat?: string;
}) {
  const root = document.getElementById('bbi-app-host')?.shadowRoot;
  if (!root) {
    toastr.error('插件界面尚未就绪，请先打开墨影');
    return;
  }
  const host = document.createElement('div');
  root.append(host);
  render(
    h(HairLockDialog, {
      ...options,
      onClose: () => {
        render(null, host);
        host.remove();
      },
    }),
    host,
  );
}
