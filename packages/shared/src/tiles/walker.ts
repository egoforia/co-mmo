import { PLAYER_SPEED, TICK_SECONDS } from '../constants.ts';
import { stoppedBy, type Among } from '../hit-boxes.ts';
import type { RegionMap } from '../world.ts';
import { anchorNear, isDiagonal, spotMiddle, stepped, wayOf, type StepWay, type TileSpot } from './grid.ts';
import { canStep, openTile } from './steps.ts';

// One tick of a walker on tiles (docs/combat.md): standing at a tile's
// middle it starts a step the way its input points; mid-step it keeps going
// whatever the input, at its speed, until it stands on the next tile's
// middle, where any time left over starts the next step. So a step, once
// begun, is always finished, and a held key walks smoothly from tile to tile.

/** A walker on tiles: where it is, and the tile it is stepping onto, while it steps. */
export interface TileWalker {
  x: number;
  y: number;
  floor: number;
  /** The tile it is stepping onto; none while it stands. */
  to?: TileSpot;
}

const EPS = 1e-6;

/** How far inside its square a body must reach before it holds a tile: a hair's breadth is rounding. */
const HOLD = 0.05;

/** The tiles, column or row, a body of `width` whose middle is at `at` reaches into. */
function heldSpan(at: number, width: number): [number, number] {
  return [Math.floor(at - width / 2 + HOLD), Math.floor(at + width / 2 - HOLD)];
}

/**
 * True when someone the mover is stopped by stands on any tile of a
 * `width`-wide square, or is stepping onto one. A body holds every tile its
 * square reaches into, so one halfway through a step holds both squares.
 */
export function tileTaken(among: Among | undefined, anchor: TileSpot, floor: number, width = 1): boolean {
  if (!among) return false;
  const mid = spotMiddle(anchor, width);
  const self = among.self;
  const overlaps = (lo: number, hi: number, from: number) => lo <= from + width - 1 && hi >= from;
  for (const o of among.bodies.near(mid.x, mid.y, width)) {
    if (o === self || (self.of !== undefined && o.of === self.of)) continue;
    if ((o.floor ?? 0) !== floor || !stoppedBy(self.kind, o.kind) || among.passes?.(o)) continue;
    const ow = o.width ?? 1;
    if (o.to && overlaps(o.to.tx, o.to.tx + ow - 1, anchor.tx) && overlaps(o.to.ty, o.to.ty + ow - 1, anchor.ty)) return true;
    const [x0, x1] = heldSpan(o.x, ow);
    const [y0, y1] = heldSpan(o.y, ow);
    if (overlaps(x0, x1, anchor.tx) && overlaps(y0, y1, anchor.ty)) return true;
  }
  return false;
}

/**
 * The way to step for an input, from a tile: straight on; for a diagonal
 * blocked by the land, along one side of it (sliding along a wall); and when
 * someone stands in the way, round them by the nearest way that turns least
 * (an eighth of a turn), so a held key never walks into a creature forever.
 */
function chooseWay(map: RegionMap, from: TileSpot, want: StepWay, floor: number, among?: Among): StepWay | undefined {
  const land = (w: StepWay) => canStep(map, from, w, 1, floor);
  const free = (w: StepWay) => !tileTaken(among, stepped(from, w), floor);
  const slides: StepWay[] = isDiagonal(want) ? [{ dx: want.dx, dy: 0 }, { dx: 0, dy: want.dy }] : [];
  if (land(want)) {
    if (free(want)) return want;
    const round = isDiagonal(want) ? slides : [turned(want, 1), turned(want, -1)];
    return round.find((w) => land(w) && free(w));
  }
  return slides.find((w) => land(w) && free(w));
}

/** A way turned an eighth of a turn clockwise (1) or back (-1). */
function turned(way: StepWay, by: 1 | -1): StepWay {
  const a = Math.atan2(way.dy, way.dx) + (by * Math.PI) / 4;
  return { dx: (Math.round(Math.cos(a)) || 0) as StepWay['dx'], dy: (Math.round(Math.sin(a)) || 0) as StepWay['dy'] };
}

/**
 * Advances a walker one tick of input (`dx`, `dy`, any numbers; zero to
 * stand) at `speed` tiles a second, as fast as statuses allow (`pace`).
 * `among` stops it at tiles others stand on; `stopsAt` says a tile ends its
 * walk this tick when it arrives there (stairs, which carry it elsewhere).
 * Returns the walker as it is after the tick (the same object when nothing
 * moved).
 */
export function walkTiles(map: RegionMap, at: TileWalker, dx: number, dy: number, pace = 1, among?: Among, speed = PLAYER_SPEED, stopsAt?: (x: number, y: number) => boolean): TileWalker {
  if (pace <= 0) return at;
  let budget = speed * TICK_SECONDS * pace;
  let { x, y } = at;
  // A step is never more than a diagonal long: one farther off was left behind by a jump (a teleport, unsticking), not walked.
  let to = at.to && Math.hypot(at.to.tx + 0.5 - x, at.to.ty + 0.5 - y) <= 1.5 ? at.to : undefined;
  // At most a step to finish and one to start in a tick: steps are longer than a tick.
  for (let i = 0; i < 3 && budget > EPS; i++) {
    if (!to) {
      const want = wayOf(dx, dy);
      if (!want) break;
      const from = anchorNear(x, y);
      const way = chooseWay(map, from, want, at.floor, among);
      if (!way) {
        // Off a tile's middle (just arrived, or put there) and walled in that way: settle onto the tile.
        const mid = spotMiddle(from);
        if (Math.hypot(mid.x - x, mid.y - y) > EPS && openTile(map, from.tx, from.ty, at.floor)) to = from;
        else break;
      } else to = stepped(from, way);
    }
    const goal = spotMiddle(to);
    const left = Math.hypot(goal.x - x, goal.y - y);
    if (left <= budget) {
      budget -= left;
      x = goal.x;
      y = goal.y;
      to = undefined;
      if (stopsAt?.(x, y)) break;
    } else {
      x += ((goal.x - x) / left) * budget;
      y += ((goal.y - y) / left) * budget;
      budget = 0;
    }
  }
  if (x === at.x && y === at.y && to === at.to) return at;
  if (x === at.x && y === at.y && !to) return { x, y, floor: at.floor };
  return to ? { x, y, floor: at.floor, to } : { x, y, floor: at.floor };
}

/** True while a walker is between tiles: its step must be finished, so its input keeps being sent. */
export function midStep(at: Pick<TileWalker, 'to'>): boolean {
  return at.to !== undefined;
}
