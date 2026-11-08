import type { Garment } from './sceneState';
import type { NaiVibe } from './settings';

export type VisualSetting = 'auto' | 'xianxia' | 'historical' | 'modern' | 'modern_retro' | 'scifi' | 'western_fantasy';
export type VisualScope = 'appearance' | 'outfit' | 'style' | 'all';
export interface WorldVisualProfile {
  v: 1;
  setting: VisualSetting;
  wardrobeDefaults: string;
  visualStyle: string;
  characterStylingDefaults: string;
  forbiddenByDefault: string[];
  provenance: string;
}
export interface VisualMaterial {
  id: string;
  version: number;
  kind: 'character' | 'outfit' | 'style';
  name: string;
  aliases: string[];
  work: string;
  variant: string;
  settings: VisualSetting[];
  categories: string[];
  appearance: Record<string, string>;
  garments: Garment[];
  style: string;
  tags: string;
  previewPath: string;
  source: string;
  verified: boolean;
  createdAt: number;
  updatedAt: number;
  /** An existing real Vibe snapshot. Shared-reference capability, not separate face locking. */
  vibe?: NaiVibe;
}
export interface VisualBinding {
  materialId: string;
  version: number;
  scope: VisualScope;
  materialSeed: number;
  effectivePosition: { floor: number; line: number };
  resolved: VisualMaterial;
  reason: string;
}
