import { h, render } from 'vue';

import OutfitHarvestDialog from '@/components/OutfitHarvestDialog.vue';

/**
 * 打开「收藏这身衣服」弹窗。挂插件 shadow root——同灯箱/确认弹窗,那里才有
 * dist/index.css 与 --bbi-* 主题变量;挂 body 会裸奔。
 *
 * 灯箱那边是关掉自己之后再调过来的,故这里不持有灯箱状态;回调里的 src/prompt
 * 由调用方快照,弹窗活得比卡片久。
 */
export function openOutfitHarvest(options: { src: string; prompt?: string; onSaved?: () => void }): void {
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
    h(OutfitHarvestDialog, {
      src: options.src,
      prompt: options.prompt,
      onClose: close,
      onSaved: () => options.onSaved?.(),
    }),
    host,
  );
}
