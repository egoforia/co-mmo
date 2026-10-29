import type { HostTickBreakdown, PhaseTiming, PhaseTimings } from '@co-mmo/shared';

/** How many recent ticks the averages and worst times cover (5 s at 20 ticks a second). */
export const KEPT = 100;

class PhaseHistory {
  readonly samples = new Float64Array(KEPT);
  head = 0;
  count = 0;
  sum = 0;

  add(ms: number): void {
    const old = this.count === KEPT ? this.samples[this.head]! : 0;
    this.samples[this.head] = ms;
    this.head = (this.head + 1) % KEPT;
    if (this.count < KEPT) this.count++;
    this.sum += ms - old;
  }

  summary(): PhaseTiming {
    if (this.count === 0) return { avgMs: 0, worstMs: 0 };
    let worst = 0;
    for (let i = 0; i < this.count; i++) {
      const val = this.samples[i]!;
      if (val > worst) worst = val;
    }
    return {
      avgMs: Math.round((this.sum / this.count) * 100) / 100,
      worstMs: Math.round(worst * 100) / 100,
    };
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.sum = 0;
    this.samples.fill(0);
  }
}

/**
 * Lightweight per-phase tick profiler. Times simulation phases with
 * performance.now() and maintains 100-tick rolling averages and worst times.
 */
export class TickProfiler {
  private readonly histories = new Map<string, PhaseHistory>();
  private current: Record<string, number> = {};

  /** Runs and times a phase, recording its elapsed duration even on error. */
  measure<T>(phase: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.record(phase, performance.now() - t0);
    }
  }

  /** Records a duration directly for a named phase. */
  record(phase: string, ms: number): void {
    let history = this.histories.get(phase);
    if (!history) {
      history = new PhaseHistory();
      this.histories.set(phase, history);
    }
    history.add(ms);
    this.current[phase] = Math.round(((this.current[phase] ?? 0) + ms) * 100) / 100;
  }

  /** Starts a new tick, resetting the per-phase timings captured for the current tick. */
  startTick(): void {
    this.current = {};
  }

  /** The per-phase durations recorded during the current/most recent tick. */
  currentPhases(): Record<string, number> {
    return { ...this.current };
  }

  /** The rolling averages and worst durations over the recent window for all recorded phases. */
  timings(): PhaseTimings {
    const result: PhaseTimings = {};
    for (const [phase, history] of this.histories) {
      result[phase] = history.summary();
    }
    return result;
  }

  /** Clears all rolling history and current phase timings. */
  clear(): void {
    this.histories.clear();
    this.current = {};
  }
}

/**
 * Combines phase timings from multiple profilers (e.g. regions on a host) into
 * a single host breakdown.
 */
export function aggregatePhaseTimings(
  sources: { id: string; timings: PhaseTimings }[]
): HostTickBreakdown {
  const phases: PhaseTimings = {};
  let slowest: { id: string; phase: string; ms: number } | undefined;

  for (const { id, timings } of sources) {
    for (const [phase, timing] of Object.entries(timings)) {
      if (!phases[phase]) {
        phases[phase] = { avgMs: 0, worstMs: 0 };
      }
      phases[phase]!.avgMs = Math.round((phases[phase]!.avgMs + timing.avgMs) * 100) / 100;
      phases[phase]!.worstMs = Math.max(phases[phase]!.worstMs, timing.worstMs);
      if (!slowest || timing.worstMs > slowest.ms) {
        slowest = { id, phase, ms: timing.worstMs };
      }
    }
  }

  return {
    phases,
    ...(slowest && slowest.ms > 0 ? { slowestRegion: slowest } : {}),
  };
}
