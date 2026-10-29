import { describe, expect, it } from 'vitest';
import { TickProfiler, aggregatePhaseTimings, KEPT } from '../src/region/profiler.ts';

describe('TickProfiler', () => {
  it('records accurate durations and updates rolling averages and worst values over 100 ticks', () => {
    const profiler = new TickProfiler();

    // Run 100 measurements for 'combat' with simulated elapsed times via record()
    for (let i = 1; i <= KEPT; i++) {
      profiler.record('combat', i); // 1ms through 100ms
    }

    const timings = profiler.timings();
    expect(timings.combat).toBeDefined();
    // Sum of 1..100 = 5050. Avg = 50.5 ms
    expect(timings.combat?.avgMs).toBe(50.5);
    expect(timings.combat?.worstMs).toBe(100);

    // Overwriting entries (tick 101 pushes 200, replacing 1)
    profiler.record('combat', 200);
    const updated = profiler.timings();
    // New sum = 5050 - 1 + 200 = 5249. Avg = 52.49 ms
    expect(updated.combat?.avgMs).toBe(52.49);
    expect(updated.combat?.worstMs).toBe(200);
  });

  it('measures synchronous functions and tracks current tick timings', () => {
    const profiler = new TickProfiler();
    profiler.startTick();

    const result = profiler.measure('inputs', () => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      return sum;
    });

    expect(result).toBe(499500);
    const current = profiler.currentPhases();
    expect(current.inputs).toBeGreaterThanOrEqual(0);

    const timings = profiler.timings();
    expect(timings.inputs?.worstMs).toBeGreaterThanOrEqual(0);
  });

  it('records durations inside finally and cleanly rethrows errors', () => {
    const profiler = new TickProfiler();
    const boom = new Error('simulated phase failure');

    expect(() => {
      profiler.measure('minds_think', () => {
        throw boom;
      });
    }).toThrow('simulated phase failure');

    const timings = profiler.timings();
    expect(timings.minds_think).toBeDefined();
    expect(timings.minds_think?.avgMs).toBeGreaterThanOrEqual(0);
    expect(timings.minds_think?.worstMs).toBeGreaterThanOrEqual(0);
  });

  it('introduces negligible overhead (< 0.05 ms overhead)', () => {
    const profiler = new TickProfiler();
    const noop = () => {};

    // Warm up JIT
    for (let i = 0; i < 500; i++) {
      profiler.measure('bench', noop);
    }
    profiler.clear();

    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      profiler.measure('bench', noop);
    }
    const elapsed = performance.now() - t0;
    const perCallMs = elapsed / 1000;

    // Overhead per call must be well below 0.05 ms
    expect(perCallMs).toBeLessThan(0.05);
  });

  it('aggregates phase timings across multiple sources for a host breakdown', () => {
    const breakdown = aggregatePhaseTimings([
      {
        id: 'woods',
        timings: {
          combat: { avgMs: 12.5, worstMs: 30.0 },
          snapshots: { avgMs: 5.0, worstMs: 8.0 },
        },
      },
      {
        id: 'catacombs',
        timings: {
          combat: { avgMs: 15.0, worstMs: 54.2 },
          rules: { avgMs: 2.0, worstMs: 4.0 },
        },
      },
    ]);

    expect(breakdown.phases.combat?.avgMs).toBe(27.5);
    expect(breakdown.phases.combat?.worstMs).toBe(54.2);
    expect(breakdown.phases.snapshots?.avgMs).toBe(5.0);
    expect(breakdown.phases.rules?.avgMs).toBe(2.0);

    expect(breakdown.slowestRegion).toEqual({
      id: 'catacombs',
      phase: 'combat',
      ms: 54.2,
    });
  });
});
