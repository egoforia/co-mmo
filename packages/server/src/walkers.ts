import { TICK_RATE, TICK_SECONDS, collides, isBlocking, outsideSide, tileAt, type RegionMap, type Tile } from '@co-mmo/shared';

// How creatures and people move about a region: stepping toward a point,
// strolling near a spot, running from someone, and finding a way around
// walls and trees to somewhere farther off. The region decides where each
// wants to go (creature-brain.ts, townsfolk.ts); this only moves them there.

type Spot = { x: number; y: number };

/** Anything that strolls about a home spot: creatures and NPCs. */
export interface Walker {
  x: number;
  y: number;
  home: Spot;
  /** Where it is strolling to. */
  target: Spot | null;
  /** Ticks to rest before choosing the next spot. */
  rest: number;
}

/** Steps toward a point, sliding along walls. True once it arrives. */
export function moveToward(map: RegionMap, w: Spot, tx: number, ty: number, speed: number): boolean {
  const dx = tx - w.x;
  const dy = ty - w.y;
  const dist = Math.hypot(dx, dy);
  const len = speed * TICK_SECONDS;
  if (dist <= len) {
    if (!collides(map, tx, ty)) {
      w.x = tx;
      w.y = ty;
    }
    return true;
  }
  const nx = w.x + (dx / dist) * len;
  const ny = w.y + (dy / dist) * len;
  if (!collides(map, nx, w.y)) w.x = nx;
  if (!collides(map, w.x, ny)) w.y = ny;
  return false;
}

/** Steps straight away from a point, sliding along walls and staying inside the region. */
export function moveAway(map: RegionMap, w: Spot, fx: number, fy: number, speed: number): void {
  const dx = w.x - fx;
  const dy = w.y - fy;
  const dist = Math.hypot(dx, dy) || 1;
  const len = speed * TICK_SECONDS;
  const nx = w.x + (dx / dist) * len;
  const ny = w.y + (dy / dist) * len;
  if (!outsideSide(map, nx, w.y) && !collides(map, nx, w.y)) w.x = nx;
  if (!outsideSide(map, w.x, ny) && !collides(map, w.x, ny)) w.y = ny;
}

/** Strolls between spots near `around` (home unless said), resting in between. */
export function wander(map: RegionMap, w: Walker, speed: number, radius: number, random: () => number, around: Spot = w.home): void {
  if (!w.target) {
    if (w.rest-- > 0) return;
    for (let tries = 0; tries < 5 && !w.target; tries++) {
      const angle = random() * Math.PI * 2;
      const dist = 1 + random() * Math.max(0, radius - 1);
      const t = { x: around.x + Math.cos(angle) * dist, y: around.y + Math.sin(angle) * dist };
      if (!outsideSide(map, t.x, t.y) && !collides(map, t.x, t.y)) w.target = t;
    }
    if (!w.target) w.rest = TICK_RATE;
    return;
  }
  const before = { x: w.x, y: w.y };
  if (moveToward(map, w, w.target.x, w.target.y, speed)) {
    w.target = null;
    w.rest = Math.floor(TICK_RATE * (1 + random() * 3));
  } else if (w.x === before.x && w.y === before.y) {
    w.target = null;
    w.rest = TICK_RATE;
  }
}

/** The farthest a path is searched for, in tiles walked; beyond it walkers go straight and slide. */
const MAX_PATH_TILES = 16384;

/**
 * A way from one point to another around anything in the way, as tile
 * centres to walk through ending at `to`, or undefined when there is none.
 * Turns only where the way bends, so walkers cut no corners into walls.
 */
export function findPath(map: RegionMap, from: Spot, to: Spot): Spot[] | undefined {
  const w = map.width;
  const h = map.height;
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !isBlocking(tileAt(map, x, y) as Tile) && !collides(map, x + 0.5, y + 0.5);
  const start = Math.floor(from.y) * w + Math.floor(from.x);
  const goalX = Math.floor(to.x);
  const goalY = Math.floor(to.y);
  if (!open(goalX, goalY)) return undefined;
  const goal = goalY * w + goalX;
  const came = new Int32Array(w * h).fill(-1);
  came[start] = start;
  const queue = [start];
  for (let i = 0; i < queue.length && i < MAX_PATH_TILES; i++) {
    const at = queue[i]!;
    if (at === goal) break;
    const x = at % w;
    const y = (at - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = (y + dy) * w + (x + dx);
      if (!open(x + dx, y + dy) || came[n] !== -1) continue;
      came[n] = at;
      queue.push(n);
    }
  }
  if (came[goal] === -1) return undefined;
  const tiles: number[] = [];
  for (let at = goal; at !== start; at = came[at]!) tiles.push(at);
  tiles.reverse();
  const spots: Spot[] = [];
  let dir = '';
  let prev = start;
  for (const t of tiles) {
    const d = `${(t % w) - (prev % w)},${Math.floor(t / w) - Math.floor(prev / w)}`;
    // Keep the tile before each bend, so the walker turns on the tile's centre.
    if (dir && d !== dir) spots.push({ x: (prev % w) + 0.5, y: Math.floor(prev / w) + 0.5 });
    dir = d;
    prev = t;
  }
  spots.push({ x: to.x, y: to.y });
  return spots;
}

/**
 * Up to `count` walkable spots around a point, nearest first, at least a
 * tile apart, for placing wished things.
 */
export function findSpots(map: RegionMap, x: number, y: number, count: number, min = 1.5, max = 4): Spot[] {
  const spots: Spot[] = [];
  for (let r = min; r <= max && spots.length < count; r += 0.75) {
    for (let a = 0; a < 12 && spots.length < count; a++) {
      const angle = (a / 12) * Math.PI * 2 + r;
      const s = { x: Math.round((x + Math.cos(angle) * r) * 2) / 2, y: Math.round((y + Math.sin(angle) * r) * 2) / 2 };
      if (outsideSide(map, s.x, s.y) || collides(map, s.x, s.y)) continue;
      if (spots.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 1)) continue;
      spots.push(s);
    }
  }
  return spots;
}

/** The nearest tile of these kinds within a radius of a point (tile coordinates). */
export function nearestTile(map: RegionMap, x: number, y: number, kinds: Tile[], radius: number): { tile: Tile; x: number; y: number } | undefined {
  let best: { tile: Tile; x: number; y: number } | undefined;
  let bestD = Infinity;
  const r = Math.ceil(radius);
  for (let ty = Math.floor(y) - r; ty <= Math.floor(y) + r; ty++) {
    for (let tx = Math.floor(x) - r; tx <= Math.floor(x) + r; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      const tile = tileAt(map, tx, ty);
      if (!kinds.includes(tile)) continue;
      // Distance from the player to the closest point of the tile.
      const d = Math.hypot(Math.max(tx - x, 0, x - (tx + 1)), Math.max(ty - y, 0, y - (ty + 1)));
      if (d <= radius && d < bestD) {
        bestD = d;
        best = { tile, x: tx, y: ty };
      }
    }
  }
  return best;
}
