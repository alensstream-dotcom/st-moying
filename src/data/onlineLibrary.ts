import { allFandomItems } from '@/data/loreIndex';
import { loadTagChinese, searchTagChinese } from '@/state/characterStudio';
import type { WardrobeSlot } from '@/data/loreTypes';

export type OnlineKind = 'character' | 'wardrobe';
export interface OnlineMaterial {
  name: string;
  tags: string;
  aliases: string[];
  sourceUrl: string;
  kind: OnlineKind;
}
interface TagRow {
  name: string;
  category: number;
  count: number;
  aliases: string[];
}
interface Index {
  rows: TagRow[];
  savedAt: number;
}
export const INDEX_SOURCE = 'https://github.com/DominikDoom/a1111-sd-webui-tagcomplete';
const INDEX_URL =
  'https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/main/tags/danbooru.csv';
// Only garment nouns: never import a post's artist, style, quality, pose or identity tags as clothes.
const CLOTHING =
  /(?:^|_)(?:dress|shirt|blouse|skirt|shorts|pants|trousers|jeans|jacket|coat|robe|kimono|yukata|hanfu|qipao|cheongsam|hakama|haori|hanbok|sari|saree|uniform|sailor_collar|serafuku|suit|tuxedo|vest|cardigan|sweater|hoodie|poncho|cape|cloak|armor|armour|apron|overalls|dungarees|swimsuit|bikini|leotard|bodysuit|stockings|thighhighs|pantyhose|socks|tights|leggings|boots|shoes|sandals|heels|gloves|hat|beret|bonnet|scarf|necktie|bowtie|obi|belt)(?:_|$)/;
const STATE =
  /(?:^|_)(?:removed|removing|open|torn|lift|lifting|lifted|pull|pulling|pulled|wet|down|off|unbuttoned|unzipped|adjusting|dissolving|burning|grab|grabbing|holding|under|over|through|no|in|on|around|between|aside|biting|bite|mouth|waist|ankles|knees|looking|exposing|covering|flip|flipping|tug|tugging|grasping|pov|peeking|assisted|bulge|tent|sitting|stepping|sex|cum|blood)(?:_|$)/;
export function clothingTags(value: string): string[] {
  return value
    .split(/[ ,]+/)
    .map((t) => t.trim())
    .filter((t) => CLOTHING.test(t) && !STATE.test(t));
}
export function onlineWardrobeSlot(tags: string): WardrobeSlot {
  const t = tags.replace(/ /g, '_');
  const has = (r: RegExp) => r.test(t);
  if (
    has(
      /(?:^|[,_])(?:dress|robe|kimono|yukata|hanfu|qipao|cheongsam|uniform|serafuku|suit|swimsuit|bikini|bodysuit|leotard|overalls|armor)(?:[,_]|$)/,
    )
  )
    return 'full';
  const top = has(
    /(?:^|[,_])(?:shirt|blouse|jacket|coat|vest|cardigan|sweater|hoodie|poncho|cape|cloak)(?:[,_]|$)/,
  );
  const bottom = has(/(?:^|[,_])(?:skirt|pants|shorts|trousers|jeans|hakama)(?:[,_]|$)/);
  if (top && bottom) return 'full';
  if (top) return 'top';
  if (bottom) return 'bottom';
  if (has(/stockings|thighhighs|pantyhose|socks|tights|leggings/)) return 'hosiery';
  if (has(/boots|shoes|sandals|heels/)) return 'shoes';
  return 'accessory';
}
const normal = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
let memory: Index | undefined;

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('moying-online-library', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('cache');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('缓存被其他页面占用'));
  });
}
async function cached(): Promise<Index | undefined> {
  try {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction('cache').objectStore('cache').get('danbooru-v1');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}
async function saveCache(value: Index) {
  try {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction('cache', 'readwrite');
        t.objectStore('cache').put(value, 'danbooru-v1');
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  } catch {
    /* In-memory results still work if the browser denies persistent storage. */
  }
}
export async function publicFetch(url: string, signal: AbortSignal): Promise<Response> {
  let timedOut = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 25000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`外部服务返回 HTTP ${response.status}，请稍后重试`);
    // Read the body within the timeout; callers consume this detached response normally.
    return new Response(await response.text(), { headers: response.headers });
  } catch (error) {
    if (timedOut) throw new Error('外部服务连接超时，请检查网络或稍后重试');
    if (signal.aborted) throw new Error('已取消');
    if (error instanceof TypeError)
      throw new Error('无法连接外部库，可能是网络或浏览器跨域限制；可通过来源链接查看');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
function parseIndex(csv: string): TagRow[] {
  const result: TagRow[] = [];
  let cells: string[] = [],
    cell = '',
    quoted = false;
  function endRow() {
    cells.push(cell);
    cell = '';
    const category = Number(cells[1]),
      name = cells[0];
    if (name && (category === 4 || (category === 0 && clothingTags(name).length))) {
      result.push({
        name,
        category,
        count: Number(cells[2]) || 0,
        aliases: (cells[3] || '').split(',').filter(Boolean),
      });
    }
    cells = [];
  }
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else if (c === '\n' && !quoted) endRow();
    else if (c !== '\r') cell += c;
  }
  if (cell || cells.length) endRow();
  if (result.length < 100) throw new Error('外部索引格式异常，没有替换本地缓存');
  return result.sort((a, b) => b.count - a.count);
}
export async function loadOnlineIndex(signal: AbortSignal, refresh = false): Promise<Index> {
  if (!refresh) {
    memory ??= await cached();
    if (memory?.rows?.length) return memory;
  }
  const response = await publicFetch(INDEX_URL, signal);
  const index = { rows: parseIndex(await response.text()), savedAt: Date.now() };
  if (signal.aborted) throw new Error('已取消');
  memory = index;
  await saveCache(index);
  return index;
}
export async function searchOnline(index: Index, query: string, kind: OnlineKind): Promise<OnlineMaterial[]> {
  await loadTagChinese();
  const q = normal(query),
    terms = new Set([q]);
  if (/[\u3400-\u9fff]/.test(q)) {
    for (const [en] of searchTagChinese(q)) terms.add(normal(en));
    for (const item of allFandomItems()) {
      if ([item.name, item.franchise, ...item.aliases].some((s) => normal(s).includes(q))) {
        item.tags.split(',').forEach((t) => terms.add(normal(t)));
      }
    }
  }
  return index.rows
    .filter((row) => (kind === 'character' ? row.category === 4 : row.category === 0))
    .map((row) => {
      const values = [row.name, ...row.aliases].map(normal);
      const score = !q
        ? 1
        : Math.max(
            ...[...terms]
              .filter(Boolean)
              .map((t) => (values.some((v) => v === t) ? 3 : values.some((v) => v.includes(t)) ? 2 : 0)),
          );
      return { row, score };
    })
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score || b.row.count - a.row.count)
    .map(({ row }) => ({
      name: row.name.replace(/_/g, ' '),
      tags: row.name,
      aliases: row.aliases,
      sourceUrl: `https://danbooru.donmai.us/posts?tags=${encodeURIComponent(row.name + ' rating:g')}`,
      kind,
    }));
}
export interface OnlineExample {
  id: number;
  preview: string;
  sourceUrl: string;
  clothes: string;
}
export async function fetchExamples(tag: string, signal: AbortSignal): Promise<OnlineExample[]> {
  const url = new URL('https://danbooru.donmai.us/posts.json');
  url.searchParams.set('tags', `${tag} rating:g`);
  url.searchParams.set('limit', '12');
  const response = await publicFetch(url.href, signal);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('图库返回格式异常');
  return data
    .filter((p) => p.rating === 'g' && Number.isSafeInteger(p.id) && !p.is_deleted)
    .map((p) => ({
      id: p.id,
      preview: String(
        p.preview_file_url ||
          (Array.isArray(p.media_asset?.variants)
            ? p.media_asset.variants.find((v: { type?: string }) => v?.type === '180x180')?.url
            : '') ||
          '',
      ),
      sourceUrl: `https://danbooru.donmai.us/posts/${p.id}`,
      clothes: clothingTags(String(p.tag_string_general || '')).join(', '),
    }))
    .filter((p) => /^https:\/\/(?:cdn\d*\.)?(?:donmai\.us|danbooru\.donmai\.us)\//.test(p.preview));
}
