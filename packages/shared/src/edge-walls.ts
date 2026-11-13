import type { RegionMap } from './world.ts';

// Walls along one side of a tile (the world editor's Wall tool): thin
// upright walls standing on the line between two tiles, not filling either.
// Both tiles stay open ground; only crossing the line is stopped. A side is
// kept as the edge it stands on, so the north side of one tile and the south
// side of the tile above it are the same wall.

/** A side of a tile. */
export type WallSide = 'north' | 'east' | 'south' | 'west';

/** The sides, turning clockwise from north (the editor's R key goes round them in this order). */
export const WALL_SIDES: readonly WallSide[] = ['north', 'east', 'south', 'west'];

/** How tall a wall stands: a full storey, or half of one. */
export type WallHeight = 'full' | 'half';

/** The heights a wall may stand, in the editor's words. */
export const WALL_HEIGHTS: Record<WallHeight, string> = { full: 'A storey high', half: 'Half a storey' };

/**
 * A wall standing on one edge of the tile grid: `along` 'h' runs east from
 * (x, y) to (x + 1, y), the line between tiles (x, y - 1) and (x, y); 'v' runs
 * south from (x, y) to (x, y + 1), between tiles (x - 1, y) and (x, y).
 */
export interface EdgeWall {
  /** The wall edit that stood it. */
  id: string;
  x: number;
  y: number;
  floor: number;
  along: 'h' | 'v';
  /** The building look its face is painted in (a key of BUILDING_STYLES). */
  style: string;
  height: WallHeight;
}

/** Half how thick a wall is, in tiles: a body is stopped this far from its line. */
export const WALL_HALF_THICKNESS = 0.08;

/** The edge a side of a tile stands on. */
export function edgeOf(x: number, y: number, side: WallSide): { x: number; y: number; along: 'h' | 'v' } {
  if (side === 'north') return { x, y, along: 'h' };
  if (side === 'south') return { x, y: y + 1, along: 'h' };
  if (side === 'west') return { x, y, along: 'v' };
  return { x: x + 1, y, along: 'v' };
}

/** The side after `side`, turning clockwise (`turn` 1) or back (-1). */
export function turnSide(side: WallSide, turn: 1 | -1 = 1): WallSide {
  return WALL_SIDES[(WALL_SIDES.indexOf(side) + turn + WALL_SIDES.length) % WALL_SIDES.length]!;
}

const key = (floor: number, along: 'h' | 'v', x: number, y: number) => `${floor}|${along}|${x}|${y}`;

/** Each land's walls by edge, made when first asked for and dropped when its walls change. */
const indexes = new WeakMap<RegionMap, Map<string, EdgeWall>>();

function index(map: RegionMap): Map<string, EdgeWall> {
  let found = indexes.get(map);
  if (!found) {
    found = new Map((map.edgeWalls ?? []).map((w) => [key(w.floor, w.along, w.x, w.y), w]));
    indexes.set(map, found);
  }
  return found;
}

/** The wall standing on a side of a tile of a floor, if any. */
export function wallOn(map: RegionMap, x: number, y: number, side: WallSide, floor = 0): EdgeWall | undefined {
  if (!map.edgeWalls?.length) return undefined;
  const e = edgeOf(x, y, side);
  return index(map).get(key(floor, e.along, e.x, e.y));
}

/** Stands a wall on a side of a tile, in place of any already on that edge. */
export function standWall(map: RegionMap, wall: Omit<EdgeWall, 'x' | 'y' | 'along'>, x: number, y: number, side: WallSide): void {
  const e = edgeOf(x, y, side);
  takeDownWall(map, x, y, side, wall.floor);
  (map.edgeWalls ??= []).push({ ...wall, ...e });
  indexes.delete(map);
}

/** Takes away the wall on a side of a tile, if there is one; true when one went. */
export function takeDownWall(map: RegionMap, x: number, y: number, side: WallSide, floor = 0): boolean {
  const there = wallOn(map, x, y, side, floor);
  if (!there) return false;
  map.edgeWalls = map.edgeWalls!.filter((w) => w !== there);
  indexes.delete(map);
  return true;
}

/** True when a body of half-width `r` standing at (x, y) on a floor would touch a wall on a tile's side. */
export function touchesEdgeWall(map: RegionMap, x: number, y: number, floor: number, r: number): boolean {
  if (!map.edgeWalls?.length) return false;
  const walls = index(map);
  const reach = r + WALL_HALF_THICKNESS;
  // Walls running east-west whose line is within reach, along the columns the body spans.
  for (let ey = Math.ceil(y - reach); ey <= Math.floor(y + reach); ey++) {
    if (Math.abs(y - ey) >= reach) continue;
    for (let ex = Math.floor(x - r); ex <= Math.floor(x + r); ex++) if (walls.has(key(floor, 'h', ex, ey))) return true;
  }
  // Walls running north-south, along the rows the body spans.
  for (let ex = Math.ceil(x - reach); ex <= Math.floor(x + reach); ex++) {
    if (Math.abs(x - ex) >= reach) continue;
    for (let ey = Math.floor(y - r); ey <= Math.floor(y + r); ey++) if (walls.has(key(floor, 'v', ex, ey))) return true;
  }
  return false;
}

/** True when a wall stands between tile (x, y) and its neighbour one step (dx, dy) away, on a floor. */
export function wallBetween(map: RegionMap, x: number, y: number, dx: number, dy: number, floor = 0): boolean {
  if (!map.edgeWalls?.length) return false;
  const side: WallSide = dx > 0 ? 'east' : dx < 0 ? 'west' : dy > 0 ? 'south' : 'north';
  return Boolean(wallOn(map, x, y, side, floor));
}
