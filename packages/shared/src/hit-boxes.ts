import { PLAYER_RADIUS } from './constants.ts';
import type { CreatureSizeTier } from './walk.ts';

// Hit boxes: every player, creature and person stands in a round body of
// their own, so nobody stands where someone else stands. Bodies are what
// limit how many creatures can reach one player at once: as many as fit in a
// ring about them, about six of a player's size. Wall boxes (movement.ts
// collides) are separate: these are only bodies against bodies.
//
// Who blocks whom (the defaults chosen with the first version):
// - creatures are stopped by players, people and other creatures;
// - people (NPCs) are stopped by everyone too, and step out of the way of
//   anyone who walks into them (walkers.ts standClear);
// - players are stopped by creatures only: they walk through other players,
//   so nobody can wall off a doorway, a shrine or a shop, and people make way
//   for them, so someone who stops to talk in a doorway never shuts it.
// The Fallen and the Hidden have no body: creatures walk over the one and
// would give the other away.
//
// A move is refused only when it presses further into someone than the mover
// already is, so two bodies that end up overlapping (a blink, a respawn, an
// arrival) can always step apart, and nobody is ever stuck inside another.

/** What kind of body it is, which says who it stops. */
export type BodyKind = 'player' | 'creature' | 'npc';

/** A body standing somewhere: its middle, floor and radius in tiles. */
export interface HitBody {
  x: number;
  y: number;
  floor?: number;
  /** Half its width, in tiles. */
  r: number;
  kind: BodyKind;
  /** The player, creature or person it belongs to, so a mover never bumps into itself. */
  of?: object;
}

/**
 * The body of something that moves: it reads where it stands from the thing
 * itself, so it stays right as the thing walks during a tick.
 */
export function bodyOf(of: { x: number; y: number; floor?: number }, r: number, kind: BodyKind): HitBody {
  return {
    get x() { return of.x; },
    get y() { return of.y; },
    get floor() { return of.floor ?? 0; },
    r,
    kind,
    of,
  };
}

/** How wide each creature size stands, as a radius in tiles; a medium one stands as wide as a player. */
export const BODY_RADII: Record<CreatureSizeTier, number> = {
  tiny: 0.18,
  small: 0.24,
  medium: PLAYER_RADIUS,
  high: 0.4,
  colossal: 0.6,
};

/** A player's and a person's body radius: the same as their wall box. */
export const PERSON_RADIUS = PLAYER_RADIUS;

/** The body radius of a creature of this size (medium when it does not say). */
export function creatureRadius(size?: CreatureSizeTier): number {
  return BODY_RADII[size ?? 'medium'];
}

/**
 * How much farther than a player-sized one a creature of this size reaches,
 * and is reached from: its body is that much wider, so a big creature is hit
 * and hits from its edge, not its middle.
 */
export function sizeReach(size?: CreatureSizeTier): number {
  return creatureRadius(size) - PERSON_RADIUS;
}

/** True when a body of `mover`'s kind is stopped by one of `other`'s kind. */
export function stoppedBy(mover: BodyKind, other: BodyKind): boolean {
  return mover !== 'player' || other === 'creature';
}

/** Overlaps smaller than this are rounding, not a press. */
const SLACK = 1e-6;

/** A step from one point to another. */
type Spot = { x: number; y: number };

/** True when `o` is `self` or belongs to the same thing. */
function same(self: Mover, o: HitBody): boolean {
  return o === self || (self.of !== undefined && o.of === self.of);
}

/** What moves: its kind, size, floor and what it is (to skip itself among the bodies). */
export type Mover = Pick<HitBody, 'r' | 'kind' | 'floor' | 'of'>;

/**
 * True when a step by `self` from `from` to `to` would press further into a
 * body it is stopped by. `others` may hold `self`; it is skipped.
 */
export function pressesInto(self: Mover, from: Spot, to: Spot, others: Iterable<HitBody>): boolean {
  const floor = self.floor ?? 0;
  for (const o of others) {
    if (same(self, o) || (o.floor ?? 0) !== floor || !stoppedBy(self.kind, o.kind)) continue;
    const touch = self.r + o.r;
    const after = touch - Math.hypot(o.x - to.x, o.y - to.y);
    if (after <= SLACK) continue;
    const before = touch - Math.hypot(o.x - from.x, o.y - from.y);
    if (after > before + SLACK) return true;
  }
  return false;
}

/**
 * Which way, and how far, `self` standing at `at` must move to stand clear of
 * every body it is inside and stopped by: the sum of each overlap, pointing
 * away from that body. Zero when it stands clear. Two on the very same spot
 * part in a random direction.
 */
export function pushOut(self: Mover, at: Spot, others: Iterable<HitBody>, random: () => number): Spot {
  const floor = self.floor ?? 0;
  let x = 0;
  let y = 0;
  for (const o of others) {
    if (same(self, o) || (o.floor ?? 0) !== floor || !stoppedBy(self.kind, o.kind)) continue;
    const d = Math.hypot(at.x - o.x, at.y - o.y);
    const over = self.r + o.r - d;
    if (over <= SLACK) continue;
    if (d < SLACK) {
      const a = random() * Math.PI * 2;
      x += Math.cos(a) * over;
      y += Math.sin(a) * over;
    } else {
      x += ((at.x - o.x) / d) * over;
      y += ((at.y - o.y) / d) * over;
    }
  }
  return { x, y };
}

/** Bodies someone moving might run into: a plain list in the browser, a grid on the server. */
export interface Bodies {
  /** The bodies that could touch a body of radius `r` standing near (x, y). */
  near(x: number, y: number, r: number): Iterable<HitBody>;
}

/** Bodies as a plain list, for a handful of them (the browser predicting its own player). */
export function bodyList(list: HitBody[]): Bodies {
  return { near: () => list };
}

/** Grid squares are this many tiles across. */
const CELL = 4;

/**
 * Bodies sorted into squares of the land, so a region with hundreds of
 * creatures checks only those close by. It holds the bodies themselves, so
 * one that moves during the tick is seen where it is now; it is found from
 * the squares about the one it was added in, which is enough as long as
 * nothing moves more than a square's width before the grid is built again
 * (each tick).
 */
export class BodyGrid implements Bodies {
  private readonly cells = new Map<number, HitBody[]>();

  constructor(bodies: Iterable<HitBody> = []) {
    for (const b of bodies) this.add(b);
  }

  /** Adds a body where it stands now. */
  add(b: HitBody): void {
    const key = this.key(Math.floor(b.x / CELL), Math.floor(b.y / CELL));
    const cell = this.cells.get(key);
    if (cell) cell.push(b);
    else this.cells.set(key, [b]);
  }

  *near(x: number, y: number, _r?: number): Iterable<HitBody> {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const cell = this.cells.get(this.key(gx, gy));
        if (cell) yield* cell;
      }
    }
  }

  private key(gx: number, gy: number): number {
    // Regions are at most a few hundred tiles across, and a little outside them.
    return (gy + 1024) * 4096 + (gx + 1024);
  }
}

/** True when `self` may step from `from` to `to` as far as the bodies about it go. */
export function roomFor(self: Mover, from: Spot, to: Spot, bodies?: Bodies): boolean {
  return !bodies || !pressesInto(self, from, to, bodies.near(to.x, to.y, self.r));
}

/** Someone moving among bodies: who they are and the bodies about them. */
export interface Among {
  self: Mover;
  bodies: Bodies;
}
