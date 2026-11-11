import { h, render } from 'vue';
import AppearanceCapture from '@/components/AppearanceCapture.vue';
export function openAppearanceCapture(options: { src: string; cast: Array<{ name: string; tag: string }>; chat?: string }) {
  const root = document.getElementById('bbi-app-host')?.shadowRoot;
  if (!root) return;
  const host = document.createElement('div'); root.append(host);
  render(h(AppearanceCapture, { ...options, onClose: () => { render(null, host); host.remove(); } }), host);
}
