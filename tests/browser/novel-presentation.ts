// Browser regression fixture: real parser, NovelAI client, storage, hydrator and Vue Card.
// The browser harness intercepts only HTTP responses; no production rendering modules are mocked.
const host = window as any;
const tag = '<bbi_image><tag>girl, harbor</tag><size>portrait</size></bbi_image>';
const message = { name: 'NovelTest', is_user: false, is_system: false, mes: '她推开书店的门。\n' + tag, send_date: 'fixture-0', extra: {} };
let renders = 0;
host.toastr = Object.fromEntries(['info', 'error', 'warning', 'success'].map(key => [key, console.log]));
host.SillyTavern = { getContext: () => ({
  chat: [message], getCurrentChatId: () => 'fixture-chat', name1: 'Reader', name2: 'NovelTest',
  saveChat: async () => {}, getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
  eventSource: { emit: async () => {}, on: () => {} }, eventTypes: {},
  updateMessageBlock: async (_floor: number, current: typeof message) => {
    renders++;
    const text = document.querySelector('.mes_text')!;
    text.innerHTML = current.mes.replace(/<bbi_image>[\s\S]*?<\/bbi_image>/g, '<div data-bbi-slot></div>');
  },
}) };
const { settings } = await import('../../src/state/settings');
const { novelReader } = await import('../../src/public/novelReader');
settings.enabled = true; settings.defaultBackend = 'nai';
settings.nai.endpoints = [{ id: 'fixture', name: 'fixture', url: location.origin + '/mock-nai', key: 'fixture-only' }];
settings.nai.activeEndpointId = 'fixture'; settings.nai.model = 'nai-diffusion-3'; settings.nai.vibes = [];
settings.storage.saveAsJpeg = false;
host.fixture = {
  novelReader, message, get renders() { return renders; },
  resetDom() { document.querySelector('.mes_text')!.textContent = '旧正文，没有锚点'; },
};
