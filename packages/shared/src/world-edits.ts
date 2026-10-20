import { BUILDING_STYLES } from './buildings.ts';
import { hashString, rand2 } from './random.ts';
import { setPiece } from './sea-cave-kit.ts';
import { MAX_FLOORS, buildFloors } from './floors.ts';
import { block, building, isBlocking, road, set, Tile, type Building, type Landmark, type RegionMap } from './world.ts';

// The Owner and Stewards edit the world in the game: move a tree or a set
// piece, paint ground, water, trees and rocks, lay a road, build a house and
// say where monsters live. Each change is a small piece of data kept on its
// land's definition (RegionDef.edits) and laid over the generated land in
// order, the same on the server and in every browser, so an edit is never
// drawn one way and walked another. Taking one out (undo) lays the land out
// again without it.

/** A tile position, x east and y south, from the land's top-left corner. */
export type TilePoint = [x: number, y: number];

/** What the paint brush can lay. Walls, floors and doors come only with a house. */
export type PaintTile = 'ground' | 'path' | 'water' | 'tree' | 'rock';

/** Every kind the brush lays, in the order the editor offers them. */
export const PAINT_TILES: PaintTile[] = ['ground', 'path', 'water', 'tree', 'rock'];

/** The tile a brush kind lays. */
function paintTile(kind: PaintTile): Tile {
  return { ground: Tile.Ground, path: Tile.Path, water: Tile.Water, tree: Tile.Tree, rock: Tile.Rock }[kind];
}

/** An edit as the editor sends it, before the server stamps who made it and when. */
export type WorldEditDraft =
  /** Lays one kind of tile on these tiles; a path over water becomes a bridge. */
  | { kind: 'paint'; tile: PaintTile; tiles: TilePoint[] }
  /** Picks up the set piece, tree or rock at `from` and puts it down at `to`, or takes it away when `to` is null. */
  | { kind: 'move'; from: TilePoint; to: TilePoint | null }
  /** A two-tile road from one tile to another, across then down, bridging water. */
  | { kind: 'road'; from: TilePoint; to: TilePoint }
  /** A walled house: its walls' top-left corner, its floor inside them, and its look (a key of BUILDING_STYLES). */
  | { kind: 'house'; at: TilePoint; floor: [width: number, height: number]; style: string }
  /** Monsters of a kind that live around a spot, and come back there after they fall. */
  | { kind: 'spawn'; creature: string; at: TilePoint; count: number }
  /** Sends away every monster living within `radius` tiles of a spot. */
  | { kind: 'clear'; at: TilePoint; radius: number }
  /** Stands a kit set piece (sea-cave-kit.ts) with its footprint's bottom-left tile at `at`. */
  | { kind: 'piece'; piece: string; at: TilePoint }
  /** Gives the building over `at` floors above and below the ground (floors.ts), joined by stairs or ladders; 0 and 0 takes them off. */
  | { kind: 'floors'; at: TilePoint; up: number; down: number; ladders?: boolean };

/** Who made an edit and when, plus a spawn's name and picture, filled in by the server. */
export interface EditStamp {
  id: string;
  /** The editor's name, for the list of edits. */
  by: string;
  /** When it was made. */
  made: number;
}

/** One saved change to a land. */
export type WorldEdit = WorldEditDraft & EditStamp & { name?: string; asset?: string };

/** Most tiles one brush stroke may paint. */
export const MAX_STROKE = 400;
/** Most monsters one spawn may hold. */
export const MAX_SPAWN = 12;
/** Widest area the clear tool may empty, in tiles. */
export const MAX_CLEAR_RADIUS = 24;
/** Smallest and largest floor a house may have, in tiles. */
export const HOUSE_FLOOR = { min: 2, max: 30 };

/**
 * House floors that fall on whole bays of the building kit (two tiles to a
 * bay, the doorway on a bay of its own), so the isometric camera shows each
 * as a kit house when its look has one.
 */
export const KIT_HOUSE_FLOORS: { name: string; floor: [number, number] }[] = [
  { name: 'Small', floor: [6, 6] },
  { name: 'Medium', floor: [10, 8] },
  { name: 'Large', floor: [14, 10] },
];

/** Where a house whose doorstep (the tile just outside its doorway) is at `doorstep` has its walls' top-left corner. */
export function houseCorner(doorstep: TilePoint, floor: [number, number]): TilePoint {
  // building() puts the doorway at left + floor(width / 2) in the south wall, one row above the doorstep.
  return [doorstep[0] - Math.floor(floor[0] / 2), doorstep[1] - floor[1] - 2];
}

/** Lays a land's edits over it, in order. Edits that no longer fit (the land changed under them) are passed over. */
export function applyEdits(map: RegionMap, edits: readonly WorldEdit[]): void {
  for (const edit of edits) applyEdit(map, edit);
}

/** Lays one edit over a land. */
export function applyEdit(map: RegionMap, edit: WorldEdit): void {
  switch (edit.kind) {
    case 'paint':
      return paint(map, edit.tile, edit.tiles);
    case 'move':
      return move(map, edit.from, edit.to);
    case 'road':
      return road(map, edit.from[0], edit.from[1], edit.to[0], edit.to[1]);
    case 'house':
      return house(map, edit.at, edit.floor, edit.style);
    case 'spawn':
      return spawn(map, edit);
    case 'clear':
      map.creatures = map.creatures.filter((c) => Math.hypot(c.x - edit.at[0] - 0.5, c.y - edit.at[1] - 0.5) > edit.radius);
      return;
    case 'piece':
      return place(map, edit.piece, edit.at);
    case 'floors': {
      const b = buildingAt(map, edit.at);
      if (b) buildFloors(map, b, edit.up, edit.down, edit.ladders ? 'ladder' : 'stairs');
      return;
    }
  }
}

/** The building whose walls stand over a tile. */
export function buildingAt(map: RegionMap, [x, y]: TilePoint): Building | undefined {
  return map.buildings.find((b) => x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height);
}

/**
 * Why an edit cannot be made on this land, in words for the editor, or
 * undefined when it can. `creatures` says which monster kinds exist.
 */
export function checkEdit(map: RegionMap, edit: WorldEditDraft, creatures: Record<string, unknown>): string | undefined {
  const inside = (p: unknown): p is TilePoint =>
    Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n)) && p[0] >= 0 && p[1] >= 0 && p[0] < map.width && p[1] < map.height;
  const off = 'That spot is off the edge of this land.';
  switch (edit.kind) {
    case 'paint':
      if (!PAINT_TILES.includes(edit.tile)) return 'The brush cannot lay that.';
      if (!Array.isArray(edit.tiles) || !edit.tiles.length) return 'Paint at least one tile.';
      if (edit.tiles.length > MAX_STROKE) return `Paint at most ${MAX_STROKE} tiles at a time.`;
      return edit.tiles.every(inside) ? undefined : off;
    case 'move': {
      if (!inside(edit.from) || (edit.to !== null && !inside(edit.to))) return off;
      const piece = landmarkAt(map, edit.from);
      if (!piece && !movable(tileOf(map, edit.from))) return 'There is nothing there to move: pick a tree, a rock, water or a set piece.';
      // Furniture may move about a floor; trees and rocks stay out of buildings.
      const into = edit.to && tileOf(map, edit.to);
      if (into !== null && (into === Tile.Wall || into === Tile.Door || (!piece && built(into)))) return 'That would land inside a building. Pick another spot.';
      return undefined;
    }
    case 'road':
      return inside(edit.from) && inside(edit.to) ? undefined : off;
    case 'house': {
      const style = BUILDING_STYLES[edit.style];
      if (!style) return 'There is no house of that look.';
      const [w, h] = Array.isArray(edit.floor) ? edit.floor : [NaN, NaN];
      if (![w, h].every((n) => Number.isInteger(n) && n >= HOUSE_FLOOR.min && n <= HOUSE_FLOOR.max)) return `A house's floor is ${HOUSE_FLOOR.min} to ${HOUSE_FLOOR.max} tiles a side.`;
      if (!inside(edit.at) || !inside([edit.at[0] + w + 2, edit.at[1] + h + 2])) return 'The house would stand off the edge of this land.';
      const rect = { x: edit.at[0] - 1, y: edit.at[1] - 1, width: w + 4, height: h + 4 };
      if (map.buildings.some((b) => overlaps(rect, b))) return 'Another building stands there. Leave a tile of room around it.';
      return undefined;
    }
    case 'spawn':
      if (typeof edit.creature !== 'string' || !creatures[edit.creature]) return 'There is no monster of that kind.';
      if (!Number.isInteger(edit.count) || edit.count < 1 || edit.count > MAX_SPAWN) return `A spawn holds 1 to ${MAX_SPAWN} monsters.`;
      if (!inside(edit.at)) return off;
      return isBlocking(tileOf(map, edit.at)) ? 'Monsters cannot live there: pick open ground.' : undefined;
    case 'clear':
      if (!inside(edit.at)) return off;
      return typeof edit.radius === 'number' && edit.radius > 0 && edit.radius <= MAX_CLEAR_RADIUS ? undefined : `Clear 1 to ${MAX_CLEAR_RADIUS} tiles around.`;
    case 'piece': {
      const piece = typeof edit.piece === 'string' ? setPiece(edit.piece) : undefined;
      if (!piece) return 'There is no set piece of that kind.';
      if (!inside(edit.at)) return off;
      const tiles = pieceTiles(edit.at, piece.footprint);
      if (!tiles.every(inside)) return 'It would stand off the edge of this land.';
      return tiles.every((t) => open(tileOf(map, t))) ? undefined : 'Something already stands there. Pick open ground or a floor.';
    }
    case 'floors': {
      if (!inside(edit.at)) return off;
      const b = buildingAt(map, edit.at);
      if (!b) return 'Click a building to give it floors.';
      const counts = [edit.up, edit.down];
      if (!counts.every((n) => Number.isInteger(n) && n >= 0) || edit.up > MAX_FLOORS.up || edit.down > MAX_FLOORS.down) {
        return `A building has up to ${MAX_FLOORS.up} floors above the ground and ${MAX_FLOORS.down} below.`;
      }
      // Tried on a copy: the stairs need room on every floor they join.
      const copy = { ...map, storeys: [...map.storeys], stairways: [...map.stairways] };
      return buildFloors(copy, b, edit.up, edit.down, edit.ladders ? 'ladder' : 'stairs') ? undefined : 'There is no room for the stairs in this building. Move some furniture, or try a bigger one.';
    }
    default:
      return 'The editor does not know that kind of change.';
  }
}

// Functions, not sets: world.ts and this module load each other, so Tile is not there yet when this module first runs.

/** Tiles a move can pick up. */
function movable(t: Tile): boolean {
  return t === Tile.Tree || t === Tile.Rock || t === Tile.Water;
}

/** Tiles that belong to a building or lie under a set piece, which only a house or a move lays. */
function built(t: Tile): boolean {
  return t === Tile.Wall || t === Tile.Floor || t === Tile.Door || t === Tile.Blocked;
}

/** Tiles a set piece may stand on: open ground, paths and floors. */
function open(t: Tile): boolean {
  return !isBlocking(t) && t !== Tile.Door && t !== Tile.Bridge;
}

/** The tiles a set piece covers, from its bottom-left tile up and to the right. */
function pieceTiles(at: TilePoint, footprint: { width: number; height: number }): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) tiles.push([at[0] + dx, at[1] - dy]);
  return tiles;
}

/** Stands a set piece, unless its kit is switched off or something took its spot since. */
function place(map: RegionMap, id: string, at: TilePoint): void {
  const piece = setPiece(id);
  if (!piece) return;
  const tiles = pieceTiles(at, piece.footprint);
  if (!tiles.every(([x, y]) => x >= 0 && y >= 0 && x < map.width && y < map.height && open(tileOf(map, [x, y])))) return;
  // Bottom centre of its footprint, as block() and the scene read a landmark.
  const landmark: Landmark = { asset: piece.id, x: at[0] + piece.footprint.width / 2, y: at[1] + 1, footprint: { ...piece.footprint } };
  map.landmarks.push(landmark);
  block(map, landmark.x, landmark.y, piece.footprint.width, piece.footprint.height);
}

function tileOf(map: RegionMap, [x, y]: TilePoint): Tile {
  return map.tiles[y * map.width + x] as Tile;
}

function paint(map: RegionMap, kind: PaintTile, tiles: TilePoint[]): void {
  const tile = paintTile(kind);
  for (const [x, y] of tiles) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    const here = tileOf(map, [x, y]);
    // Buildings and the ground under set pieces are left alone: move or remove those instead.
    if (built(here)) continue;
    set(map, x, y, tile === Tile.Path && (here === Tile.Water || here === Tile.Bridge) ? Tile.Bridge : tile);
  }
}

/** The tiles a landmark's footprint blocks (see block() in world.ts). */
function footprint(l: Landmark): { left: number; top: number; width: number; height: number } {
  const left = Math.floor(l.x - l.footprint.width / 2);
  const bottom = Math.floor(l.y - 0.01);
  return { left, top: bottom - l.footprint.height + 1, width: l.footprint.width, height: l.footprint.height };
}

/** The set piece (or piece of furniture) standing on a tile, the one drawn in front first. */
export function landmarkAt(map: RegionMap, [x, y]: TilePoint): Landmark | undefined {
  for (let i = map.landmarks.length - 1; i >= 0; i--) {
    const f = footprint(map.landmarks[i]!);
    if (x >= f.left && x < f.left + f.width && y >= f.top && y < f.top + f.height) return map.landmarks[i];
  }
  return undefined;
}

/** True when a tile is on a building's floor, inside its walls. */
function onFloor(map: RegionMap, x: number, y: number): boolean {
  return map.buildings.some((b) => x > b.x && x < b.x + b.width - 1 && y > b.y && y < b.y + b.height - 1);
}

function move(map: RegionMap, from: TilePoint, to: TilePoint | null): void {
  const piece = landmarkAt(map, from);
  if (piece) {
    // What lies under a set piece is open ground, or floor indoors.
    const f = footprint(piece);
    for (let y = f.top; y < f.top + f.height; y++) {
      for (let x = f.left; x < f.left + f.width; x++) set(map, x, y, onFloor(map, x, y) ? Tile.Floor : Tile.Ground);
    }
    if (!to) {
      map.landmarks.splice(map.landmarks.indexOf(piece), 1);
      return;
    }
    piece.x += to[0] - from[0];
    piece.y += to[1] - from[1];
    block(map, piece.x, piece.y, piece.footprint.width, piece.footprint.height);
    return;
  }
  const tile = tileOf(map, from);
  if (!movable(tile)) return;
  set(map, from[0], from[1], Tile.Ground);
  if (to && !built(tileOf(map, to))) set(map, to[0], to[1], tile);
}

function house(map: RegionMap, at: TilePoint, floor: [number, number], style: string): void {
  if (!BUILDING_STYLES[style]) return;
  const rect = { x: at[0] - 1, y: at[1] - 1, width: floor[0] + 4, height: floor[1] + 4 };
  if (map.buildings.some((b) => overlaps(rect, b))) return;
  // Set pieces under the new walls and the clearing around them make way.
  map.landmarks = map.landmarks.filter((l) => {
    const f = footprint(l);
    return !overlaps(rect, { x: f.left, y: f.top, width: f.width, height: f.height });
  });
  map.buildings.push(building(map, at[0], at[1], floor[0], floor[1], style));
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: Pick<Building, 'x' | 'y' | 'width' | 'height'>): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Spots for a spawn's monsters, around its middle on open ground, the same wherever it is laid out. */
function spawn(map: RegionMap, edit: WorldEdit & { kind: 'spawn' }): void {
  const seed = hashString(edit.id);
  const taken: TilePoint[] = [];
  for (let i = 0; taken.length < edit.count && i < edit.count * 40; i++) {
    // The first stands right on the spot; the rest spread out to three tiles around it.
    const r = i === 0 ? 0 : 1 + rand2(i, 1, seed) * 2;
    const a = rand2(i, 2, seed) * Math.PI * 2;
    const x = Math.floor(edit.at[0] + 0.5 + Math.cos(a) * r);
    const y = Math.floor(edit.at[1] + 0.5 + Math.sin(a) * r);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height || isBlocking(tileOf(map, [x, y]))) continue;
    if (taken.some(([tx, ty]) => tx === x && ty === y)) continue;
    taken.push([x, y]);
  }
  for (const [x, y] of taken) map.creatures.push({ kind: edit.creature, name: edit.name ?? edit.creature, asset: edit.asset ?? edit.creature, x: x + 0.5, y: y + 0.5 });
}
