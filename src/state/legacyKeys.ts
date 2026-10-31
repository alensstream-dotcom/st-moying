/**
 * 旧键名迁移。
 *
 * 插件以前叫别的名字，本地存了一堆 baibai_image* 的键（角色 tag、自定义素材、
 * 氛围词、后台待续跑队列）。改名之后这些键不再被读，等于用户的白白丢光。
 *
 * 这里做「复制不删」：旧键原样留着，新键缺失时才写入拷贝。这样即使别的插件
 * 还认旧键，也不会因为我删了而坏掉；而本插件只读新键。
 *
 * 注意 baibai_api_channels / baibai_exclude_settings 不在迁移范围：那是几个
 * 「柏宝」插件之间的共享协议键，改名会直接断开共享。
 */

const LEGACY_PREFIX = 'baibai_image';
const CURRENT_PREFIX = 'moying_image';

let migrated = false;

/** 把旧前缀的 localStorage 键复制成新前缀。可重复调用，只做一次。 */
export function migrateLegacyLocalKeys(): void {
  if (migrated) return;
  migrated = true;
  try {
    const storage = typeof localStorage === 'undefined' ? null : localStorage;
    if (!storage) return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(LEGACY_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const next = CURRENT_PREFIX + key.slice(LEGACY_PREFIX.length);
      const value = storage.getItem(key);
      if (value === null || storage.getItem(next) !== null) continue;
      storage.setItem(next, value);
    }
  } catch {
    // 存储不可用（隐私模式 / 配额满）时静默跳过：迁移失败不该挡住插件启动
  }
}
