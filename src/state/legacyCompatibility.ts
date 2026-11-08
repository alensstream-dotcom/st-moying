/** Same-family 柏宝绘 data is only adopted when the 墨影 namespace is absent.
 * Always copy: migrations may mutate their input; rollback must retain the original.
 */
export function readCompatibleData(
  store: Record<string, unknown> | undefined,
  key: string,
  legacyKey: string,
): unknown {
  if (!store) return undefined;
  const raw = store[key] ?? store[legacyKey];
  return raw == null ? raw : JSON.parse(JSON.stringify(raw));
}

export function legacySettingsSeed(store: Record<string, unknown>): unknown {
  if (store.moying_image != null || !store.baibai_image || typeof store.baibai_image !== 'object') {
    return store.moying_image;
  }
  return readCompatibleData(store, 'moying_image', 'baibai_image') as Record<string, unknown>;
}

/** Display existing images in place, including the legacy plugin's folders. */
export function galleryCharacterName(folder: string): string | null {
  for (const prefix of ['墨影_', '柏宝绘_']) {
    if (folder.startsWith(prefix)) return folder.slice(prefix.length) || '未命名角色';
  }
  return null;
}
