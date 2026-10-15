import { hostname } from 'node:os';
import { TICK_SECONDS } from '@co-mmo/shared';
import type { ServerLoad } from './region-link.ts';

/** How many recent ticks the averages cover (5 s at 20 ticks a second). */
const KEPT = 100;

/**
 * Measures how hard a game process works: how long its ticks take, its
 * memory, and the errors it caught. The gateway and every region server keep
 * one, for God's View's Server health tab.
 */
export class LoadMeter {
  private times: number[] = [];
  private errors = 0;
  private lastError?: string;
  readonly startedAt: number;

  constructor(now: () => number = Date.now) {
    this.startedAt = now();
  }

  /** Runs one tick, timing it; an error is counted and logged rather than stopping the game. */
  tick(work: () => void): void {
    const started = performance.now();
    try {
      work();
    } catch (err) {
      this.failed(err);
    }
    this.times.push(performance.now() - started);
    if (this.times.length > KEPT) this.times.shift();
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
    if (!times.length) return 0;
    const share = times.reduce((a, b) => a + b, 0) / times.length / (TICK_SECONDS * 1000);
    return share > 0.8 ? 2 : share > 0.5 ? 1 : 0;
  }

  load(): ServerLoad {
    const times = this.times;
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      tickMs: times.length ? round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
      worstTickMs: round(Math.max(0, ...times)),
      memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
      errors: this.errors,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      host: hostname(),
      pid: process.pid,
      startedAt: this.startedAt,
    };
  }
}
