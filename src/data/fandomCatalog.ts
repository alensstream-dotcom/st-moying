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
let catalogMemory: FandomMaterial[] = [];
let loaded: Promise<void> | undefined;
async function catalogDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('moying-identities', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('catalog');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('角色目录存储被其他页面占用'));
  });
}
export function loadFandomCatalog(): Promise<void> {
  return (loaded ??= (async () => {
    try {
      const db = await catalogDb();
      try {
        const rows = await new Promise<FandomMaterial[]>((resolve, reject) => {
          const r = db.transaction('catalog').objectStore('catalog').get('identities');
          r.onsuccess = () => resolve(r.result || []);
          r.onerror = () => reject(r.error);
        });
        catalogMemory = Array.isArray(rows) ? rows : [];
      } finally {
        db.close();
      }
    } catch {
      try {
        const rows = JSON.parse(localStorage.getItem(KEY) || '[]');
        catalogMemory = Array.isArray(rows) ? rows : [];
      } catch {
        catalogMemory = [];
      }
    }
  })());
}
async function persistCatalog(rows: FandomMaterial[]) {
  try {
    const db = await catalogDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction('catalog', 'readwrite');
        t.objectStore('catalog').put(rows, 'identities');
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  } catch {
    throw new Error('角色目录未能持久保存，请检查浏览器存储空间；未改变原目录');
  }
  catalogMemory = rows;
}
export function fandomCatalog(): FandomMaterial[] {
  return [
    ...new Map(
      [
        ...BUILTIN_FANDOMS,
        ...catalogMemory.filter((item) => item?.roleTag && item?.workTag && Array.isArray(item.aliases)),
      ].map((item) => [item.id, item]),
    ).values(),
  ];
}
export async function saveFandomIdentity(
  input: Pick<FandomMaterial, 'name' | 'roleTag' | 'workTag' | 'franchise' | 'medium'>,
) {
  await loadFandomCatalog();
  const roleTag = input.roleTag.trim().replace(/_/g, ' '),
    workTag = input.workTag.trim().replace(/_/g, ' ');
  if (!input.name.trim() || !roleTag || !workTag || /[,，\r\n<>\u3400-\u9fff]/.test(roleTag + workTag))
    throw new Error('请填写中文名、英文角色标签和英文作品标签；不要填写整串外貌');
  const item: FandomMaterial = {
    ...input,
    name: input.name.trim(),
    franchise: input.franchise.trim() || workTag,
    roleTag,
    workTag,
    id: 'identity:' + roleTag + ':' + workTag,
    tags: `${roleTag}, ${workTag}`,
    aliases: [input.name.trim(), roleTag, input.franchise, workTag],
    nsfw: 0,
  };
  const all = fandomCatalog();
  const at = all.findIndex((x) => x.id === item.id);
  if (at < 0) all.push(item);
  else all[at] = item;
  if (all.length > 100000) throw new Error('角色目录已达上限');
  await persistCatalog(all);
  return item;
}
export function exportFandomCatalog() {
  return JSON.stringify(fandomCatalog(), null, 2);
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
  if (quote) throw new Error('CSV 引号没有闭合，未导入');
  return rows;
}
export async function importFandomCatalog(text: string): Promise<number> {
  await loadFandomCatalog();
  const merged = new Map(fandomCatalog().map((x) => [x.id, x]));
  let inputs: Array<Partial<FandomMaterial>>;
  if (text.trim().startsWith('[')) inputs = JSON.parse(text);
  else {
    const rows = parseCsv(text.replace(/^\uFEFF/, '')),
      header = rows.shift() ?? [];
    const character = header.indexOf('character'),
      copyright = header.indexOf('copyright');
    if (character < 0 || copyright < 0)
      throw new Error('CSV 需要 character、copyright 列，可使用 Animadex 官方导出文件');
    inputs = rows.map((row) => ({
      name: row[character]?.replace(/_/g, ' '),
      roleTag: row[character]?.replace(/_/g, ' '),
      workTag: row[copyright]?.replace(/_/g, ' '),
      franchise: row[copyright]?.replace(/_/g, ' '),
      medium: '未分类',
    }));
  }
  if (!Array.isArray(inputs) || inputs.length > 100000) throw new Error('角色文件格式或数量不正确');
  for (const x of inputs) {
    if (
      typeof x.name !== 'string' ||
      !x.name.trim() ||
      typeof x.roleTag !== 'string' ||
      !x.roleTag.trim() ||
      typeof x.workTag !== 'string' ||
      !x.workTag.trim() ||
      /[,，\r\n<>\u3400-\u9fff]/.test(x.roleTag + x.workTag)
    )
      throw new Error('文件含无效角色标签，未导入');
    const work = works.find((w) => w[0] === x.workTag);
    const id = 'identity:' + x.roleTag + ':' + x.workTag;
    const old = merged.get(id);
    if (!old)
      merged.set(id, {
        id,
        name: x.name,
        roleTag: x.roleTag,
        workTag: x.workTag,
        tags: `${x.roleTag}, ${x.workTag}`,
        franchise: work?.[1] ?? x.franchise ?? x.workTag,
        medium: work?.[2] ?? x.medium ?? '未分类',
        aliases: [x.name, x.roleTag, x.workTag],
        nsfw: 0,
      });
  }
  if (merged.size > 100000) throw new Error('合并后角色超过上限');
  await persistCatalog([...merged.values()]);
  return inputs.length;
}
