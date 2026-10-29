import { hostname } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { TICK_SECONDS, type HostTickBreakdown, type PhaseTimings } from '@co-mmo/shared';
import type { ServerLoad } from './region-link.ts';

/** How many recent ticks the averages cover (5 s at 20 ticks a second). */
const KEPT = 100;
/** Ticks timed before the meter judges how pressed the process is. */
const MIN_TICKS = 10;
/** How long the event loop's delays are gathered before they start over, so the numbers say what is happening now. */
const LAG_WINDOW_MS = 10_000;
/** Ticks that take at least this long (50 ms) are considered slow ticks. */
export const SLOW_TICK_THRESHOLD_MS = TICK_SECONDS * 1000;

export interface LoadMeterOptions {
  /** Callback invoked when a tick takes longer than the threshold. */
  onSlowTick?: (totalMs: number, err?: unknown) => void;
  /** Supplies per-phase timing breakdown and slowest region for ServerLoad. */
  phaseBreakdown?: () => HostTickBreakdown | PhaseTimings | undefined;
  /** Slow-tick threshold in milliseconds (defaults to 50ms). */
  slowTickThresholdMs?: number;
}

/**
 * Measures how hard a game process works: how long its ticks take, its
 * memory, and the errors it caught. The gateway and every region server keep
 * one, for God's View's Server health tab.
 */
export class LoadMeter {
  private times: number[] = [];
  /** When each recent tick started, to count how many run a second. */
  private starts: number[] = [];
  private errors = 0;
  private lastError?: string;
  /** How late the event loop runs timers: a busy loop delays ticks, sockets and every request. */
  private readonly lag = monitorEventLoopDelay({ resolution: 10 });
  private lagSince: number;
  private lastLag = { lagMs: 0, worstLagMs: 0 };
  readonly startedAt: number;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly options: LoadMeterOptions = {},
  ) {
    this.startedAt = now();
    this.lagSince = now();
    this.lag.enable();
  }

  /** Sets or updates the slow tick callback. */
  setOnSlowTick(fn: (totalMs: number, err?: unknown) => void): void {
    this.options.onSlowTick = fn;
  }

  /** Sets or updates the phase breakdown provider. */
  setPhaseBreakdown(fn: () => HostTickBreakdown | PhaseTimings | undefined): void {
    this.options.phaseBreakdown = fn;
  }

  /** Runs one tick, timing it; an error is counted and logged rather than stopping the game. */
  tick(work: () => void): void {
    const started = performance.now();
    this.starts.push(started);
    if (this.starts.length > KEPT) this.starts.shift();
    let tickErr: unknown;
    try {
      work();
    } catch (err) {
      tickErr = err;
      this.failed(err);
    }
    const elapsed = performance.now() - started;
    this.times.push(elapsed);
    if (this.times.length > KEPT) this.times.shift();

    const threshold = this.options.slowTickThresholdMs ?? SLOW_TICK_THRESHOLD_MS;
    if (elapsed >= threshold) {
      try {
        this.options.onSlowTick?.(elapsed, tickErr);
      } catch (slowTickErr) {
        console.error('Failed to capture slow tick:', slowTickErr);
      }
    }
  }

  /** Counts an error caught somewhere in this process. */
  failed(err: unknown, label = 'Game error'): void {
    this.errors++;
    this.lastError = (err as Error)?.message ?? String(err);
    console.error(`${label}:`, err);
  }

  /**
   * How pressed this process is: 0 while ticks take under half the time
   * between them, 1 past half, 2 past four fifths. Regions send snapshots
   * less often to match (see snapshotEvery).
   */
  get strain(): number {
    const times = this.times.slice(-20);
    // A few ticks say little: the first ones run cold, before the code is warm.
    if (times.length < MIN_TICKS) return 0;
    const share = times.reduce((a, b) => a + b, 0) / times.length / (TICK_SECONDS * 1000);
    return share > 0.8 ? 2 : share > 0.5 ? 1 : 0;
  }

  /** Stops watching the event loop, when the process shuts down. */
  close(): void {
    this.lag.disable();
  }

  /** The event loop's delays since its window started; the window starts over every ten seconds. */
  private loopLag(): { lagMs: number; worstLagMs: number } {
    const ms = (ns: number) => Math.round(ns / 1e4) / 100;
    // Before the first sample the histogram reads as huge numbers; nothing measured is no delay.
    const now = this.lag.count ? { lagMs: ms(this.lag.percentile(50)), worstLagMs: ms(this.lag.percentile(99)) } : this.lastLag;
    if (this.now() - this.lagSince >= LAG_WINDOW_MS) {
      this.lastLag = now;
      this.lag.reset();
      this.lagSince = this.now();
    }
    return now;
  }

  /** Ticks run a second lately; below the tick rate means the process falls behind. */
  private ticksPerSecond(): number {
    const s = this.starts;
    if (s.length < 2) return 0;
    return Math.round(((s.length - 1) / ((s[s.length - 1]! - s[0]!) / 1000)) * 10) / 10;
  }

  load(): ServerLoad {
    const times = this.times;
    const round = (n: number) => Math.round(n * 100) / 100;
    const memory = process.memoryUsage();
    let phases: PhaseTimings | undefined;
    let slowestRegion: { id: string; phase: string; ms: number } | undefined;
    if (this.options.phaseBreakdown) {
      const breakdown = this.options.phaseBreakdown();
      if (breakdown) {
        if ('phases' in breakdown && typeof (breakdown as HostTickBreakdown).phases === 'object') {
          const hostBreakdown = breakdown as HostTickBreakdown;
          phases = hostBreakdown.phases;
          slowestRegion = hostBreakdown.slowestRegion;
        } else {
          phases = breakdown as PhaseTimings;
        }
      }
    }
    return {
      tickMs: times.length ? round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
      worstTickMs: round(Math.max(0, ...times)),
      ticksPerSecond: this.ticksPerSecond(),
      ...this.loopLag(),
      memoryMb: Math.round(memory.rss / 1_048_576),
      heapMb: Math.round(memory.heapUsed / 1_048_576),
      errors: this.errors,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      host: hostname(),
      pid: process.pid,
      startedAt: this.startedAt,
      ...(phases && Object.keys(phases).length > 0 ? { phases } : {}),
      ...(slowestRegion ? { slowestRegion } : {}),
    };
  }
}
