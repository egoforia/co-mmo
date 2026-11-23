// Creatures beside our own player are drawn on the server's present.
//
// Everyone else is drawn a little in the past (SnapshotClock), so their
// walk stays smooth however unevenly snapshots arrive. Our own player is
// predicted, drawn in the present. Far off nobody can tell, but a monster
// walking at us was drawn short of where it stood: it struck from a tile it
// had not yet reached, and we bumped into it before it got there. So within
// a few tiles a creature is carried on to the present along the step it is
// taking (Interpolator.ahead, never past the step's end), blending into the
// smooth past farther off. A jump a new snapshot makes is smoothed away
// over a moment instead of shown.

import type { Remote } from './types.ts';

/** Within this many tiles of our player (along either axis), a creature is drawn on the server's present. */
export const PRESENT_NEAR = 3;
/** From this many tiles off it is drawn on the smooth past, as everyone else; in between, a blend. */
export const PRESENT_FAR = 7;
/** How long a jump from a new snapshot takes to smooth away: about two thirds of it in this many ms (long enough to hide a late snapshot's catch-up). */
const SETTLE_MS = 150;
/** A jump bigger than this, tiles, is shown at once (it respawned, took the stairs). */
const SNAP_TILES = 1.5;

type Spot = { x: number; y: number };

/** The server times things are drawn at: the smooth past and the present. */
export interface DrawTimes {
  past: number;
  present: number;
}

/** How much of the present a creature at `at` is drawn with, near our player `me`: 1 close by, 0 far off. */
export function nearness(me: Spot, at: Spot): number {
  const d = Math.max(Math.abs(at.x - me.x), Math.abs(at.y - me.y));
  return Math.max(0, Math.min(1, (PRESENT_FAR - d) / (PRESENT_FAR - PRESENT_NEAR)));
}

/** Where a creature stands at these times, near `me`, before any jump is smoothed. */
export function creatureSpot(remote: Remote, me: Spot, times: DrawTimes): Spot | null {
  const past = remote.interp.sample(times.past);
  if (!past) return null;
  const w = nearness(me, past);
  if (w <= 0) return past;
  const now = remote.interp.ahead(times.present) ?? past;
  return { x: past.x + (now.x - past.x) * w, y: past.y + (now.y - past.y) * w };
}

/**
 * A snapshot came: `was` is where the creature stood just before it, `is`
 * where the same moment now says. The difference is kept and smoothed away.
 */
export function settleJump(remote: Remote, was: Spot | null, is: Spot | null): void {
  if (!was || !is) return;
  const x = (remote.settle?.x ?? 0) + was.x - is.x;
  const y = (remote.settle?.y ?? 0) + was.y - is.y;
  remote.settle = Math.hypot(x, y) > SNAP_TILES ? undefined : { x, y };
}

/** Where to draw a creature this frame, `dtMs` after the last: where it stands plus what is left of a jump. */
export function drawnSpot(remote: Remote, me: Spot, times: DrawTimes, dtMs: number): Spot | null {
  const at = creatureSpot(remote, me, times);
  if (!at) return null;
  const s = remote.settle;
  if (!s) return at;
  const k = Math.exp(-Math.max(0, dtMs) / SETTLE_MS);
  s.x *= k;
  s.y *= k;
  if (Math.hypot(s.x, s.y) < 1e-3) remote.settle = undefined;
  return { x: at.x + s.x, y: at.y + s.y };
}
