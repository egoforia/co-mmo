import { step, type Vec2 } from './movement.ts';
import type { RegionMap } from './world.ts';

export interface PendingInput {
  seq: number;
  dx: number;
  dy: number;
}

/**
 * Client-side prediction for the local player: inputs move the player
 * immediately, and each server snapshot rewinds to the authoritative
 * position and replays the inputs the server has not applied yet.
 */
export class Predictor {
  private pending: PendingInput[] = [];
  private seq: number;
  position: Vec2;

  /**
   * `lastSeq` carries numbering over when the player changes region, since
   * the server ignores any input numbered at or below one it has applied.
   * `carried` are inputs predicted before the change; the server carries
   * those after `start` over too, so they are replayed here and the player
   * walks on without a jump.
   */
  constructor(private readonly map: RegionMap, start: Vec2, lastSeq = 0, carried: PendingInput[] = [], ack = 0) {
    this.position = { ...start };
    this.seq = lastSeq;
    if (carried.length) {
      this.pending = carried.slice();
      this.reconcile(ack, start);
    }
  }

  get lastSeq(): number {
    return this.seq;
  }

  /** Inputs sent but not yet applied by the server, oldest first. */
  get unapplied(): PendingInput[] {
    return this.pending.slice();
  }

  /** Applies one tick of input locally; returns the message to send. */
  apply(dx: number, dy: number): PendingInput {
    const input = { seq: ++this.seq, dx, dy };
    this.pending.push(input);
    this.position = step(this.map, this.position, dx, dy);
    return input;
  }

  /** Reconciles with the server's state after it applied input `ack`. */
  reconcile(ack: number, server: Vec2): void {
    this.pending = this.pending.filter((i) => i.seq > ack);
    let pos: Vec2 = { x: server.x, y: server.y };
    for (const input of this.pending) pos = step(this.map, pos, input.dx, input.dy);
    this.position = pos;
  }

  get unacknowledged(): number {
    return this.pending.length;
  }
}

interface Sample {
  at: number;
  x: number;
  y: number;
}

/**
 * Smooths other players' movement by rendering them slightly in the past,
 * between the two snapshots around that moment. When snapshots come further
 * apart (a crowded region sends them less often), it looks further back, so
 * movement stays smooth instead of stopping and jumping.
 */
export class Interpolator {
  private samples: Sample[] = [];

  constructor(private readonly delayMs = 100) {}

  push(at: number, x: number, y: number): void {
    this.samples.push({ at, x, y });
    if (this.samples.length > 20) this.samples.shift();
  }

  /** How far in the past it renders: the usual delay, or a little more than the time between snapshots. */
  get delay(): number {
    const gaps: number[] = [];
    for (let i = Math.max(1, this.samples.length - 5); i < this.samples.length; i++) gaps.push(this.samples[i]!.at - this.samples[i - 1]!.at);
    if (!gaps.length) return this.delayMs;
    gaps.sort((a, b) => a - b);
    return Math.max(this.delayMs, gaps[Math.floor(gaps.length / 2)]! * 1.25);
  }

  sample(now: number): Vec2 | null {
    if (this.samples.length === 0) return null;
    const t = now - this.delay;
    const first = this.samples[0]!;
    if (t <= first.at) return { x: first.x, y: first.y };
    for (let i = this.samples.length - 1; i > 0; i--) {
      const a = this.samples[i - 1]!;
      const b = this.samples[i]!;
      if (t >= a.at && t <= b.at) {
        const f = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    const last = this.samples[this.samples.length - 1]!;
    return { x: last.x, y: last.y };
  }
}
