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

/**
 * True when someone the mover is stopped by stands on a tile, or is stepping
 * onto it. A body stands on every tile its round body reaches into, so one
 * halfway through a step holds both tiles.
 */
export function tileTaken(among: Among | undefined, tile: TileSpot, floor: number): boolean {
  if (!among) return false;
  const mid = spotMiddle(tile);
  const self = among.self;
  for (const o of among.bodies.near(mid.x, mid.y, 1)) {
    if (o === self || (self.of !== undefined && o.of === self.of)) continue;
    if ((o.floor ?? 0) !== floor || !stoppedBy(self.kind, o.kind) || among.passes?.(o)) continue;
    if (o.to && o.to.tx === tile.tx && o.to.ty === tile.ty) return true;
    const reach = 0.5 + o.r - 0.05;
    if (Math.abs(o.x - mid.x) < reach && Math.abs(o.y - mid.y) < reach) return true;
  }
  return false;
}

/** The way to step for an input, from a tile: straight on, else (for a diagonal) along one side of it; undefined when nothing is open. */
function chooseWay(map: RegionMap, from: TileSpot, want: StepWay, floor: number, among?: Among): StepWay | undefined {
  const tries: StepWay[] = isDiagonal(want) ? [want, { dx: want.dx, dy: 0 }, { dx: 0, dy: want.dy }] : [want];
  return tries.find((w) => canStep(map, from, w, 1, floor) && !tileTaken(among, stepped(from, w), floor));
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
  let to = at.to;
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
  return to ? { x, y, floor: at.floor, to } : { x, y, floor: at.floor };
}

/** True while a walker is between tiles: its step must be finished, so its input keeps being sent. */
export function midStep(at: Pick<TileWalker, 'to'>): boolean {
  return at.to !== undefined;
}
