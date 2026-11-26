import { takeDownWall } from '../edge-walls.ts';
import { collides } from '../movement.ts';
import { Tile, isBlocking, tileAt, type RegionMap } from '../world.ts';
import { floorName, setOn, stairwayAt, type Heading, type Stairway } from '../floors.ts';

// Ramps: a new kind of stairs. A ramp's tiles exist only on the lower floor,
// one tile wide and two or three long, rising toward where it climbs. Its
// foot (the low end) is the way on: stepping onto it puts you on the upper
// floor at the top landing, the tile in front of its high end. Its body is
// solid, so nobody walks under it or onto its side. On the upper floor its
// head is the spot over its top tile, which needs no floor: stepping onto it
// from the top landing puts you on the lower floor at the foot landing, in
// front of the ramp and facing away from it, so the next step does not take
// you straight back up. After that the stair rules (walkOn, takeStairs) work
// unchanged, on the server and in each browser's prediction alike.

/** How long a ramp may be, in tiles. */
export const RAMP_LENGTHS = [2, 3] as const;

/** The looks a ramp's picture is painted in. */
export const RAMP_LOOKS = [
  { id: 'stone', name: 'Stone' },
  { id: 'wood', name: 'Wood' },
  { id: 'earth', name: 'Earth' },
] as const;

/** Which way a ramp's picture rises: away from the camera (north; west mirrors it) or toward it (south; east mirrors it). */
export type RampWay = 'away' | 'toward';

/** Every ramp picture the game asks for: one per look, length and way, 12 in all. */
export const RAMP_ARTS: { id: string; look: string; length: number; way: RampWay }[] = RAMP_LOOKS.flatMap((l) =>
  RAMP_LENGTHS.flatMap((length) => (['away', 'toward'] as const).map((way) => ({ id: `ramp-${l.id}-${length}-${way}`, look: l.id, length, way }))),
);

/**
 * The tiles a ramp picture stands on, from its id (a land's own
 * `ramp-<biome>-<look>-<length>-<way>` too): 1 across and its length deep,
 * as a ramp rising north or south lies. Undefined for any other id.
 */
export function rampArtFootprint(id: string): { width: number; height: number } | undefined {
  const m = /^ramp-.+-([23])-(?:away|toward)$/.exec(id);
  return m ? { width: 1, height: Number(m[1]) } : undefined;
}

/** What a ramp needs: its tiles' top-left corner, its length, the floor it climbs from and which way it rises. */
export interface RampPlan {
  x: number;
  y: number;
  length: number;
  from: number;
  climbs: Heading;
  /** The look its picture is painted in (R3): stone, wood or earth. */
  look?: string;
  names?: Stairway['names'];
}

const STEP: Record<Heading, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/** A ramp's tiles from its plan, foot first, head last. */
export function rampTiles(plan: Pick<RampPlan, 'x' | 'y' | 'length' | 'climbs'>): { x: number; y: number }[] {
  const [dx, dy] = STEP[plan.climbs];
  const along = dx !== 0;
  const tiles = Array.from({ length: plan.length }, (_, i) => (along ? { x: plan.x + i, y: plan.y } : { x: plan.x, y: plan.y + i }));
  // Rising north or west, the foot is the last tile from the corner.
  return dx < 0 || dy < 0 ? tiles.reverse() : tiles;
}

/** Why a ramp cannot stand here, in plain words, or undefined when it can. */
export function rampProblem(map: RegionMap, plan: RampPlan): string | undefined {
  if (!RAMP_LENGTHS.includes(plan.length as 2 | 3)) return 'A ramp is 2 or 3 tiles long.';
  if (!STEP[plan.climbs]) return 'A ramp rises north, south, east or west.';
  const tiles = rampTiles(plan);
  const [dx, dy] = STEP[plan.climbs];
  const lower = plan.from;
  const upper = plan.from + 1;
  for (const t of tiles) {
    if (t.x < 0 || t.y < 0 || t.x >= map.width || t.y >= map.height) return 'The ramp would reach off the edge of this land.';
    if (isBlocking(tileAt(map, t.x, t.y, lower))) return `The ramp needs open floor on ${floorName(lower)} under all its tiles.`;
    if (stairwayAt(map, t.x + 0.5, t.y + 0.5, lower)) return 'The ramp would stand on other stairs.';
  }
  const foot = tiles[0]!;
  const head = tiles.at(-1)!;
  const bottom = { x: foot.x - dx + 0.5, y: foot.y - dy + 0.5 };
  const top = { x: head.x + dx + 0.5, y: head.y + dy + 0.5 };
  if (collides(map, bottom.x, bottom.y, lower) || stairwayAt(map, bottom.x, bottom.y, lower)) return `There is no open floor in front of the ramp's foot on ${floorName(lower)}.`;
  if (tileAt(map, bottom.x, bottom.y, lower) === Tile.Door) return 'The ramp would start in a doorway and block the way in.';
  if (collides(map, top.x, top.y, upper) || stairwayAt(map, top.x, top.y, upper)) return `There is no open floor in front of the ramp's top on ${floorName(upper)}.`;
  return undefined;
}

/**
 * Lays a ramp: makes its body solid on the lower floor, opens the way from
 * the top landing onto its head, and finds both landings. Throws in plain
 * words when it does not fit.
 */
export function addRamp(map: RegionMap, plan: RampPlan): Stairway {
  const problem = rampProblem(map, plan);
  if (problem) throw new Error(problem);
  const tiles = rampTiles(plan);
  const [dx, dy] = STEP[plan.climbs];
  const [lower, upper] = [plan.from, plan.from + 1];
  const foot = tiles[0]!;
  const head = tiles.at(-1)!;
  // The body is solid; the foot stays open to step on.
  // What stood under the body, so taking the ramp away gives it back.
  const under = tiles.slice(1).map((t) => tileAt(map, t.x, t.y, lower));
  for (const t of tiles.slice(1)) setOn(map, lower, t.x, t.y, Tile.Blocked);
  // A terrace's parapet between the top landing and the head would stop the step down.
  takeDownWall(map, head.x, head.y, plan.climbs, upper);
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  const way: Stairway = {
    kind: 'ramp',
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1,
    lower,
    upper,
    bottom: { x: foot.x - dx + 0.5, y: foot.y - dy + 0.5 },
    top: { x: head.x + dx + 0.5, y: head.y + dy + 0.5 },
    climbs: plan.climbs,
    ramp: { foot, head, under },
    ...(plan.look ? { art: { up: rampArt(plan.look, plan.length, plan.climbs) } } : {}),
    ...(plan.names ? { names: plan.names } : {}),
  };
  map.stairways.push(way);
  return way;
}

/**
 * A ramp picture's id: one per look and length, rising away from the camera
 * (north, mirrored for west) or toward it (south, mirrored for east).
 */
export function rampArt(look: string, length: number, climbs: Heading): string {
  return `ramp-${look}-${length}-${rampWay(climbs)}`;
}

/** Which way a ramp's picture rises for a ramp climbing this way. */
export function rampWay(climbs: Heading): RampWay {
  return climbs === 'north' || climbs === 'west' ? 'away' : 'toward';
}

/** True when a ramp climbing this way shows its picture mirrored: west and east lie across the other grid line. */
export function rampMirrored(climbs: Heading): boolean {
  return climbs === 'west' || climbs === 'east';
}

/** Takes a ramp away, giving its body's tiles back what stood there before. */
export function takeAwayRamp(map: RegionMap, way: Stairway): void {
  map.stairways = map.stairways.filter((s) => s !== way);
  if (!way.ramp) return;
  const tiles = rampTiles({ x: way.x, y: way.y, length: Math.max(way.width, way.height), climbs: way.climbs ?? 'north' });
  tiles.slice(1).forEach((t, i) => setOn(map, way.lower, t.x, t.y, way.ramp!.under?.[i] ?? Tile.Ground));
}

/** The look a ramp's picture is painted in (stone, wood or earth), from its picture's id; undefined when it has none. */
export function rampLook(way: Stairway): string | undefined {
  return way.art?.up?.match(/^ramp-(.+)-\d+-(?:away|toward)$/)?.[1];
}

/** A ramp in plain words: "A ramp, 3 long, rising north". */
export function rampWords(way: Stairway): string {
  return `A ramp, ${Math.max(way.width, way.height)} long, rising ${way.climbs ?? 'north'}`;
}
