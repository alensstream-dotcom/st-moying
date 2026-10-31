/**
 * 素材库预览图缓存。
 *
 * 为什么单独存 IndexedDB 而不是 localStorage：一张 NAI 竖图即使压成 jpeg 也有几百 KB，
 * localStorage 5MB 配额存不了几条，而且它只能存字符串（要 base64，体积再涨 33%）。
 * IndexedDB 能直接放 Blob，几百张不会碰到上限，读出来 createObjectURL 就能显示。
 *
 * 为什么一定要缓存：生成一张要消耗用户一次 NAI 额度，不能让翻页就重画。
 * 键的格式是 `kind:id`，内置条目和自定义条目共用一套键（自定义条目 id 带 u-/up- 前缀，
 * 不会和内置的撞）。
 */

const DB_NAME = 'moying_image_lore';
const STORE = 'thumbs';
const DB_VERSION = 1;

export type ThumbKind = 'wardrobe' | 'pose' | 'face';

export interface ThumbRecord {
  blob: Blob;
  /** 生成时用的提示词，用来判断缓存是否过期（换了 tag 就该重画）。 */
  prompt: string;
  at: number;
}

/** IndexedDB 用不了时的内存兜底：至少这次会话里不会重复花钱。 */
const memory = new Map<string, ThumbRecord>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

export function thumbKey(kind: ThumbKind, id: string): string {
  return `${kind}:${id}`;
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise(resolve => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function getThumb(key: string): Promise<ThumbRecord | null> {
  const cached = memory.get(key);
  if (cached) return cached;
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, 'readonly');
    const value = await requestToPromise<ThumbRecord | undefined>(tx.objectStore(STORE).get(key));
    if (!value || !value.blob) return null;
    memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export async function putThumb(key: string, blob: Blob, prompt: string): Promise<void> {
  const record: ThumbRecord = { blob, prompt, at: Date.now() };
  memory.set(key, record);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record, key);
  } catch {
    // 配额满：内存里这份仍然可用，不打断用户
  }
}

export async function deleteThumb(key: string): Promise<void> {
  memory.delete(key);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
  } catch {
    // 忽略
  }
}

export async function clearThumbs(): Promise<void> {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
  } catch {
    // 忽略
  }
}

/** 已缓存的数量（设置页/工具栏显示用）。 */
export async function countThumbs(): Promise<number> {
  const db = await openDb();
  if (!db) return memory.size;
  try {
    const tx = db.transaction(STORE, 'readonly');
    const total = await requestToPromise<number>(tx.objectStore(STORE).count());
    return Math.max(total ?? 0, memory.size);
  } catch {
    return memory.size;
  }
}

/** 供测试重置模块级状态。 */
export function resetThumbCache(): void {
  memory.clear();
  dbPromise = null;
}
