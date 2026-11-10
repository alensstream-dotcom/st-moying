/** 新衣橱替代旧长句模板；旧个人收藏只保存在归档备份中。 */
import { BUILTIN_SUITS, SUIT_CATEGORIES } from './materialLibrary';
import type { WardrobeCategory } from './loreTypes';
export const WARDROBE_CATEGORIES: WardrobeCategory[] = SUIT_CATEGORIES.map(([id, label]) => ({ id, label }));
export const WARDROBE_ITEMS = BUILTIN_SUITS;
