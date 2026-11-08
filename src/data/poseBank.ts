import type { PoseCategoryId, PoseEntry } from '@/data/loreTypes';

export interface PoseCategory {
  id: PoseCategoryId;
  label: string;
  hint: string;
  nsfw: 1 | 2 | 3;
}

export const POSE_CATEGORIES: PoseCategory[] = [
  { id: 'foreplay', label: '前戏爱抚', hint: '', nsfw: 2 },
  { id: 'oral', label: '口交深喉', hint: '', nsfw: 2 },
  { id: 'vaginal', label: '正面体位', hint: '', nsfw: 2 },
  { id: 'rear', label: '后入跪趴', hint: '', nsfw: 2 },
  { id: 'ride', label: '骑乘上位', hint: '', nsfw: 2 },
  { id: 'side', label: '侧入抬腿', hint: '', nsfw: 2 },
  { id: 'standing', label: '立位抱起', hint: '', nsfw: 2 },
  { id: 'hand', label: '手交指交', hint: '', nsfw: 2 },
  { id: 'breast', label: '乳交胸推', hint: '', nsfw: 2 },
  { id: 'solo', label: '单人自慰', hint: '', nsfw: 2 },
  { id: 'restraint', label: '束缚调教', hint: '', nsfw: 3 },
  { id: 'climax', label: '高潮瞬间', hint: '', nsfw: 3 },
  { id: 'afterglow', label: '事后余韵', hint: '', nsfw: 2 },
  { id: 'tease', label: '挑逗擦边', hint: '', nsfw: 1 },
  { id: 'pov', label: '第一视角窥视', hint: '', nsfw: 2 },
];

export const POSE_ITEMS: PoseEntry[] = [];
