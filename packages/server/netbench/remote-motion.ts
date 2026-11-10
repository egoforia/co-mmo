// Where the browser draws other players, frame by frame: the same shared
// smoothing the game's world scene uses (world-scene/avatars.ts), fed the
// same way, so the bench measures what a player sees.

import { Interpolator, type SnapshotMessage } from '@co-mmo/shared';

/** Other players as a browser would draw them. */
export class RemoteMotion {
  private readonly others = new Map<string, Interpolator>();

  /** A snapshot arrived at `now` (performance.now()). */
  snapshot(snapshot: SnapshotMessage, now: number): void {
    const seen = new Set<string>();
    for (const p of snapshot.players) {
      seen.add(p.id);
      let interp = this.others.get(p.id);
      if (!interp) this.others.set(p.id, (interp = new Interpolator()));
      interp.push(now, p.x, p.y);
    }
    for (const id of this.others.keys()) if (!seen.has(id)) this.others.delete(id);
  }

  /** Where each other player is drawn at `now`. */
  *positions(now: number): Iterable<[string, { x: number; y: number }]> {
    for (const [id, interp] of this.others) {
      const pos = interp.sample(now);
      if (pos) yield [id, pos];
    }
  }
}
