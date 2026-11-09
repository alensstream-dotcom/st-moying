/** Fit without stretching; use the official reference canvas sizes. */
export async function prepareCharacterReference(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const ratio = bitmap.width / bitmap.height;
    const [w, h] = ratio > 1.2 ? [1536, 1024] : ratio < 0.83 ? [1024, 1536] : [1472, 1472];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法准备角色参考图');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / bitmap.width, h / bitmap.height),
      dw = bitmap.width * scale,
      dh = bitmap.height * scale;
    ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return canvas.toDataURL('image/png').split(',')[1];
  } finally {
    bitmap.close();
  }
}
