import type { RegionMap } from '../world.ts';
import { DIAGONAL_COST, STEP_WAYS, isDiagonal, stepped, type StepWay, type TileSpot } from './grid.ts';
import { canStep } from './steps.ts';

// The way to a tile, step by step (A* on the grid): clicking a tile to walk
// there, a creature closing on a free tile beside its prey, a frightened one
// running along paths rather than into walls.

/** What a route search needs to know about the one walking. */
export interface RouteAsk {
  from: TileSpot;
  /** Where it wants to be: any square the test passes. */
  arrived: (at: TileSpot) => boolean;
  /** A tile to head toward, for the estimate (usually the target). */
  toward: TileSpot;
  width?: number;
  floor?: number;
  /** False for squares someone else stands in (claims.ts); everything is free when missing. */
  free?: (at: TileSpot) => boolean;
  /** Gives up after looking at this many squares, so a route to nowhere costs little. */
  limit?: number;
}

/** Squares a route search looks at before giving up, unless asked. */
export const ROUTE_LIMIT = 2000;

const id = (t: TileSpot) => `${t.tx},${t.ty}`;

/** Steps, straight costing 1 and diagonal DIAGONAL_COST, from one tile to another in the open. */
function estimate(a: TileSpot, b: TileSpot): number {
  const dx = Math.abs(a.tx - b.tx);
  const dy = Math.abs(a.ty - b.ty);
  return Math.max(dx, dy) + (DIAGONAL_COST - 1) * Math.min(dx, dy);
}

/**
 * The cheapest steps from `from` to a square that has `arrived`: an empty
 * list when already there, undefined when there is no way within the limit.
 */
export function findTileRoute(map: RegionMap, ask: RouteAsk): StepWay[] | undefined {
  const width = ask.width ?? 1;
  const floor = ask.floor ?? 0;
  const limit = ask.limit ?? ROUTE_LIMIT;
  if (ask.arrived(ask.from)) return [];
  const cost = new Map<string, number>([[id(ask.from), 0]]);
  const came = new Map<string, { at: TileSpot; way: StepWay }>();
  // A small binary heap of [estimated total, tile].
  const open: [number, TileSpot][] = [[estimate(ask.from, ask.toward), ask.from]];
  const push = (item: [number, TileSpot]) => {
    open.push(item);
    for (let i = open.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (open[up]![0] <= open[i]![0]) break;
      [open[up], open[i]] = [open[i]!, open[up]!];
      i = up;
    }
  };
  const pop = (): [number, TileSpot] => {
    const top = open[0]!;
    const last = open.pop()!;
    if (open.length) {
      open[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < open.length && open[l]![0] < open[m]![0]) m = l;
        if (r < open.length && open[r]![0] < open[m]![0]) m = r;
        if (m === i) break;
        [open[m], open[i]] = [open[i]!, open[m]!];
        i = m;
      }
    }
    return top;
  };
  let looked = 0;
  while (open.length && looked < limit) {
    const [, at] = pop();
    looked++;
    if (ask.arrived(at)) {
      const ways: StepWay[] = [];
      for (let k = id(at); came.has(k); ) {
        const prev = came.get(k)!;
        ways.push(prev.way);
        k = id(prev.at);
      }
      return ways.reverse();
    }
    const here = cost.get(id(at))!;
    for (const way of STEP_WAYS) {
      const next = stepped(at, way);
      if (!canStep(map, at, way, width, floor)) continue;
      // The goal may be occupied by the one sought; any other square must be free.
      if (ask.free && !ask.free(next) && !ask.arrived(next)) continue;
      const total = here + (isDiagonal(way) ? DIAGONAL_COST : 1);
      const k = id(next);
      if (total >= (cost.get(k) ?? Infinity)) continue;
      cost.set(k, total);
      came.set(k, { at, way });
      push([total + estimate(next, ask.toward), next]);
    }
  }
  return undefined;
}
