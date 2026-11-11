// Where the browser draws other players, frame by frame: the same shared
// smoothing the game's world scene uses (world-scene.ts onSnapshot and
// update), fed the same way, so the bench measures what a player sees.

import { Interpolator, SnapshotClock, TICK_SECONDS, type SnapshotMessage } from '@co-mmo/shared';

/** Other players as a browser would draw them. */
export class RemoteMotion {
  private readonly others = new Map<string, Interpolator>();
  private readonly clock = new SnapshotClock();

  /** A snapshot arrived at `now` (performance.now()). */
  snapshot(snapshot: SnapshotMessage, now: number): void {
    const shift = this.clock.arrived(snapshot.tick, now);
    if (shift) for (const interp of this.others.values()) interp.rebase(shift);
    const at = snapshot.tick * TICK_SECONDS * 1000;
    const seen = new Set<string>();
    for (const p of snapshot.players) {
      seen.add(p.id);
      let interp = this.others.get(p.id);
      if (!interp) this.others.set(p.id, (interp = new Interpolator()));
      interp.push(at, p.x, p.y);
    }
    // Far ones the snapshot only named (kept) are drawn on, as the browser does.
    const kept = new Set(snapshot.kept ?? []);
    for (const id of this.others.keys()) if (!seen.has(id) && !kept.has(id)) this.others.delete(id);
  }

  /** Where each other player is drawn at `now`. */
  *positions(now: number): Iterable<[string, { x: number; y: number }]> {
    const at = this.clock.renderAt(now);
    for (const [id, interp] of this.others) {
      const pos = interp.sample(at);
      if (pos) yield [id, pos];
    }
  }
}
