import { BodyGrid, PERSON_RADIUS, bodyOf, creatureRadius, type Among, type Bodies, type BodyKind, type HitBody, type RegionMap } from '@co-mmo/shared';
import type { Ghosts } from '../region.ts';
import { findSpots } from '../walkers.ts';
import type { Creature } from '../creature-brain.ts';
import type { PlayerState, RegionState } from './state.ts';

// The bodies standing in a region this tick (shared hit-boxes.ts), gathered
// once at the start of each tick so every player, creature and person moving
// in it is stopped by the others. Players on their feet, live creatures and
// the region's people all stand in it, and so do those a cell beside this one
// shows near the border (a split region), so nobody walks into someone just
// over the line. The Fallen and the Hidden stand in nobody's way.

/** Who stands where in a region this tick. */
export class Crowd {
  private grid: BodyGrid = new BodyGrid();

  constructor(
    private readonly s: RegionState,
    /** True for a player nothing should bump into (Fallen or Hidden). */
    private readonly unseen: (p: PlayerState) => boolean,
  ) {}

  /** Gathers everyone where they stand now; `ghosts` are what the cells beside this one show. */
  gather(ghosts: Iterable<Ghosts> = []): void {
    const grid = new BodyGrid();
    for (const p of this.s.players.values()) if (!this.unseen(p)) grid.add(bodyOf(p, PERSON_RADIUS, 'player'));
    for (const c of this.s.creatures) if (c.respawnAt === null) grid.add(bodyOf(c, creatureRadius(c.def.size), 'creature'));
    for (const n of this.s.townsfolk) grid.add(bodyOf(n, PERSON_RADIUS, 'npc'));
    for (const g of ghosts) {
      for (const e of g.players) if (!e.fallen) grid.add(still(e, PERSON_RADIUS, 'player'));
      for (const e of g.creatures) grid.add(still(e, creatureRadius(e.size), 'creature'));
      for (const e of g.npcs) grid.add(still(e, PERSON_RADIUS, 'npc'));
    }
    this.grid = grid;
  }

  /** Everyone gathered this tick, for creatures and people finding their way. */
  get bodies(): Bodies {
    return this.grid;
  }

  /** A player stepping among the others: stopped by creatures only (hit-boxes.ts stoppedBy). */
  forPlayer(p: PlayerState): Among {
    return { self: { r: PERSON_RADIUS, kind: 'player', floor: p.floor, of: p }, bodies: this.grid };
  }
}

/** A body that stays put this tick: one shown from across a cell's border. */
function still(e: { x: number; y: number; floor?: number }, r: number, kind: BodyKind): HitBody {
  return { x: e.x, y: e.y, floor: e.floor ?? 0, r, kind };
}

/**
 * Gives creatures put on one spot (a land's places often hold several kinds)
 * homes of their own close by, so they do not start inside one another and
 * stand stacked whenever they go home. The first on a spot keeps it; the
 * order is the land's, so every server works out the same homes.
 */
export function spreadHomes(map: RegionMap, creatures: Creature[]): void {
  const placed: Creature[] = [];
  for (const c of creatures) {
    const r = creatureRadius(c.def.size);
    const clear = (x: number, y: number) => placed.every((o) => o.home.floor !== c.home.floor || Math.hypot(o.home.x - x, o.home.y - y) >= r + creatureRadius(o.def.size));
    if (!clear(c.home.x, c.home.y)) {
      const spot = findSpots(map, c.home.x, c.home.y, 24, 0.75, 4, c.home.floor).find((s) => clear(s.x, s.y));
      if (spot) {
        c.home = { x: spot.x, y: spot.y, floor: c.home.floor };
        c.x = spot.x;
        c.y = spot.y;
      }
    }
    placed.push(c);
  }
}
