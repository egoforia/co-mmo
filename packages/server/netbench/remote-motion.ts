// Where the browser draws other players and creatures, frame by frame: the
// same shared smoothing the game's world scene uses (world-scene.ts
// onSnapshot and update, near-present.ts for creatures beside us), fed the
// same way, so the bench measures what a player sees.

import { Interpolator, SnapshotClock, TICK_SECONDS, type SnapshotMessage } from '@co-mmo/shared';
import { creatureSpot, drawnSpot, settleJump, type DrawTimes } from '../../client/src/world-scene/near-present.ts';
import type { Remote } from '../../client/src/world-scene/types.ts';

/** A creature as the browser keeps it: its smoothing, a jump still being smoothed, and how fast the server moved it lately. */
interface Seen {
  remote: Remote;
  last?: { x: number; y: number; tick: number };
  /** Its speed between its last few snapshots a tick apart, tiles a second. */
  paces: number[];
}

/** Other players and creatures as a browser would draw them. */
export class RemoteMotion {
  private readonly others = new Map<string, Interpolator>();
  private readonly creatures = new Map<string, Seen>();
  private readonly clock = new SnapshotClock();
  /** Where our own player stood in the newest snapshot. */
  private me = { x: 0, y: 0 };

  /** A snapshot arrived at `now` (performance.now()). */
  snapshot(snapshot: SnapshotMessage, now: number): void {
    const was = new Map([...this.creatures].map(([id, c]) => [id, creatureSpot(c.remote, this.me, this.times(now))]));
    const shift = this.clock.arrived(snapshot.tick, now);
    if (shift) {
      for (const interp of this.others.values()) interp.rebase(shift);
      for (const c of this.creatures.values()) c.remote.interp.rebase(shift);
    }
    this.me = { x: snapshot.x, y: snapshot.y };
    const at = snapshot.tick * TICK_SECONDS * 1000;
    const seen = new Set<string>();
    for (const p of snapshot.players) {
      seen.add(p.id);
      let interp = this.others.get(p.id);
      if (!interp) this.others.set(p.id, (interp = new Interpolator()));
      interp.push(at, p.x, p.y);
    }
    for (const e of snapshot.creatures ?? []) {
      seen.add(e.id);
      let c = this.creatures.get(e.id);
      if (!c) this.creatures.set(e.id, (c = { remote: { interp: new Interpolator() } as unknown as Remote, paces: [] }));
      c.remote.interp.push(at, e.x, e.y, e.to);
      if (c.last && snapshot.tick - c.last.tick === 1) c.paces = [...c.paces.slice(-2), Math.hypot(e.x - c.last.x, e.y - c.last.y) / TICK_SECONDS];
      else c.paces = [];
      c.last = { x: e.x, y: e.y, tick: snapshot.tick };
      if (was.has(e.id)) settleJump(c.remote, was.get(e.id)!, creatureSpot(c.remote, this.me, this.times(now)));
    }
    // Far ones the snapshot only named (kept) are drawn on, as the browser does.
    const kept = new Set(snapshot.kept ?? []);
    for (const id of this.others.keys()) if (!seen.has(id) && !kept.has(id)) this.others.delete(id);
    for (const id of this.creatures.keys()) if (!seen.has(id) && !kept.has(id)) this.creatures.delete(id);
  }

  /** Where each other player is drawn at `now`. */
  *positions(now: number): Iterable<[string, { x: number; y: number }]> {
    const at = this.clock.renderAt(now);
    for (const [id, interp] of this.others) {
      const pos = interp.sample(at);
      if (pos) yield [id, pos];
    }
  }

  /**
   * Where each creature is drawn at `now`, `dtMs` after the last frame, and
   * how fast the server was moving it when it walked steadily (undefined
   * while it starts, stops or turns its pace).
   */
  *creaturePositions(now: number, dtMs: number): Iterable<[string, { x: number; y: number }, number | undefined]> {
    const times = this.times(now);
    for (const [id, c] of this.creatures) {
      const pos = drawnSpot(c.remote, this.me, times, dtMs);
      if (!pos) continue;
      const p = c.paces;
      const steady = p.length === 3 && p[0]! > 0.3 && p.every((v) => Math.abs(v - p[0]!) <= p[0]! * 0.05);
      yield [id, pos, steady ? p[2] : undefined];
    }
  }

  private times(now: number): DrawTimes {
    return { past: this.clock.renderAt(now), present: this.clock.present(now) };
  }
}
