/** A scene survives prompt edits. Text offsets are owned by the source parser. */
export interface ScenePlan {
  id: string;
  quote: string;
  summary: string;
  reason: string;
  focus: string;
  mustShow: string;
  distance: string;
  angle: string;
  timeline: string;
  warnings: string[];
}

export const SHOT_TAGS: Record<string, string> = {
  close: 'close-up', upper: 'upper body', medium: 'cowboy shot', full: 'full body', wide: 'wide shot',
};
export const ANGLE_TAGS: Record<string, string> = {
  front: 'from front', side: 'from side', behind: 'from behind', above: 'from above',
  below: 'from below', shoulder: 'over shoulder', pov: 'pov',
};
const plain = (v: unknown, max = 600) => typeof v === 'string' ? v.replace(/[<>]/g, '').trim().slice(0, max) : '';
export function readScene(value: unknown): ScenePlan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  return {
    id: /^[a-zA-Z0-9_-]{1,100}$/.test(String(v.id ?? '')) ? String(v.id) : '',
    quote: plain(v.quote, 2000), summary: plain(v.summary), reason: plain(v.reason),
    focus: plain(v.focus), mustShow: plain(v.mustShow),
    distance: Object.hasOwn(SHOT_TAGS, String(v.distance)) ? String(v.distance) : '',
    angle: Object.hasOwn(ANGLE_TAGS, String(v.angle)) ? String(v.angle) : '',
    timeline: /^memory:P\d+$/.test(String(v.timeline)) ? String(v.timeline) : 'main',
    warnings: Array.isArray(v.warnings) ? v.warnings.map(x => plain(x)).filter(Boolean).slice(0, 16) : [],
  };
}
export function sceneId(): string {
  return 'scene_' + crypto.randomUUID().replaceAll('-', '');
}
export function readPlacement(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== 'object') return;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
  return { x: Math.max(0.1, Math.min(0.9, x)), y: Math.max(0.1, Math.min(0.9, y)) };
}
/** Only the scene's explicit camera choices are compiled; no automatic blur/style. */
export function composeCamera(tag: string, scene?: ScenePlan): string {
  if (!scene) return tag;
  const shot = /^(?:close-up|upper body|cowboy shot|full body|wide shot|medium shot|portrait|lower body)$/i;
  const angle = /^(?:from front|from side|from behind|from above|from below|over shoulder|pov)$/i;
  return [...new Set([
    ...tag.split(',').map(t => t.trim()).filter(t => t && !(scene.distance && shot.test(t.replaceAll('_', ' '))) && !(scene.angle && angle.test(t.replaceAll('_', ' ')))),
    SHOT_TAGS[scene.distance], ANGLE_TAGS[scene.angle],
  ].filter(Boolean))].join(', ');
}
