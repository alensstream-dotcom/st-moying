import { applySceneEvents, restoreVisualSeeds, type SceneEvent, type SceneState } from '@/state/sceneState';
import { cloneVisual, fillWorldDefaults } from '@/state/visualDesign';
import type { VisualMaterial, WorldVisualProfile } from '@/state/visualTypes';
import { fillDirectedVisuals, type VisualDirection } from './visualDirector';

/** New-protocol-only characters also get deterministic era defaults, at their introduction. */
export function withIntroductionDefaults(before: SceneState, events: SceneEvent[], world: WorldVisualProfile,
  materials: VisualMaterial[], scope: string, revision: string, floor: number, previous: SceneEvent[] = [], direction?: VisualDirection): SceneEvent[] {
  const result = cloneVisual(events);
  // Re-analysis of the identical source must keep its first accepted visual design.
  for (const event of result.filter(e => e.kind === 'identity')) {
    if (before.characters.some(c => c.name === event.name && c.work === (event.work ?? ''))) continue;
    const seed = previous.find(e => e.kind === 'defaults' && e.name === event.name && (e.work ?? '') === (event.work ?? ''))?.designSeed;
    if (seed) event.appearance = cloneVisual(seed.baseAppearance);
  }
  for (const line of [...new Set(events.filter(e => e.kind === 'identity').map(e => e.sourceLine))].sort((a, b) => a - b)) {
    const scene = applySceneEvents(before, result, scope, revision, floor, line);
    const prior = cloneVisual(scene);
    for (const event of previous.filter(e => e.kind === 'defaults' && e.sourceLine <= line && e.designSeed)) {
      if (scene.characters.some(c => c.characterId === event.designSeed!.characterId)) restoreVisualSeeds(scene, [event.designSeed!]);
    }
    if (direction) fillDirectedVisuals(scene, direction, materials, floor, line);
    fillWorldDefaults(scene, world, materials, floor, line);
    for (const character of scene.characters) {
      const original = prior.characters.find(c => c.characterId === character.characterId)!;
      const newcomer = !before.characters.some(c => c.characterId === character.characterId);
      if (!newcomer && JSON.stringify([original.outfit, original.baseAppearance, original.provenance]) === JSON.stringify([character.outfit, character.baseAppearance, character.provenance])) continue;
      result.push({ kind: 'defaults', name: character.name, characterId: character.characterId, work: character.work,
        sourceLine: line, evidence: '程序按世界观补全的视觉设计，非剧情事实', designSeed: cloneVisual(character) });
    }
  }
  return result.sort((a, b) => a.sourceLine - b.sourceLine);
}
