import { allFandomItems, allWardrobeItems } from '@/data/loreIndex';
import { inferWorld } from './visualDesign';
import type { VisualMaterial } from './visualTypes';

/** Read-through adapter: keep the original library and IDs, never rewrite user data. */
export function loreVisualMaterials(): VisualMaterial[] {
  const base = { version: 1, variant: '', style: '', previewPath: '', verified: false, createdAt: 0, updatedAt: 0 };
  const outfits: VisualMaterial[] = allWardrobeItems().filter(m => m.slot !== 'state').map(m => {
    const setting = inferWorld([m.name, ...m.aliases, m.tags, m.note].join(' '));
    return { ...base, id: `lore_wardrobe:${m.id}`, kind: 'outfit', name: m.name, aliases: m.aliases,
      work: '', categories: [m.category, ...m.aliases], settings: setting === 'auto' || m.slot !== 'full' ? [] : [setting],
      appearance: {}, garments: [{ id: m.slot === 'full' ? 'outer' : m.slot, design: m.tags, state: { location: 'on_body', fastening: 'closed' } }],
      tags: m.tags, previewKey: `wardrobe:${m.id}`, source: '原素材库服装；未标明时代的条目不自动用于世界补全' };
  });
  const characters: VisualMaterial[] = allFandomItems().map(m => ({ ...base,
    id: `lore_fandom:${m.id}`, kind: 'character', name: m.name, aliases: m.aliases, work: m.franchise,
    categories: [], settings: [], appearance: { fandom: m.tags, ...(m.hair ? { hair: m.hair } : {}), ...(m.eyes ? { eyes: m.eyes } : {}) },
    garments: [], tags: m.tags, previewKey: `face:${m.id}`, source: '原素材库同人外貌；不提供性别事实或默认服装状态',
  }));
  return [...outfits, ...characters];
}
