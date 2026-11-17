import type { RegionMap, SafeArea } from './world.ts';

// Safe areas (combat decisions, step 5): round places where no player can
// hurt another, and monsters give up the chase at the edge. Every land has
// one round the square where travellers arrive, and the whole Sanctum is
// safe; the world editor's Safe area tool lays more or takes them away
// (world-edits/kinds/safe.ts), and the land keeps them.

/** How far the safe area round a land's arrival square reaches, in tiles. */
export const SAFE_RADIUS = 8;
/** The most a safe area the editor lays may reach, in tiles. */
export const MAX_SAFE_RADIUS = 40;

/** What a player reads stepping in and out of one. */
export const SAFE_IN = 'You are in a safe area. No one can hurt you here.';
export const SAFE_OUT = 'You leave the safe area. Other players can attack you out here.';

/** A land's safe areas: those the editor laid, or the land's own. */
export function safeAreas(map: Pick<RegionMap, 'def' | 'spawn' | 'width' | 'height' | 'safe'>): SafeArea[] {
  if (map.safe) return map.safe;
  // The Sanctum is safe from edge to edge.
  const radius = map.def.id === 'sanctum' ? Math.hypot(map.width, map.height) : SAFE_RADIUS;
  return [{ x: map.spawn.x, y: map.spawn.y, radius }];
}

/** True when a point stands in a safe area. */
export function isSafe(map: Pick<RegionMap, 'def' | 'spawn' | 'width' | 'height' | 'safe'>, x: number, y: number): boolean {
  return safeAreas(map).some((a) => Math.hypot(x - a.x, y - a.y) <= a.radius);
}
