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
export function step(map: RegionMap, pos: Vec2, dx: number, dy: number): Vec2 {
  if (dx === 0 && dy === 0) return pos;
  const len = Math.hypot(dx, dy);
  const dist = PLAYER_SPEED * TICK_SECONDS;
  const mx = (dx / len) * dist;
  const my = (dy / len) * dist;

  let x = pos.x;
  let y = pos.y;
  if (!collides(map, x + mx, y)) x += mx;
  if (!collides(map, x, y + my)) y += my;
  return { x, y };
}

export function collides(map: RegionMap, x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  return (
    isBlocking(tileAt(map, x - r, y - r)) ||
    isBlocking(tileAt(map, x + r, y - r)) ||
    isBlocking(tileAt(map, x - r, y + r)) ||
    isBlocking(tileAt(map, x + r, y + r))
  );
}

/**
 * Where a player who walked off an edge through `side`, at `at`, lands in the
 * neighbour `to`: at the same point along the edge, just inside it, so the two
 * regions read as one stretch of ground. Falls back to the road's entry when
 * that spot is blocked; undefined when `to` has no way back.
 */
export function arrivalPoint(to: RegionMap, side: Side, at: Vec2): Vec2 | undefined {
  const entry = to.entries[OPPOSITE[side]];
  if (!entry) return undefined;
  const spot = side === 'east' || side === 'west'
    ? { x: entry.x, y: Math.max(1, Math.min(to.height - 1, at.y)) }
    : { x: Math.max(1, Math.min(to.width - 1, at.x)), y: entry.y };
  return collides(to, spot.x, spot.y) ? { ...entry } : spot;
}
