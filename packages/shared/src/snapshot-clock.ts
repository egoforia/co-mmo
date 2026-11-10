import { TICK_SECONDS } from './constants.ts';

/** How long arrivals are remembered to judge the network, ms. */
const WINDOW_MS = 3000;
/** Never drawn closer than this behind the server, ms, so a slightly late snapshot is already waiting. */
const MIN_DELAY_MS = 60;
/** Never drawn further behind than this, ms: past it, waiting costs more than it smooths. */
const MAX_DELAY_MS = 600;
/** How quickly the drawn time catches up with where it should be: the time it takes to close a gap, ms. */
const EASE_MS = 500;
/** A gap this big between the drawn and the wanted time is jumped rather than eased, ms. */
const SNAP_MS = 1000;
/**
 * How far the quickest-arrival estimate moves toward a later arrival, per
 * snapshot. A busy server ticks a little late now and then and never catches
 * up, so its ticks slowly fall behind real time; the estimate follows slowly,
 * and others are drawn a touch slower meanwhile instead of stopping.
 */
const DRIFT = 0.02;

/**
 * The server's clock as the browser sees it (docs/playtest.md, network bench).
 * Snapshots leave the server exactly one tick apart but arrive unevenly, so
 * others are drawn on the server's time, worked out from each snapshot's tick,
 * not on when it happened to arrive. The clock learns how much the network
 * wobbles and draws others just far enough behind the server that the next
 * snapshot is nearly always already here: about one gap between snapshots plus
 * the wobble. Ticks start over in each region (and each cell of a split one);
 * `arrived` notices and moves the timeline with them.
 */
export class SnapshotClock {
  /** Recent snapshots: when each arrived, its tick, and how much later than the quickest it came, ms. */
  private readonly arrivals: { at: number; late: number; tick: number }[] = [];
  /** Local time minus server time for a snapshot that met the least delay (see DRIFT). */
  private base?: number;
  private lastTick?: number;
  private lastAt = 0;
  /** The server time others are drawn at, and the local time that was worked out. */
  private drawn?: { server: number; local: number };

  constructor(private readonly tickMs = TICK_SECONDS * 1000) {}

  /**
   * A snapshot of `tick` arrived at local time `now` (performance.now()). Returns
   * how far the timeline moved, ms, when the ticks started over (a new region or
   * cell), so samples already kept can move with it; 0 otherwise.
   */
  arrived(tick: number, now: number): number {
    const server = tick * this.tickMs;
    let shift = 0;
    if (this.lastTick !== undefined) {
      // More ticks than time passed (plus a second's slack), or fewer than none: a new timeline.
      const elapsed = (now - this.lastAt) / this.tickMs;
      if (tick < this.lastTick || tick - this.lastTick > elapsed + 1000 / this.tickMs) {
        const before = now - (this.base ?? 0);
        shift = server - before;
        this.arrivals.length = 0;
        this.base = undefined;
        if (this.drawn) this.drawn.server += shift;
      }
    }
    this.lastTick = tick;
    this.lastAt = now;
    const offset = now - server;
    if (this.base === undefined || offset < this.base) this.base = offset;
    else this.base += (offset - this.base) * DRIFT;
    this.arrivals.push({ at: now, late: offset - this.base, tick });
    while (this.arrivals.length > 2 && now - this.arrivals[0]!.at > WINDOW_MS) this.arrivals.shift();
    return shift;
  }

  /** The server time to draw others at, for local time `now`. */
  renderAt(now: number): number {
    if (this.base === undefined) return now;
    const wanted = now - this.base - this.delay;
    const d = this.drawn;
    if (!d || Math.abs(d.server + (now - d.local) - wanted) > SNAP_MS) {
      this.drawn = { server: wanted, local: now };
      return wanted;
    }
    // Run a little fast or slow until caught up, rather than jumping: others never skip or reverse.
    const dt = Math.max(0, now - d.local);
    const ahead = d.server + dt;
    const server = ahead + (wanted - ahead) * Math.min(1, dt / EASE_MS);
    this.drawn = { server: Math.max(d.server, server), local: now };
    return this.drawn.server;
  }

  /** How far behind the server's newest snapshot others are drawn, ms. */
  get delay(): number {
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, this.gap + this.jitter + 10));
  }

  /** How much later than the quickest snapshot lately one in twenty arrived, ms: the network's wobble. */
  get jitter(): number {
    if (this.arrivals.length < 2) return 0;
    const late = this.arrivals.map((a) => a.late).sort((a, b) => a - b);
    return late[Math.floor(late.length * 0.95)]!;
  }

  /** The usual time between snapshots on the server, ms: one tick, or more in a crowd. */
  get gap(): number {
    const steps: number[] = [];
    for (let i = 1; i < this.arrivals.length; i++) steps.push(this.arrivals[i]!.tick - this.arrivals[i - 1]!.tick);
    if (!steps.length) return this.tickMs;
    steps.sort((a, b) => a - b);
    return Math.max(1, steps[Math.floor(steps.length / 2)]!) * this.tickMs;
  }
}
