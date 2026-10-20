import { TICK_RATE, dayPart, routineOf, routineWords, stairsMiddle, stairsToward, takeStairs, type DayPart, type NpcPlacement, type Placed, type RegionMap, type RoutinePlace } from '@co-mmo/shared';
import { findPath, findSpots, moveToward, wander, type Walker } from './walkers.ts';

// The people of a region going about their day (routines.ts): walking to
// work at dawn, out to the square at dusk, home to sleep at night, and
// strolling about wherever they are. They stop to talk when someone is close.
// Someone who lives upstairs or below takes the stairs (or a ladder) down to
// the square and back.

type Spot = { x: number; y: number };

/** NPCs stroll slowly, and stay close to their spot so players can find them. */
const STROLL_SPEED = 1;
const STROLL_RADIUS = 2.5;
/** They walk a little faster when going somewhere. */
const WALK_SPEED = 1.6;
/** Where around the square people gather: this far from where travellers arrive, in tiles. */
const SQUARE_NEAR = 2.5;
const SQUARE_FAR = 5;

/** An NPC, where they stand now and where their day takes them. */
export interface Townsperson extends NpcPlacement, Walker {
  floor: number;
  spots: Record<RoutinePlace, Placed>;
  /** The part of the day they last set off for. */
  part?: DayPart;
  /** The way still to walk to where they are going. */
  path: Spot[];
  asleep: boolean;
}

/** What a person's day needs to know this tick. */
export interface Town {
  map: RegionMap;
  random: () => number;
  /** Where the day is (sky.ts dayPhase). */
  phase: number;
  /** Someone stands close enough to talk, so they wait. */
  listening: boolean;
}

/**
 * Lets an NPC keep a day about where they were placed. The placement object
 * itself becomes the townsperson, so the map's own list stays current.
 */
export function makeTownsperson(npc: NpcPlacement, map: RegionMap, random: () => number): Townsperson {
  const floor = npc.floor ?? 0;
  const work = { x: npc.x, y: npc.y, floor };
  const around = findSpots(map, map.spawn.x, map.spawn.y, 8, SQUARE_NEAR, SQUARE_FAR);
  // Each person has their own place in the square, the same every evening.
  const pick = around[[...npc.id].reduce((h, ch) => h + ch.charCodeAt(0), 0) % Math.max(1, around.length)];
  const square = pick ? { ...pick, floor: 0 } : work;
  return Object.assign(npc, {
    floor, home: work, target: null, rest: Math.floor(random() * TICK_RATE * 3), spots: { work, square }, path: [], asleep: false,
  });
}

/** One tick of a person's day: set off when the part of the day changes, walk there, then stroll or sleep. */
export function live(n: Townsperson, town: Town): void {
  const part = dayPart(town.phase);
  const step = routineOf(n.id)[part];
  const spot = n.spots[step.place];
  if (n.part !== part) {
    n.part = part;
    n.asleep = false;
    n.target = null;
    n.path = plan(town.map, n, spot);
  }
  if (town.listening) {
    n.target = null;
    n.rest = TICK_RATE;
    return;
  }
  const next = n.path[0];
  if (next) {
    const before = { x: n.x, y: n.y };
    // Something in the way (a new building, a wished thing) skips to the next bend.
    if (moveToward(town.map, n, next.x, next.y, WALK_SPEED) || (n.x === before.x && n.y === before.y)) n.path.shift();
    // At the stairs on the way (the end of this leg): up or down them, then on from the landing.
    if (n.floor !== spot.floor && !n.path.length) {
      const landed = takeStairs(town.map, n);
      if (landed) {
        Object.assign(n, landed);
        n.path = plan(town.map, n, spot);
      }
    }
    return;
  }
  if (step.sleep) {
    n.asleep = true;
    n.target = null;
    return;
  }
  // Kept from their spot's floor (its stairs gone), they stroll where they are.
  wander(town.map, n, STROLL_SPEED, STROLL_RADIUS, town.random, spot.floor === n.floor ? spot : n.home.floor === n.floor ? n.home : n);
}

/** The way to walk to a spot: there on this floor, or to the stairs that lead toward its floor; none when close by. */
function plan(map: RegionMap, n: Townsperson, spot: Placed): Spot[] {
  if (n.floor !== spot.floor) {
    const way = stairsToward(map, n, spot.floor);
    if (!way) return [];
    const middle = stairsMiddle(way);
    return findPath(map, n, middle) ?? [middle];
  }
  const far = Math.hypot(spot.x - n.x, spot.y - n.y) > STROLL_RADIUS;
  return far ? findPath(map, n, spot) ?? [spot] : [];
}

/** What a person says first when spoken to now (woken up, or busy with their evening), if anything. */
export function greetingNow(n: Townsperson, phase: number): string | undefined {
  return routineWords(n.name, routineOf(n.id)[dayPart(phase)], n.asleep);
}
