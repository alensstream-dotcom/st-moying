import { reactive } from 'vue';

/** Only bodies, never connection settings/headers. Reference binaries are omitted. */
export function safeRequest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeRequest);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /key|token|authorization|password|secret|url|path/i.test(key) ? '[redacted]'
      : /reference_image|image_encoded|image_base64/i.test(key) ? '[reference data omitted]'
        : safeRequest(item),
  ]));
}

export const requestTraces = reactive<Array<{ id: number; at: number; body: unknown }>>([]);
let serial = 0;
export function recordRequest(body: unknown): void {
  try {
    requestTraces.unshift({ id: ++serial, at: Date.now(), body: safeRequest(body) });
    requestTraces.splice(20);
  } catch { /* Diagnostics cannot interrupt generation. */ }
}
