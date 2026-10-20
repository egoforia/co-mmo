import { collides, step } from './movement.ts';
import { Tile, block, isBlocking, set, storeyAt, tileAt, type RegionMap, type TileArt } from './world.ts';

// Floors above and below the ground. The ground is floor 0; a building's
// upper floors are 1, 2... and the floors under it -1, -2... Each floor off
// the ground is a storey: its own tiles over a rectangle of the land (a
// building's footprint, or wider underground). Stairs and ladders join two
// floors next to each other: they take up the same tiles on both, and
// stepping onto them on one floor puts you on the other, at the landing
// beside them. Players, people and creatures all carry the floor they are
// on, and only meet, fight and talk with those on the same floor. Shared, so
// the server and every browser move people between floors alike.

/** A position and the floor it is on. */
export interface Placed {
  x: number;
  y: number;
  floor: number;
}

/** A tile rectangle in the region. */
export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One floor off the ground, over a rectangle of the land. */
export interface Storey extends TileRect {
  /** 1, 2... above the ground; -1, -2... below it. */
  floor: number;
  /** Its tiles, row by row (Tile values); outside them on this floor there is nothing to stand on. */
  tiles: Uint8Array;
  /** Its look: a key of BUILDING_STYLES, whose floor and wall tiles it is drawn in. */
  style: string;
  /** Picture ids drawn instead of the style's tiles (a kit's own pieces). */
  art?: TileArt;
}

/** Stairs anyone can take; a ladder only those with hands to climb it (players and people, not creatures). */
export type StairKind = 'stairs' | 'ladder';

/** Stairs or a ladder between a floor and the one above it. */
export interface Stairway extends TileRect {
  kind: StairKind;
  /** The floor it goes up from, and the one above (always one more). */
  lower: number;
  upper: number;
  /** Where you step off on the lower floor and on the upper one: beside it, never on it. */
  bottom: { x: number; y: number };
  top: { x: number; y: number };
  /** Its pictures' ids: going up, drawn on the lower floor, and going down, on the upper; a label says where it goes until they are painted. */
  art?: { up?: string; down?: string };
  /** What the floors it joins are called there (the sea cave's "Smugglers' Loft"), for its label and what players are told. */
  names?: { lower?: string; upper?: string };
}

/** A floor in plain words. */
export function floorName(floor: number): string {
  if (floor === 0) return 'the ground floor';
  return floor > 0 ? `floor ${floor}` : `underground floor ${-floor}`;
}

/**
 * Adds a floor over a rectangle (a building's walls, usually): wall all round
 * its edge and floor inside. Returns it so stairs and furniture can follow.
 */
export function addStorey(map: RegionMap, rect: TileRect, floor: number, style: string, art?: Storey['art']): Storey {
  if (floor === 0 || !Number.isInteger(floor)) throw new Error(`A storey is a floor above or below the ground, not ${floor}.`);
  const { x, y, width, height } = rect;
  if (x < 0 || y < 0 || x + width > map.width || y + height > map.height || width < 3 || height < 3) {
    throw new Error(`Floor ${floor} at (${x}, ${y}), ${width} by ${height}, does not fit in the land.`);
  }
  const tiles = new Uint8Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const edge = tx === 0 || ty === 0 || tx === width - 1 || ty === height - 1;
      tiles[ty * width + tx] = edge ? Tile.Wall : Tile.Floor;
    }
  }
  const storey: Storey = { x, y, width, height, floor, tiles, style, ...(art ? { art } : {}) };
  map.storeys.push(storey);
  return storey;
}

/** Sets one tile on a floor; off the ground, only where a storey of that floor lies. */
export function setOn(map: RegionMap, floor: number, x: number, y: number, tile: Tile): void {
  if (floor === 0) return set(map, x, y, tile);
  const s = storeyAt(map, x, y, floor);
  if (s) s.tiles[(y - s.y) * s.width + (x - s.x)] = tile;
}

/** Blocks a footprint on a floor whose bottom row is centred under (x, y), as `block` does on the ground. */
export function blockOn(map: RegionMap, floor: number, x: number, y: number, w: number, h: number): void {
  if (floor === 0) return block(map, x, y, w, h);
  const left = Math.floor(x - w / 2);
  const bottom = Math.floor(y - 0.01);
  for (let ty = bottom - h + 1; ty <= bottom; ty++) for (let tx = left; tx < left + w; tx++) setOn(map, floor, tx, ty, Tile.Blocked);
}

/** A way across the land: north is up the map. */
export type Heading = 'north' | 'south' | 'east' | 'west';

/** What a flight of stairs or a ladder needs: where it stands and the floor it climbs from. */
export interface StairPlan extends TileRect {
  kind: StairKind;
  /** The floor it goes up from; it reaches the one above. */
  from: number;
  /**
   * Which way you walk to climb it (north unless said). You step on from the
   * other side below and off on this side above, so walking on carries you
   * away from it instead of straight back down.
   */
  climbs?: Heading;
  art?: Stairway['art'];
  names?: Stairway['names'];
}

const BEHIND: Record<Heading, Heading> = { north: 'south', south: 'north', east: 'west', west: 'east' };

/**
 * Puts stairs or a ladder between a floor and the one above, on the same
 * tiles of both, and finds each floor's landing beside it. Lay the storeys
 * (and their furniture) first, so the landings fall on open floor.
 */
export function addStairs(map: RegionMap, plan: StairPlan): Stairway {
  const { kind, x, y, width, height, from, art, names } = plan;
  const [lower, upper] = [from, from + 1];
  // Off the ground its tiles become floor; on the ground they are whatever the land or building has there.
  for (const floor of [lower, upper]) {
    if (floor === 0) continue;
    for (let ty = y; ty < y + height; ty++) for (let tx = x; tx < x + width; tx++) setOn(map, floor, tx, ty, Tile.Floor);
  }
  const rect = { x, y, width, height };
  const ahead = plan.climbs ?? 'north';
  const bottom = landing(map, rect, lower, BEHIND[ahead]);
  const top = landing(map, rect, upper, ahead);
  if (!bottom || !top) throw new Error(`The ${kind} at (${x}, ${y}) has no open floor beside it on ${floorName(bottom ? upper : lower)}.`);
  const way: Stairway = { kind, x, y, width, height, lower, upper, bottom, top, ...(art ? { art } : {}), ...(names ? { names } : {}) };
  map.stairways.push(way);
  return way;
}

/** The first open tile beside a rectangle on a floor, not on other stairs: on the side wanted, else any other. */
function landing(map: RegionMap, r: TileRect, floor: number, side: Heading): { x: number; y: number } | undefined {
  const along = (h: Heading): [number, number][] => {
    const cells: [number, number][] = [];
    // From the middle of the side outward, so you step off where the flight is centred.
    const mid = (n: number) => Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
    if (h === 'north' || h === 'south') for (const i of mid(r.width)) cells.push([r.x + i, h === 'north' ? r.y - 1 : r.y + r.height]);
    else for (const i of mid(r.height)) cells.push([h === 'west' ? r.x - 1 : r.x + r.width, r.y + i]);
    return cells;
  };
  const sides = [side, BEHIND[side], ...(['west', 'east', 'north', 'south'] as const).filter((h) => h !== side && h !== BEHIND[side])].flatMap(along);
  for (const [tx, ty] of sides) {
    const spot = { x: tx + 0.5, y: ty + 0.5 };
    if (!collides(map, spot.x, spot.y, floor) && !stairwayAt(map, spot.x, spot.y, floor)) return spot;
  }
  return undefined;
}

/** True when a point lies on a rectangle's tiles. */
function on(r: TileRect, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return tx >= r.x && ty >= r.y && tx < r.x + r.width && ty < r.y + r.height;
}

/** The stairs or ladder under a point on a floor, if any. */
export function stairwayAt(map: RegionMap, x: number, y: number, floor: number): Stairway | undefined {
  return map.stairways.find((s) => (s.lower === floor || s.upper === floor) && on(s, x, y));
}

/** Where taking these stairs from a floor puts you. */
export function otherEnd(s: Stairway, from: number): Placed {
  return from === s.lower ? { ...s.top, floor: s.upper } : { ...s.bottom, floor: s.lower };
}

/**
 * Where someone standing on stairs or a ladder ends up: the landing on the
 * other floor. Undefined when they are not on any, or it is a ladder and
 * they cannot climb.
 */
export function takeStairs(map: RegionMap, at: Placed, climbs = true): Placed | undefined {
  const s = stairwayAt(map, at.x, at.y, at.floor);
  if (!s || (s.kind === 'ladder' && !climbs)) return undefined;
  return otherEnd(s, at.floor);
}

/**
 * One tick of a player's input on their floor, taking any stairs they step
 * onto. The server moves players with it and each browser predicts its own
 * player with it, so both change floors on the same step.
 */
export function walkOn(map: RegionMap, at: Placed, dx: number, dy: number): Placed {
  const next = step(map, at, dx, dy, at.floor);
  if (next.x === at.x && next.y === at.y) return at;
  const moved = { x: next.x, y: next.y, floor: at.floor };
  return takeStairs(map, moved) ?? moved;
}

/** The stairs or ladder that took someone from a floor to where they are now, if that is how they got there. */
export function wayTaken(map: RegionMap, from: number, now: Placed): Stairway | undefined {
  if (now.floor === from) return undefined;
  return map.stairways.find((s) => {
    const end = otherEnd(s, from);
    return (s.lower === from || s.upper === from) && end.floor === now.floor && end.x === now.x && end.y === now.y;
  });
}

/** How far off, in tiles, a walker looks for stairs toward another floor. */
const STAIRS_REACH = 32;

/**
 * The stairs or ladder to take from where a walker is to get toward another
 * floor: the nearest on its floor that starts a shortest way there.
 * Undefined when there is none within reach (or none it can climb).
 */
export function stairsToward(map: RegionMap, from: Placed, floor: number, climbs = true): Stairway | undefined {
  if (from.floor === floor) return undefined;
  const ways = map.stairways.filter((s) => climbs || s.kind === 'stairs');
  // Steps from each floor to the one wanted, counted back from it.
  const steps = new Map<number, number>([[floor, 0]]);
  for (let frontier = [floor]; frontier.length;) {
    const next: number[] = [];
    for (const f of frontier) {
      for (const s of ways) {
        const other = s.lower === f ? s.upper : s.upper === f ? s.lower : undefined;
        if (other === undefined || steps.has(other)) continue;
        steps.set(other, steps.get(f)! + 1);
        next.push(other);
      }
    }
    frontier = next;
  }
  const here = steps.get(from.floor);
  if (here === undefined) return undefined;
  let best: Stairway | undefined;
  let bestD = STAIRS_REACH;
  for (const s of ways) {
    if (s.lower !== from.floor && s.upper !== from.floor) continue;
    if (steps.get(s.lower === from.floor ? s.upper : s.lower) !== here - 1) continue;
    const d = Math.hypot(s.x + s.width / 2 - from.x, s.y + s.height / 2 - from.y);
    if (d <= bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** The middle of a stairway's tiles, where walkers head to take it. */
export function stairsMiddle(s: TileRect): { x: number; y: number } {
  return { x: s.x + s.width / 2, y: s.y + s.height / 2 };
}

/** What a stairway's label says on a floor: where it goes. */
export function stairsLabel(s: Stairway, floor: number): string {
  const up = floor === s.lower;
  const name = up ? s.names?.upper : s.names?.lower;
  const to = floorName(up ? s.upper : s.lower);
  return `${s.kind === 'ladder' ? 'Ladder' : 'Stairs'} ${up ? 'up' : 'down'} to ${name ? `${name} (${to})` : to}`;
}

/** What a player is told on taking a stairway from a floor. */
export function climbWords(s: Stairway, floor: number): string {
  const up = floor === s.lower;
  const name = up ? s.names?.upper : s.names?.lower;
  const to = name ? `${name}, ${floorName(up ? s.upper : s.lower)}` : floorName(up ? s.upper : s.lower);
  if (s.kind === 'ladder') return `You climb ${up ? 'up' : 'down'} the ladder to ${to}.`;
  return up ? `You climb the stairs to ${to}.` : `You go down the stairs to ${to}.`;
}

/**
 * What is wrong with a land's floors, in plain words: storeys that leave the
 * land or overlap on one floor, stairs that do not join next floors, stand
 * where nothing can be walked, overlap, or land you somewhere solid or on
 * other stairs. Empty when all is well.
 */
export function floorChecks(map: RegionMap): string[] {
  const problems: string[] = [];
  map.storeys.forEach((s, i) => {
    const where = `${floorName(s.floor)} at (${s.x}, ${s.y})`;
    if (s.x < 0 || s.y < 0 || s.x + s.width > map.width || s.y + s.height > map.height) problems.push(`${where} goes past the edge of the land.`);
    if (s.tiles.length !== s.width * s.height) problems.push(`${where} has ${s.tiles.length} tiles, not ${s.width * s.height}.`);
    for (const o of map.storeys.slice(i + 1)) {
      if (o.floor === s.floor && overlap(s, o)) problems.push(`${where} overlaps another part of the same floor at (${o.x}, ${o.y}).`);
    }
  });
  map.stairways.forEach((s, i) => {
    const where = `the ${s.kind} at (${s.x}, ${s.y})`;
    if (s.upper !== s.lower + 1) problems.push(`${where} joins ${floorName(s.lower)} and ${floorName(s.upper)}, which are not next to each other.`);
    for (const floor of [s.lower, s.upper]) {
      for (let ty = s.y; ty < s.y + s.height; ty++) {
        for (let tx = s.x; tx < s.x + s.width; tx++) {
          if (isBlocking(tileAt(map, tx, ty, floor))) problems.push(`${where} stands on something solid on ${floorName(floor)} at (${tx}, ${ty}).`);
        }
      }
    }
    for (const [spot, floor, name] of [[s.bottom, s.lower, 'bottom'], [s.top, s.upper, 'top']] as const) {
      if (collides(map, spot.x, spot.y, floor)) problems.push(`The landing at the ${name} of ${where} is not open floor.`);
      else if (stairwayAt(map, spot.x, spot.y, floor)) problems.push(`The landing at the ${name} of ${where} is on stairs, so you would be carried straight on.`);
    }
    for (const o of map.stairways.slice(i + 1)) {
      const shared = [o.lower, o.upper].some((f) => f === s.lower || f === s.upper);
      if (shared && overlap(s, o)) problems.push(`${where} overlaps the ${o.kind} at (${o.x}, ${o.y}) on a floor they share.`);
    }
  });
  return problems;
}

function overlap(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Most floors a building may have above the ground, and below it. */
export const MAX_FLOORS = { up: 4, down: 3 };

/** A building's walls as a tile rectangle, and its doorway. */
interface Walled extends TileRect {
  door: { x: number; y: number };
  style: string;
  art?: TileArt;
}

/**
 * Gives a building floors above and below the ground over its walls, each
 * joined to the next by stairs (or ladders) set where there is room: on
 * open floor, clear of furniture, the doorway and each other. Any floors it
 * had are taken off first. Returns false, leaving it as it was, when there is
 * no room for a flight.
 */
export function buildFloors(map: RegionMap, b: Walled, up: number, down: number, kind: StairKind = 'stairs'): boolean {
  const mine = (r: TileRect) => overlap(r, b);
  const before = { storeys: map.storeys, stairways: map.stairways };
  map.storeys = map.storeys.filter((s) => !mine(s));
  map.stairways = map.stairways.filter((s) => !mine(s));
  for (let f = 1; f <= up; f++) addStorey(map, b, f, b.style, b.art);
  for (let f = -1; f >= -down; f--) addStorey(map, b, f, b.style, b.art);
  for (let from = -down, n = 0; from < up; from++, n++) {
    if (placeFlight(map, b, from, kind, n % 2 === 1)) continue;
    map.storeys = before.storeys;
    map.stairways = before.stairways;
    return false;
  }
  return true;
}

/** Sets one flight from a floor to the next in the first spot that fits, from the west end (or the east). */
function placeFlight(map: RegionMap, b: Walled, from: number, kind: StairKind, east: boolean): boolean {
  const [w, h] = kind === 'ladder' ? [1, 1] : [2, 1];
  const xs: number[] = [];
  for (let x = b.x + 1; x + w <= b.x + b.width - 1; x++) xs.push(x);
  if (east) xs.reverse();
  // From the second row in, so the floor above has a row to step off onto north of it.
  for (let y = b.y + 2; y + h <= b.y + b.height - 2; y++) {
    for (const x of xs) {
      const rect = { x, y, width: w, height: h };
      // Two tiles clear of the doorway, so the way in stays open.
      if (overlap(rect, { x: b.door.x - 1, y: b.door.y - 2, width: 4, height: 3 })) continue;
      if (!fits(map, rect, from)) continue;
      const way = addStairs(map, { kind, ...rect, from });
      // Never where it would cover the landing of the flight next to it.
      const clash = map.stairways.some((o) => o !== way && ((o.lower === from + 1 && on(rect, o.top.x, o.top.y)) || (o.upper === from && on(rect, o.bottom.x, o.bottom.y)) || (o.lower === from + 1 && on(o, way.top.x, way.top.y)) || (o.upper === from && on(o, way.bottom.x, way.bottom.y))));
      if (!clash && !floorChecks(map).length) return true;
      map.stairways.splice(map.stairways.indexOf(way), 1);
    }
  }
  return false;
}

/** True when a flight could stand on a rectangle: open floor on both its floors, on no other stairs, with room to step off. */
function fits(map: RegionMap, r: TileRect, from: number): boolean {
  for (const floor of [from, from + 1]) {
    for (let ty = r.y; ty < r.y + r.height; ty++) {
      for (let tx = r.x; tx < r.x + r.width; tx++) {
        if (tileAt(map, tx, ty, floor) !== Tile.Floor || stairwayAt(map, tx + 0.5, ty + 0.5, floor)) return false;
      }
    }
    if (!landing(map, r, floor, 'north')) return false;
  }
  return true;
}
