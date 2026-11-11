import { setOn } from '../floors.ts';
import { Tile, isBlocking, set, tileAt, type Building, type Landmark, type RegionMap } from '../world.ts';
import { thingById } from './names.ts';
import type { EditPlace, TilePoint } from './types.ts';

// Reading a land for the edit kinds: what stands on a tile, which tiles a
// set piece covers, and which tiles an edit may lay things on.
// Functions, not sets: world.ts and the edits load each other, so Tile is not there yet when these modules first run.

/** Said when an edit reaches past the land. */
export const OFF_EDGE = 'That spot is off the edge of this land.';

/** True when `p` is a whole tile inside the land. */
export function inside(map: RegionMap, p: unknown): p is TilePoint {
  return Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n)) && p[0] >= 0 && p[1] >= 0 && p[0] < map.width && p[1] < map.height;
}

export function tileOf(map: RegionMap, [x, y]: TilePoint): Tile {
  return map.tiles[y * map.width + x] as Tile;
}

/** The tile on a floor; off every storey a floor above or below is solid. */
export function tileOn(map: RegionMap, [x, y]: TilePoint, floor = 0): Tile {
  return floor ? tileAt(map, x, y, floor) : tileOf(map, [x, y]);
}

/** The floor an edit works on: the ground when it names none. */
export function floorOf(place: EditPlace): number {
  return place.level ?? 0;
}

/** Tiles a move can pick up. */
export function movable(t: Tile): boolean {
  return t === Tile.Tree || t === Tile.Rock || t === Tile.Water;
}

/** Tiles that belong to a building or lie under a set piece, which only a house or a move lays. */
export function built(t: Tile): boolean {
  return t === Tile.Wall || t === Tile.Floor || t === Tile.Door || t === Tile.Blocked;
}

/** Tiles a set piece may stand on: open ground, paths and floors. */
export function open(t: Tile): boolean {
  return !isBlocking(t) && t !== Tile.Door && t !== Tile.Bridge;
}

/** The tiles a set piece covers, from its bottom-left tile up and to the right. */
export function pieceTiles(at: TilePoint, footprint: { width: number; height: number }): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) tiles.push([at[0] + dx, at[1] - dy]);
  return tiles;
}

/** The tiles a landmark's footprint blocks (see block() in world.ts). */
export function footprint(l: Landmark): { left: number; top: number; width: number; height: number } {
  const left = Math.floor(l.x - l.footprint.width / 2);
  const bottom = Math.floor(l.y - 0.01);
  return { left, top: bottom - l.footprint.height + 1, width: l.footprint.width, height: l.footprint.height };
}

/** The set piece (or piece of furniture) standing on a tile of a floor, the one drawn in front first. */
export function landmarkAt(map: RegionMap, [x, y]: TilePoint, floor = 0): Landmark | undefined {
  for (let i = map.landmarks.length - 1; i >= 0; i--) {
    if ((map.landmarks[i]!.floor ?? 0) !== floor) continue;
    const f = footprint(map.landmarks[i]!);
    if (x >= f.left && x < f.left + f.width && y >= f.top && y < f.top + f.height) return map.landmarks[i];
  }
  return undefined;
}

/** The set piece an edit points at: by name when it gives one, else the one on its tile and floor. */
export function landmarkFor(map: RegionMap, edit: EditPlace & { at?: TilePoint; from?: TilePoint }): Landmark | undefined {
  if (edit.target) {
    const named = thingById(map, edit.target);
    return named?.kind === 'landmark' ? named.thing : undefined;
  }
  const at = edit.at ?? edit.from;
  return at ? landmarkAt(map, at, floorOf(edit)) : undefined;
}

/** The building an edit points at: by name when it gives one, else the one over its tile. */
export function buildingFor(map: RegionMap, edit: EditPlace & { at: TilePoint }): Building | undefined {
  if (edit.target) {
    const named = thingById(map, edit.target);
    return named?.kind === 'building' ? named.thing : undefined;
  }
  return buildingAt(map, edit.at);
}

/** The building whose walls stand over a tile. */
export function buildingAt(map: RegionMap, [x, y]: TilePoint): Building | undefined {
  return map.buildings.find((b) => x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height);
}

/** True when a tile is on a building's floor, inside its walls. */
export function onFloor(map: RegionMap, x: number, y: number): boolean {
  return map.buildings.some((b) => x > b.x && x < b.x + b.width - 1 && y > b.y && y < b.y + b.height - 1);
}

/** True when two tile rectangles share a tile. */
export function overlaps(a: { x: number; y: number; width: number; height: number }, b: Pick<Building, 'x' | 'y' | 'width' | 'height'>): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Puts back what lies under a set piece: open ground, or floor indoors and on every floor off the ground. */
export function clearUnder(map: RegionMap, f: { left: number; top: number; width: number; height: number }, floor = 0): void {
  for (let y = f.top; y < f.top + f.height; y++) {
    for (let x = f.left; x < f.left + f.width; x++) {
      if (floor) setOn(map, floor, x, y, Tile.Floor);
      else set(map, x, y, onFloor(map, x, y) ? Tile.Floor : Tile.Ground);
    }
  }
}
