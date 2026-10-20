import { PLAYER_RADIUS, PLAYER_SPEED, TICK_SECONDS } from './constants.ts';
import { OPPOSITE, isBlocking, tileAt, type RegionMap, type Side } from './world.ts';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Advances a position by one tick of input. Shared by the server (which is
 * authoritative) and the client (which predicts its own movement with it).
 * Axes are resolved separately so players slide along walls.
 */
export function step(map: RegionMap, pos: Vec2, dx: number, dy: number, floor = 0): Vec2 {
  if (dx === 0 && dy === 0) return pos;
  const len = Math.hypot(dx, dy);
  const dist = PLAYER_SPEED * TICK_SECONDS;
  const mx = (dx / len) * dist;
  const my = (dy / len) * dist;

  let x = pos.x;
  let y = pos.y;
  if (!collides(map, x + mx, y, floor)) x += mx;
  if (!collides(map, x, y + my, floor)) y += my;
  return { x, y };
}

/** True when a body standing at (x, y) on a floor (the ground unless said) would touch something solid. */
export function collides(map: RegionMap, x: number, y: number, floor = 0): boolean {
  const r = PLAYER_RADIUS;
  return (
    isBlocking(tileAt(map, x - r, y - r, floor)) ||
    isBlocking(tileAt(map, x + r, y - r, floor)) ||
    isBlocking(tileAt(map, x - r, y + r, floor)) ||
    isBlocking(tileAt(map, x + r, y + r, floor))
  );
}

/**
 * Where a player who walked off an edge through `side`, at `at`, lands in the
 * neighbour `to`: exactly where that step took them, counted from the
 * neighbour's corner, so the two regions read as one stretch of ground and
 * nobody jumps. Falls back to the road's entry when that spot is blocked;
 * undefined when `to` has no way back.
 */
export function arrivalPoint(to: RegionMap, side: Side, at: Vec2): Vec2 | undefined {
  const entry = to.entries[OPPOSITE[side]];
  if (!entry) return undefined;
  // Regions are the same size; keep the spot just inside the edge it came through.
  const inside = (v: number, size: number) => Math.max(0.001, Math.min(size - 0.001, v));
  const spot = {
    x: inside(side === 'west' ? at.x + to.width : side === 'east' ? at.x - to.width : at.x, to.width),
    y: inside(side === 'north' ? at.y + to.height : side === 'south' ? at.y - to.height : at.y, to.height),
  };
  return collides(to, spot.x, spot.y) ? { ...entry } : spot;
}
