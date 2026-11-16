import { STEP_WAYS, TICK_RATE, TICK_SECONDS, anchorNear, canStep, collides, findTileRoute, openSquare, spotMiddle, stairsMiddle, stairsToward, stairwayAt, stepped, takeStairs, tileTaken, wallBetween, isBlocking, outsideSide, tileAt, type Among, type Placed, type RegionMap, type StepWay, type Tile, type TileSpot } from '@co-mmo/shared';

// How creatures and people move about a region: stepping toward a point,
// strolling near a spot, running from someone, and finding a way around
// walls and trees to somewhere farther off. The region decides where each
// wants to go (creature-brain.ts, townsfolk.ts); this only moves them there.
// Everyone walks on tiles (docs/combat.md, Moving on tiles): a walker stands
// on a square of tiles `width` wide and steps one tile at a time in one of
// eight ways, and a step once begun is always finished. Each walker keeps to
// its floor (floors.ts) and takes stairs only on purpose, when somewhere it is
// going is on another floor (goTo). Given `among`, the bodies about it
// (hit-boxes.ts), it never steps onto a tile someone else holds: blocked, it
// steps round them, so a crowd closing on a player spreads about them.

/** A point, on the ground floor unless it says. */
type Spot = { x: number; y: number; floor?: number };

/** Something that walks on tiles: where it is, how wide it stands, and the tile it is stepping onto. */
export type Stepper = Spot & { to?: TileSpot; width?: number; detour?: Detour };

/** The way round something in the way to a square, kept while it is walked so the walker does not turn back halfway. */
interface Detour {
  to: TileSpot;
  ways: StepWay[];
}

/** Anything that strolls about a home spot: creatures and NPCs. */
export interface Walker {
  x: number;
  y: number;
  /** The floor it is on (floors.ts). */
  floor: number;
  /** The square it is stepping onto, while it steps (tiles/walker.ts). */
  to?: TileSpot;
  /** How many tiles wide it stands (tiles/grid.ts SIZE_TILES); one when missing. */
  width?: number;
  /** The way it is following round a wall or a crowd, if any. */
  detour?: Detour;
  home: Placed;
  /** Where it is strolling to. */
  target: Spot | null;
  /** Ticks to rest before choosing the next spot. */
  rest: number;
}

const EPS = 1e-6;
/** Squares a walker searches round something in the way before it gives up on a step (a short search: hundreds walk each tick). */
const DETOUR_LIMIT = 400;

const sameTile = (a: TileSpot, b: TileSpot) => a.tx === b.tx && a.ty === b.ty;

/** True when a walker's square stays inside the region. */
function inside(map: RegionMap, at: TileSpot, width: number): boolean {
  return at.tx >= 0 && at.ty >= 0 && at.tx + width <= map.width && at.ty + width <= map.height;
}

/** True when a walker may step `way` from `from`: the land lets it, it stays inside, and nobody holds the square. */
function canTread(map: RegionMap, w: Stepper, from: TileSpot, way: StepWay, among?: Among): boolean {
  const width = w.width ?? 1;
  const floor = w.floor ?? 0;
  const next = stepped(from, way);
  return inside(map, next, width) && canStep(map, from, way, width, floor) && !tileTaken(among, next, floor, width);
}

/**
 * Moves a walker along tiles for one tick at `speed` tiles a second: finishes
 * the step it is taking, then starts the steps `pick` chooses from each tile
 * it arrives at, until the tick's walk is used. One put off a tile's middle
 * (a spawn, a landing) first settles onto the square it stands on.
 * `stopsAt` ends the walk on arriving at a tile (stairs it means to take).
 */
function tread(map: RegionMap, w: Stepper, speed: number, pick: (from: TileSpot) => StepWay | undefined, stopsAt?: (at: TileSpot) => boolean): void {
  const width = w.width ?? 1;
  let budget = speed * TICK_SECONDS;
  // A step is never more than a diagonal long: one farther off was left behind by a jump (a respawn, stairs).
  if (w.to) {
    const goal = spotMiddle(w.to, width);
    if (Math.hypot(goal.x - w.x, goal.y - w.y) > 1.5) delete w.to;
  }
  for (let i = 0; i < 3 && budget > EPS; i++) {
    if (!w.to) {
      const from = anchorNear(w.x, w.y, width);
      const mid = spotMiddle(from, width);
      if (Math.hypot(mid.x - w.x, mid.y - w.y) > EPS && openSquare(map, from, width, w.floor ?? 0)) w.to = from;
      else {
        const way = pick(from);
        if (!way) break;
        w.to = stepped(from, way);
      }
    }
    const goal = spotMiddle(w.to, width);
    const left = Math.hypot(goal.x - w.x, goal.y - w.y);
    if (left <= budget) {
      budget -= left;
      w.x = goal.x;
      w.y = goal.y;
      const at = w.to;
      delete w.to;
      if (stopsAt?.(at)) break;
    } else {
      w.x += ((goal.x - w.x) / left) * budget;
      w.y += ((goal.y - w.y) / left) * budget;
      budget = 0;
    }
  }
}

/**
 * The step to take from `from` toward a point: on a way round something
 * that it is already following, the next step of it; else the free way that
 * brings the walker nearest the point, as long as that is nearer than it
 * stands; and when nothing nearer is free (a wall, someone in the way), the
 * first step of a short search round it, which it then keeps to.
 */
function wayToward(map: RegionMap, w: Stepper, from: TileSpot, goal: { x: number; y: number }, among?: Among): StepWay | undefined {
  const width = w.width ?? 1;
  const target = anchorNear(goal.x, goal.y, width);
  const kept = w.detour;
  if (kept && sameTile(kept.to, target) && kept.ways.length) {
    const next = kept.ways.shift()!;
    if (canTread(map, w, from, next, among)) return next;
  }
  delete w.detour;
  const dist = (t: TileSpot) => {
    const m = spotMiddle(t, width);
    return Math.hypot(goal.x - m.x, goal.y - m.y);
  };
  let best: StepWay | undefined;
  let bestD = dist(from) - EPS;
  for (const way of STEP_WAYS) {
    const d = dist(stepped(from, way));
    if (d < bestD && canTread(map, w, from, way, among)) {
      best = way;
      bestD = d;
    }
  }
  if (best) return best;
  const floor = w.floor ?? 0;
  const route = findTileRoute(map, {
    from, toward: target, width, floor, limit: DETOUR_LIMIT,
    arrived: (t) => sameTile(t, target),
    free: (t) => inside(map, t, width) && !tileTaken(among, t, floor, width),
  });
  const first = route?.shift();
  if (!first || !canTread(map, w, from, first, among)) return undefined;
  if (route!.length) w.detour = { to: target, ways: route! };
  return first;
}

/** True when a walker stands still on the square nearest a point. */
function standsAt(w: Stepper, x: number, y: number): boolean {
  const width = w.width ?? 1;
  const at = spotMiddle(anchorNear(x, y, width), width);
  return !w.to && Math.abs(w.x - at.x) < EPS && Math.abs(w.y - at.y) < EPS;
}

/** Steps toward a point, tile by tile, round walls and anyone in the way. True once it stands on the square nearest it. */
export function moveToward(map: RegionMap, w: Stepper, tx: number, ty: number, speed: number, among?: Among, stopsAt?: (at: TileSpot) => boolean): boolean {
  if (standsAt(w, tx, ty)) return true;
  tread(map, w, speed, (from) => wayToward(map, w, from, { x: tx, y: ty }, among), stopsAt);
  return standsAt(w, tx, ty);
}

/**
 * Finishes a step under way, for a walker that took no other step this tick
 * (resting, talking, striking): a step once begun is always finished.
 */
export function keepStepping(map: RegionMap, w: Stepper, before: Spot, speed: number): void {
  if (w.to && w.x === before.x && w.y === before.y) tread(map, w, speed, () => undefined);
}

/**
 * Steps off a square someone else holds (several put on one spot, someone
 * arriving on top of it) onto a free one beside it, so nobody stays stacked
 * on another. Creatures and people do it every tick; players are only ever
 * stopped, never pushed.
 */
export function standClear(map: RegionMap, w: Stepper, speed: number, among: Among, random: () => number): void {
  if (w.to) return;
  const width = w.width ?? 1;
  const from = anchorNear(w.x, w.y, width);
  if (!tileTaken(among, from, w.floor ?? 0, width)) return;
  // Straight ways first, from a random one, so a crowd parts every way.
  const turn = Math.floor(random() * 4);
  const ways = [0, 1, 2, 3].map((i) => STEP_WAYS[(i + turn) % 4]!).concat(STEP_WAYS.slice(4));
  const way = ways.find((wy) => canTread(map, w, from, wy, among));
  if (!way) return;
  let once = true;
  tread(map, w, speed, () => (once ? ((once = false), way) : undefined));
}

/**
 * Steps toward a place that may be on another floor: on the same floor
 * straight there, else to the stairs that lead toward it, taking them on
 * arrival. Ladders only for walkers that climb. True once it arrives; false
 * while on its way, and also when no stairs lead there (see canReach).
 */
export function goTo(map: RegionMap, w: Walker, to: Placed, speed: number, climbs = false, among?: Among): boolean {
  if (w.floor === to.floor) return moveToward(map, w, to.x, to.y, speed, among);
  const way = stairsToward(map, w, to.floor, climbs);
  if (!way) return false;
  const middle = stairsMiddle(way);
  // Only the stairs it set out for: others it crosses on the way are walked over.
  moveToward(map, w, middle.x, middle.y, speed, among, (t) => {
    const m = spotMiddle(t, w.width ?? 1);
    return stairwayAt(map, m.x, m.y, w.floor) === way;
  });
  if (!w.to && stairwayAt(map, w.x, w.y, w.floor) === way) {
    const landed = takeStairs(map, w, climbs);
    if (landed) {
      Object.assign(w, landed);
      delete w.to;
    }
  }
  return false;
}

/** True when a walker can get to a place: on its floor, or by stairs within reach. */
export function canReach(map: RegionMap, w: Placed, to: Placed, climbs = false): boolean {
  return w.floor === to.floor || Boolean(stairsToward(map, w, to.floor, climbs));
}

/** Steps away from a point, tile by tile, staying inside the region; one with nowhere farther to go stands at bay. */
export function moveAway(map: RegionMap, w: Stepper, fx: number, fy: number, speed: number, among?: Among): void {
  const width = w.width ?? 1;
  tread(map, w, speed, (from) => {
    const dist = (t: TileSpot) => {
      const m = spotMiddle(t, width);
      return Math.hypot(m.x - fx, m.y - fy);
    };
    let best: StepWay | undefined;
    let bestD = dist(from) + EPS;
    for (const way of STEP_WAYS) {
      const d = dist(stepped(from, way));
      if (d > bestD && canTread(map, w, from, way, among)) {
        best = way;
        bestD = d;
      }
    }
    return best;
  });
}

/** Strolls between spots near `around` (home unless said), resting in between. */
export function wander(map: RegionMap, w: Walker, speed: number, radius: number, random: () => number, around: Spot = w.home, among?: Among): void {
  if (!w.target) {
    if (w.rest-- > 0) return;
    for (let tries = 0; tries < 5 && !w.target; tries++) {
      const angle = random() * Math.PI * 2;
      const dist = 1 + random() * Math.max(0, radius - 1);
      const t = { x: around.x + Math.cos(angle) * dist, y: around.y + Math.sin(angle) * dist };
      const width = w.width ?? 1;
      const at = anchorNear(t.x, t.y, width);
      if (!outsideSide(map, t.x, t.y) && inside(map, at, width) && openSquare(map, at, width, w.floor)) w.target = t;
    }
    if (!w.target) w.rest = TICK_RATE;
    return;
  }
  const before = { x: w.x, y: w.y };
  if (moveToward(map, w, w.target.x, w.target.y, speed, among)) {
    w.target = null;
    w.rest = Math.floor(TICK_RATE * (1 + random() * 3));
  } else if (stalled(before, w, w.target)) {
    w.target = null;
    w.rest = TICK_RATE;
  }
}

/**
 * True when a step from `before` brought a walker no nearer `to`: a wall or
 * someone in the way. A stroll gives up on such a spot and picks another,
 * instead of shuffling in place against whoever stands there.
 */
export function stalled(before: Spot, now: Spot, to: Spot): boolean {
  return Math.hypot(to.x - now.x, to.y - now.y) >= Math.hypot(to.x - before.x, to.y - before.y) - 1e-3;
}

/** The farthest a path is searched for, in tiles walked; beyond it walkers go straight and slide. */
const MAX_PATH_TILES = 16384;

/**
 * A way from one point to another around anything in the way, as tile
 * centres to walk through ending at `to`, or undefined when there is none.
 * Turns only where the way bends, so walkers cut no corners into walls.
 */
export function findPath(map: RegionMap, from: Spot, to: Spot, floor = from.floor ?? 0): Spot[] | undefined {
  const w = map.width;
  const h = map.height;
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !isBlocking(tileAt(map, x, y, floor) as Tile) && !collides(map, x + 0.5, y + 0.5, floor);
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
      if (!open(x + dx, y + dy) || came[n] !== -1 || wallBetween(map, x, y, dx, dy, floor)) continue;
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
export function findSpots(map: RegionMap, x: number, y: number, count: number, min = 1.5, max = 4, floor = 0): Spot[] {
  const spots: Spot[] = [];
  for (let r = min; r <= max && spots.length < count; r += 0.75) {
    for (let a = 0; a < 12 && spots.length < count; a++) {
      const angle = (a / 12) * Math.PI * 2 + r;
      const s = { x: Math.round((x + Math.cos(angle) * r) * 2) / 2, y: Math.round((y + Math.sin(angle) * r) * 2) / 2 };
      if (outsideSide(map, s.x, s.y) || collides(map, s.x, s.y, floor)) continue;
      if (spots.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 1)) continue;
      spots.push(s);
    }
  }
  return spots;
}

/** The nearest tile of these kinds within a radius of a point (tile coordinates), on a floor (the ground unless said). */
export function nearestTile(map: RegionMap, x: number, y: number, kinds: Tile[], radius: number, floor = 0): { tile: Tile; x: number; y: number } | undefined {
  let best: { tile: Tile; x: number; y: number } | undefined;
  let bestD = Infinity;
  const r = Math.ceil(radius);
  for (let ty = Math.floor(y) - r; ty <= Math.floor(y) + r; ty++) {
    for (let tx = Math.floor(x) - r; tx <= Math.floor(x) + r; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      const tile = tileAt(map, tx, ty, floor);
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
