import { VIEW_RADIUS, type RegionDef } from '@co-mmo/shared';
import type { Ghosts } from '../region.ts';
import { round } from '../region-views.ts';

// Seeing across region edges (docs/scale.md, Smooth play on any connection).
// Each region shows the regions around it, corners too, what stands within
// sight of its edges, as the cells of a split region already do across their
// borders. The world passes each region's border on, moved to where it lies
// from the neighbour's own corner, so a player two tiles over a road edge is
// drawn where they stand, and crossing keeps everyone on screen.

/** How far in from its edges a region shows what stands there: as far as anyone sees. */
export const BORDER = VIEW_RADIUS;
/** Word from a neighbour older than this many ticks is dropped (it moved away, or went quiet). */
export const BEYOND_TICKS = 10;

/** True when nothing is in it. */
export function empty(g: Ghosts): boolean {
  return !g.players.length && !g.creatures.length && !g.bodies.length && !g.npcs.length;
}

/** True when (x, y) lies within sight of an edge of a region `size` tiles wide. */
export function nearEdge(x: number, y: number, size: number): boolean {
  return x < BORDER || y < BORDER || x >= size - BORDER || y >= size - BORDER;
}

/**
 * What `from` shows near its edges, as `to` sees it: counted from `to`'s
 * corner, keeping only what stands within sight of `to`. Bodies and wished
 * creatures are numbered per region, so theirs carry the region's name in
 * front to stay apart from `to`'s own; players and the land's own creatures
 * keep theirs, so the browser keeps drawing them when its player crosses.
 */
export function across(g: Ghosts, from: RegionDef, to: RegionDef, size: number): Ghosts {
  const dx = (from.at.x - to.at.x) * size;
  const dy = (from.at.y - to.at.y) * size;
  const inSight = (e: { x: number; y: number }) => {
    const x = e.x + dx;
    const y = e.y + dy;
    return x >= -BORDER && y >= -BORDER && x < size + BORDER && y < size + BORDER;
  };
  const move = <E extends { id: string; x: number; y: number }>(list: E[], rename: (id: string) => string): E[] =>
    list.filter(inSight).map((e) => ({ ...e, id: rename(e.id), x: round(e.x + dx), y: round(e.y + dy) }));
  const own = (id: string) => id;
  const theirs = (id: string) => `${from.id}:${id}`;
  return {
    players: move(g.players, own),
    creatures: move(g.creatures, (id) => (id.startsWith(`${from.id}-`) ? id : theirs(id))),
    bodies: move(g.bodies, theirs),
    npcs: move(g.npcs, own),
  };
}

/**
 * What the regions around one show it, by who said it (a region's id or a
 * cell's key), each kept until the neighbour next says or goes quiet.
 */
export class Beyond {
  private readonly heard = new Map<string, { ghosts: Ghosts; tick: number }>();

  /** `from` showed this; nothing in it forgets them at once. */
  set(from: string, ghosts: Ghosts, tick: number): void {
    if (empty(ghosts)) this.heard.delete(from);
    else this.heard.set(from, { ghosts, tick });
  }

  /** Everything still fresh at `tick`. */
  *all(tick: number): Iterable<Ghosts> {
    for (const [from, h] of this.heard) {
      if (tick - h.tick > BEYOND_TICKS) this.heard.delete(from);
      else yield h.ghosts;
    }
  }
}
