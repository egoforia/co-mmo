// Finding a way across a region's tiles, for the robot playtester. The bot
// walks from tile centre to tile centre: a centre is open when a player
// standing there collides with nothing, and a diagonal step needs both
// tiles beside it open, so the walk never clips a corner.

import { collides, type RegionMap } from '@co-mmo/shared';

export interface Point {
  x: number;
  y: number;
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** True when a player can stand at the centre of tile (tx, ty). */
export function openTile(map: RegionMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return !collides(map, tx + 0.5, ty + 0.5);
}

/**
 * Tile centres from `from` to the nearest open tile whose centre is within
 * `near` tiles of `to` (the tile holding `to` when `near` is 0), or undefined
 * when no such tile can be reached.
 */
export function findPath(map: RegionMap, from: Point, to: Point, near = 0): Point[] | undefined {
  const w = map.width;
  const start = Math.floor(from.y) * w + Math.floor(from.x);
  const goal = (tx: number, ty: number) =>
    near > 0 ? Math.hypot(tx + 0.5 - to.x, ty + 0.5 - to.y) <= near : tx === Math.floor(to.x) && ty === Math.floor(to.y);
  const came = new Int32Array(w * map.height).fill(-1);
  came[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const tx = at % w;
    const ty = (at - tx) / w;
    if (goal(tx, ty)) return trace(came, at, start, w);
    for (const [dx, dy] of STEPS) {
      const nx = tx + dx;
      const ny = ty + dy;
      const next = ny * w + nx;
      if (!openTile(map, nx, ny) || came[next] !== -1) continue;
      if (dx && dy && !(openTile(map, tx + dx, ty) && openTile(map, tx, ty + dy))) continue;
      came[next] = at;
      queue.push(next);
    }
  }
  return undefined;
}

/** Every open tile a player standing at `from` can walk to. */
export function reachable(map: RegionMap, from: Point): Set<number> {
  const w = map.width;
  const start = Math.floor(from.y) * w + Math.floor(from.x);
  const seen = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const tx = at % w;
    const ty = (at - tx) / w;
    for (const [dx, dy] of STEPS) {
      const next = (ty + dy) * w + tx + dx;
      if (seen.has(next) || !openTile(map, tx + dx, ty + dy)) continue;
      if (dx && dy && !(openTile(map, tx + dx, ty) && openTile(map, tx, ty + dy))) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** True when some open tile within `near` of `to` is in a `reachable` set. */
export function canReach(map: RegionMap, tiles: Set<number>, to: Point, near: number): boolean {
  const r = Math.ceil(near) + 1;
  for (let ty = Math.floor(to.y) - r; ty <= Math.floor(to.y) + r; ty++) {
    for (let tx = Math.floor(to.x) - r; tx <= Math.floor(to.x) + r; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      if (Math.hypot(tx + 0.5 - to.x, ty + 0.5 - to.y) <= near && tiles.has(ty * map.width + tx)) return true;
    }
  }
  return false;
}

function trace(came: Int32Array, end: number, start: number, w: number): Point[] {
  const path: Point[] = [];
  for (let at = end; at !== start; at = came[at]!) path.push({ x: (at % w) + 0.5, y: Math.floor(at / w) + 0.5 });
  return path.reverse();
}
