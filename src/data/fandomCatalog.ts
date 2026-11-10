import catalogUrl from './characterCatalog.json?url';
import type { FandomPreset } from './loreTypes';
const KEY = 'moying_fandom_catalog_v2';
const works: Array<[string, string, string, Array<[string, string]>]> = [
  [
    'vocaloid',
    'VOCALOID',
    '其他',
    [
      ['初音未来', 'hatsune miku'],
      ['镜音铃', 'kagamine rin'],
      ['巡音流歌', 'megurine luka'],
    ],
  ],
  [
    'genshin impact',
    '原神',
    '游戏',
    [
      ['刻晴', 'keqing'],
      ['甘雨', 'ganyu'],
      ['胡桃', 'hu tao'],
      ['雷电将军', 'raiden shogun'],
      ['八重神子', 'yae miko'],
      ['神里绫华', 'kamisato ayaka'],
      ['优菈', 'eula'],
      ['宵宫', 'yoimiya'],
      ['纳西妲', 'nahida'],
      ['芙宁娜', 'furina'],
    ],
  ],
  [
    'honkai: star rail',
    '崩坏：星穹铁道',
    '游戏',
    [
      ['三月七', 'march 7th'],
      ['卡芙卡', 'kafka'],
      ['银狼', 'silver wolf'],
      ['姬子', 'himeko'],
      ['镜流', 'jingliu'],
      ['阮梅', 'ruan mei'],
      ['花火', 'sparkle'],
      ['流萤', 'firefly'],
    ],
  ],
  [
    'touhou',
    '东方Project',
    '游戏',
    [
      ['博丽灵梦', 'hakurei reimu'],
      ['雾雨魔理沙', 'kirisame marisa'],
      ['十六夜咲夜', 'izayoi sakuya'],
      ['蕾米莉亚', 'remilia scarlet'],
      ['芙兰朵露', 'flandre scarlet'],
      ['八云紫', 'yakumo yukari'],
      ['魂魄妖梦', 'konpaku youmu'],
    ],
  ],
  [
    'blue archive',
    '蔚蓝档案',
    '游戏',
    [
      ['砂狼白子', 'sunaookami shiroko'],
      ['小鸟游星野', 'takanashi hoshino'],
      ['天童爱丽丝', 'tendou aris'],
      ['圣园未花', 'misono mika'],
    ],
  ],
  [
    'fate (series)',
    'Fate系列',
    '游戏／动画',
    [
      ['阿尔托莉雅', 'artoria pendragon (fate)'],
      ['远坂凛', 'tohsaka rin'],
      ['间桐樱', 'matou sakura'],
    ],
  ],
  [
    'bocchi the rock!',
    '孤独摇滚',
    '动画／漫画',
    [
      ['后藤一里', 'gotoh hitori'],
      ['喜多郁代', 'kita ikuyo'],
      ['伊地知虹夏', 'ijichi nijika'],
      ['山田凉', 'yamada ryou'],
    ],
  ],
  [
    're:zero kara hajimeru isekai seikatsu',
    'Re：从零开始的异世界生活',
    '小说／动画',
    [
      ['蕾姆', 'rem (re:zero)'],
      ['爱蜜莉雅', 'emilia (re:zero)'],
    ],
  ],
];
export interface FandomMaterial extends FandomPreset {
  roleTag: string;
  workTag: string;
  medium: string;
  trigger?: string;
  gender?: string;
  count?: number;
  variants?: string[];
  source?: string;
  searchText?: string;
  workAliases?: string[];
  translationNote?: string;
}
export const BUILTIN_FANDOMS: FandomMaterial[] = works.flatMap(([workTag, franchise, medium, characters]) =>
  characters.map(([name, roleTag]) => ({
    id: 'identity:' + roleTag + ':' + workTag,
    name,
    roleTag,
    workTag,
    medium,
    franchise,
    tags: `${roleTag}, ${workTag}`,
    aliases: [name, roleTag, franchise, workTag],
    nsfw: 0,
    note: '仅角色名＋作品名，不附带外貌、画风或衣物。',
  })),
);
interface CatalogState {
  version: 3;
  edits: FandomMaterial[];
  hidden: string[];
}
let saved: CatalogState = { version: 3, edits: [], hidden: [] },
  base: FandomMaterial[] = [],
  memo: FandomMaterial[] | null = null,
  loaded: Promise<void> | undefined;
let resolvedEditedIds = new Set<string>();
let catalogRedirects: Record<string, string> = {};
export const catalogInfo = {
  characters: 0,
  works: 0,
  merged: 0,
  source: 'https://huggingface.co/datasets/Laxhar/noob-wiki',
};
const normal = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
async function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('moying-identities', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('catalog');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('目录缓存被其他页面占用'));
  });
}
async function persist(next: CatalogState) {
  const connection = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = connection.transaction('catalog', 'readwrite');
      t.objectStore('catalog').put(next, 'identities');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    connection.close();
  }
  saved = next;
  memo = null;
}
export function loadFandomCatalog(): Promise<void> {
  return (loaded ??= (async () => {
    // Vite's default asset URL points at the ST site root; material assets live beside this extension module.
    const resource = new URL(catalogUrl.split('/').pop() || 'characterCatalog.json', import.meta.url);
    resource.searchParams.set('ver', __BBI_VERSION__);
    const response = await fetch(resource);
    if (!response.ok) throw new Error('本地角色目录读取失败，请更新插件完整文件后重试');
    const [pack, workModule, roleModule, extraModule] = await Promise.all([
      response.json(),
      import('./copyrightZh.json'),
      import('./characterZh.json'),
      import('./catalogChineseExtra.json'),
    ]);
    const workChinese = workModule.default,
      roleChinese = roleModule.default,
      extra = extraModule.default;
    if (pack.version !== 1 || !Array.isArray(pack.works)) throw new Error('角色目录格式不正确');
    catalogRedirects = pack.redirects && typeof pack.redirects === 'object' ? pack.redirects : {};
    const curated = new Map(
      BUILTIN_FANDOMS.map((x) => [normal(x.workTag) + '|' + normal(x.roleTag).split(' (')[0], x]),
    );
    base = [];
    for (const [copyright, entries] of pack.works as [
      string,
      Array<[string, number, string, string[]?, string?]>,
    ][]) {
      const workTranslation = (workChinese as Record<string, string[]>)[copyright];
      const workAliases = (workTranslation?.[1] || '').split('|').filter(Boolean);
      const workTag = copyright.replace(/_/g, ' '),
        work = works.find((w) => normal(w[0]) === normal(workTag));
      for (const [slug, count, gender, variants, override] of entries) {
        const roleTag = slug.replace(/_/g, ' '),
          cn = curated.get(normal(workTag) + '|' + normal(roleTag).split(' (')[0]);
        const tags = override || roleTag + ', ' + workTag;
        const roleTranslation = (roleChinese as Record<string, string[]>)[slug];
        const machineRole = (extra.characters as Record<string, string>)[slug];
        const machineWork = (extra.works as Record<string, string>)[copyright];
        const extraAliases = (extra.aliases as Record<string, string[]>)[slug] || [];
        const variantChinese = (variants || []).flatMap((trigger) => {
          const key = trigger.split(',')[0].trim().replace(/\s+/g, '_');
          const translated = (roleChinese as Record<string, string[]>)[key];
          return [
            translated?.[0],
            ...(translated?.[1] || '').split('|'),
            (extra.characters as Record<string, string>)[key],
            ...((extra.aliases as Record<string, string[]>)[key] || []),
          ].filter((x): x is string => !!x && /[\u3400-\u9fff]/.test(x));
        });
        const roleAliases = (roleTranslation?.[1] || '').split('|').filter(Boolean);
        const item: FandomMaterial = {
          id: 'animadex:' + slug,
          name:
            cn?.name ||
            (/[\u3400-\u9fff]/.test(roleTranslation?.[0] || '')
              ? roleTranslation[0]
              : machineRole || roleTag),
          roleTag,
          workTag,
          franchise:
            work?.[1] ||
            (/[\u3400-\u9fff]/.test(workTranslation?.[0] || '')
              ? workTranslation[0]
              : machineWork || workTag) ||
            '未注明作品',
          workAliases,
          translationNote:
            (!cn?.name && !/[\u3400-\u9fff]/.test(roleTranslation?.[0] || '') && machineRole) ||
            (!work?.[1] && !/[\u3400-\u9fff]/.test(workTranslation?.[0] || '') && machineWork)
              ? '部分名称为机器翻译，请核对'
              : undefined,
          medium: work?.[2] || '未分类',
          tags,
          trigger: tags,
          aliases: [
            ...new Set([
              ...(cn?.aliases || []),
              ...roleAliases,
              ...extraAliases,
              ...variantChinese,
              ...(variants || []).map((v) => v.replace(/_/g, ' ')),
            ]),
          ],
          gender,
          count,
          variants,
          source: catalogInfo.source,
          nsfw: 0,
        };
        item.searchText = normal(
          [item.name, item.franchise, item.roleTag, item.workTag, ...item.aliases, ...workAliases].join(' '),
        );
        base.push(item);
      }
    }
    base.sort((a, b) => (b.count || 0) - (a.count || 0));
    Object.assign(catalogInfo, {
      characters: base.length,
      works: pack.workCount,
      merged: pack.mergedVariants,
    });
    try {
      const connection = await db();
      try {
        const value = await new Promise<any>((resolve, reject) => {
          const r = connection.transaction('catalog').objectStore('catalog').get('identities');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        if (value?.version === 3 && Array.isArray(value.edits) && Array.isArray(value.hidden)) saved = value;
        else if (Array.isArray(value))
          saved = {
            version: 3,
            edits: value.filter(
              (x: FandomMaterial) =>
                !BUILTIN_FANDOMS.some(
                  (b) =>
                    b.id === x.id && b.tags === x.tags && b.name === x.name && b.franchise === x.franchise,
                ),
            ),
            hidden: [],
          };
      } finally {
        connection.close();
      }
    } catch {
      /* Bundled directory remains readable if storage is unavailable. */
    }
    memo = null;
  })().catch((error) => {
    loaded = undefined;
    throw error;
  }));
}
function equivalent(item: FandomMaterial, pool: FandomMaterial[]) {
  const role = normal(item.roleTag),
    work = normal(item.workTag);
  const exact = pool.find((x) => normal(x.workTag) === work && normal(x.roleTag) === role);
  if (exact) return exact;
  const matches = pool.filter(
    (x) => normal(x.workTag) === work && normal(x.roleTag).split(' (')[0] === role.split(' (')[0],
  );
  return matches.length === 1 ? matches[0] : undefined;
}
export function fandomCatalog(): FandomMaterial[] {
  if (memo) return memo;
  const editedIds = new Set<string>();
  const primary = base.length ? base : BUILTIN_FANDOMS,
    map = new Map(primary.map((x) => [x.id, x]));
  const exactLookup = new Map(primary.map((x) => [normal(x.roleTag) + '|' + normal(x.workTag), x]));
  const identityLookup = new Map<string, FandomMaterial | null>();
  for (const item of primary) {
    const key = normal(item.roleTag).split(' (')[0] + '|' + normal(item.workTag);
    identityLookup.set(key, identityLookup.has(key) ? null : item);
  }
  for (const edit of saved.edits) {
    if (!edit?.roleTag || typeof edit.workTag !== 'string') continue;
    const oldSlug = edit.id.startsWith('animadex:') ? edit.id.slice('animadex:'.length) : '';
    const redirected = catalogRedirects[oldSlug];
    const redirectedItem = redirected ? map.get('animadex:' + redirected) : undefined;
    if (redirectedItem) {
      const aliases = [
        ...new Set(
          [
            ...redirectedItem.aliases,
            ...(Array.isArray(edit.aliases) ? edit.aliases : []),
            edit.name,
            edit.tags,
          ].filter(Boolean),
        ),
      ];
      map.set(redirectedItem.id, {
        ...redirectedItem,
        aliases,
        searchText: normal(
          [
            redirectedItem.name,
            redirectedItem.franchise,
            redirectedItem.roleTag,
            redirectedItem.workTag,
            ...aliases,
            ...(redirectedItem.workAliases || []),
          ].join(' '),
        ),
      });
      editedIds.add(redirectedItem.id);
      continue;
    }
    const old =
      map.get(edit.id) ||
      exactLookup.get(normal(edit.roleTag) + '|' + normal(edit.workTag)) ||
      identityLookup.get(normal(edit.roleTag).split(' (')[0] + '|' + normal(edit.workTag));
    const id = old?.id || edit.id;
    editedIds.add(id);
    const value = {
      ...old,
      ...edit,
      id,
      name: old && edit.name === edit.roleTag ? old.name : edit.name,
      franchise: old && edit.franchise === edit.workTag ? old.franchise : edit.franchise,
      tags: edit.trigger || edit.tags || edit.roleTag + ', ' + edit.workTag,
      aliases: [...new Set([...(old?.aliases || []), ...(Array.isArray(edit.aliases) ? edit.aliases : [])])],
    };
    value.searchText = normal(
      [
        value.name,
        value.roleTag,
        value.workTag,
        value.franchise,
        ...value.aliases,
        ...(value.workAliases || []),
      ].join(' '),
    );
    map.set(id, value);
  }
  const hidden = new Set(saved.hidden);
  resolvedEditedIds = editedIds;
  return (memo = [...map.values()].filter((x) => !hidden.has(x.id)));
}
export function editedFandomIds() {
  fandomCatalog();
  return new Set(resolvedEditedIds);
}
export async function saveFandomIdentity(
  input: Pick<FandomMaterial, 'name' | 'roleTag' | 'workTag' | 'franchise' | 'medium'> & {
    id?: string;
    trigger?: string;
    aliases?: string[];
    gender?: string;
  },
) {
  await loadFandomCatalog();
  const roleTag = input.roleTag.trim().replace(/_/g, ' '),
    workTag = input.workTag.trim().replace(/_/g, ' '),
    tags = input.trigger?.trim() || [roleTag, workTag].filter(Boolean).join(', ');
  if (
    !input.name.trim() ||
    !roleTag ||
    /[，\r\n<>]/.test(roleTag + workTag) ||
    !tags ||
    tags.length > 2000 ||
    /[<>\r\n]/.test(tags)
  )
    throw new Error('请填写名称、英文角色与作品标签和有效 trigger');
  const old = input.id
    ? fandomCatalog().find((x) => x.id === input.id)
    : equivalent({ ...input, roleTag, workTag } as FandomMaterial, fandomCatalog());
  const item: FandomMaterial = {
    ...old,
    ...input,
    id: old?.id || 'identity:' + roleTag + ':' + workTag,
    name: input.name.trim(),
    roleTag,
    workTag,
    franchise: input.franchise.trim() || workTag,
    medium: input.medium || '未分类',
    tags,
    trigger: tags,
    aliases: [
      ...new Set([...(old?.aliases || []), ...(input.aliases || []), input.name.trim(), roleTag, workTag]),
    ],
    nsfw: old?.nsfw || 0,
  };
  await persist({
    ...saved,
    edits: [...saved.edits.filter((x) => x.id !== item.id), item],
    hidden: saved.hidden.filter((id) => id !== item.id),
  });
  return item;
}
export async function deleteFandomIdentity(id: string) {
  await loadFandomCatalog();
  await persist({
    ...saved,
    edits: saved.edits.filter((x) => x.id !== id),
    hidden: [...new Set([...saved.hidden, id])],
  });
}
export async function mergeFandomIdentities(from: string, to: string) {
  await loadFandomCatalog();
  const a = fandomCatalog().find((x) => x.id === from),
    b = fandomCatalog().find((x) => x.id === to);
  if (!a || !b || from === to) throw new Error('请选择另一个同人物条目');
  const merged = {
    ...b,
    aliases: [...new Set([...b.aliases, ...a.aliases, a.name, a.tags, a.roleTag])],
    variants: [...new Set([...(b.variants || []), ...(a.variants || []), a.roleTag])],
  };
  await persist({
    ...saved,
    edits: [...saved.edits.filter((x) => x.id !== from && x.id !== to), merged],
    hidden: [...new Set([...saved.hidden, from])],
  });
  return merged;
}
export function exportFandomCatalog(items?: FandomMaterial[]) {
  return JSON.stringify(items || saved, null, 2);
}
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [],
    cell = '',
    quote = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i] ?? '\n';
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (c === ',' && !quote) {
      cells.push(cell);
      cell = '';
    } else if (c === '\n' && !quote) {
      cells.push(cell);
      if (cells.some(Boolean)) rows.push(cells);
      cells = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (quote) throw new Error('CSV 引号未闭合');
  return rows;
}
export async function importFandomCatalog(text: string): Promise<number> {
  await loadFandomCatalog();
  let inputs: Array<Partial<FandomMaterial>>,
    hidden: string[] = [];
  if (/^[\s\uFEFF]*[\[{]/.test(text)) {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (value?.version === 3 && Array.isArray(value.edits)) {
      inputs = value.edits;
      hidden = Array.isArray(value.hidden) ? value.hidden.filter((x: unknown) => typeof x === 'string') : [];
    } else inputs = value;
  } else {
    const rows = parseCsv(text.replace(/^\uFEFF/, '')),
      header = rows.shift() || [];
    const c = header.indexOf('character'),
      w = header.indexOf('copyright'),
      t = header.indexOf('trigger');
    if (c < 0 || w < 0) throw new Error('CSV 需要 character、copyright 列');
    inputs = rows.map((r) => ({
      name: r[c]?.replace(/_/g, ' '),
      roleTag: r[c]?.replace(/_/g, ' '),
      workTag: r[w]?.replace(/_/g, ' '),
      franchise: r[w]?.replace(/_/g, ' '),
      medium: '未分类',
      trigger: t >= 0 ? r[t] : undefined,
    }));
  }
  if (!Array.isArray(inputs) || inputs.length > 300000) throw new Error('角色文件格式或数量不正确');
  const current = fandomCatalog(),
    lookup = new Map(current.map((x) => [normal(x.roleTag) + '|' + normal(x.workTag), x]));
  const variantLookup = new Map<string, FandomMaterial>();
  for (const item of current)
    for (const alias of item.variants || []) {
      const role = alias.split(',')[0];
      variantLookup.set(normal(role) + '|' + normal(item.workTag), item);
    }
  const edits = new Map(saved.edits.map((x) => [x.id, x]));
  for (const x of inputs) {
    if (
      typeof x.name !== 'string' ||
      typeof x.roleTag !== 'string' ||
      typeof x.workTag !== 'string' ||
      !x.name.trim() ||
      !x.roleTag.trim() ||
      /[<>\r\n]/.test(x.roleTag + x.workTag)
    )
      throw new Error('文件含有无效角色，未导入');
    const roleTag = x.roleTag.replace(/_/g, ' '),
      workTag = x.workTag.replace(/_/g, ' '),
      exact = lookup.get(normal(roleTag) + '|' + normal(workTag)),
      variant = exact
        ? undefined
        : variantLookup.get(normal(roleTag) + '|' + normal(workTag)) ||
          lookup.get(normal(roleTag.replace(/ \([^()]*\)$/, '')) + '|' + normal(workTag)),
      old = exact || variant;
    const tags = x.trigger || x.tags || roleTag + ', ' + workTag;
    if (typeof tags !== 'string' || /[<>\r\n]/.test(tags)) throw new Error('无效 trigger');
    if (variant) {
      if (x.name === roleTag && variant.variants?.includes(tags)) continue;
      const primary = edits.get(variant.id) || variant;
      edits.set(primary.id, {
        ...primary,
        aliases: [...new Set([...primary.aliases, x.name, roleTag, tags])],
        variants: [...new Set([...(primary.variants || []), tags])],
      });
      continue;
    }
    if (old && tags === old.tags && x.name === roleTag && !x.aliases?.length) continue;
    const item: FandomMaterial = {
      ...old,
      ...x,
      id: old?.id || x.id || 'identity:' + roleTag + ':' + workTag,
      name: old?.name && old.name !== old.roleTag ? old.name : x.name,
      roleTag,
      workTag,
      franchise: x.franchise || old?.franchise || workTag,
      medium: x.medium || old?.medium || '未分类',
      tags,
      trigger: tags,
      aliases: Array.isArray(x.aliases)
        ? x.aliases.filter((a) => typeof a === 'string')
        : [x.name, roleTag, workTag],
      nsfw: 0,
    };
    edits.set(item.id, item);
    lookup.set(normal(roleTag) + '|' + normal(workTag), item);
  }
  await persist({ ...saved, edits: [...edits.values()], hidden: [...new Set([...saved.hidden, ...hidden])] });
  return inputs.length;
}
