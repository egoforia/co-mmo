import { describe, expect, it } from 'vitest';
import { SlowTickBuffer } from '../src/debug/slow-tick-buffer.ts';
import { LoadMeter, SLOW_TICK_THRESHOLD_MS } from '../src/load-meter.ts';
import { Region } from '../src/region.ts';
import { WORLD_REGIONS } from '@co-mmo/shared';

describe('SlowTickBuffer', () => {
  it('records entries and wraps at capacity (20 entries) without memory leak', () => {
    const buffer = new SlowTickBuffer(20);

    for (let i = 1; i <= 25; i++) {
      buffer.record({
        at: 1000 + i,
        host: 'gateway',
        region: 'woods',
        totalMs: 50 + i,
        phases: { combat: 30, minds_think: 20 + i },
        players: i,
        creatures: 5,
        activeStatuses: 2,
      });
    }

    expect(buffer.size).toBe(20);
    const list = buffer.list();
    expect(list.length).toBe(20);

    // Newest first
    expect(list[0]?.totalMs).toBe(75);
    expect(list[0]?.id).toBe(25);
    // Oldest surviving is 6 (1 to 5 evicted)
    expect(list[19]?.totalMs).toBe(56);
    expect(list[19]?.id).toBe(6);

    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.list()).toEqual([]);
  });
});

describe('Slow tick capture via LoadMeter & Region', () => {
  it('does not capture fast ticks (< 50 ms)', () => {
    const slowTicks = new SlowTickBuffer();
    const meter = new LoadMeter(Date.now, {
      onSlowTick: (totalMs) => {
        slowTicks.record({
          at: Date.now(),
          host: 'test',
          region: 'woods',
          totalMs,
          phases: {},
          players: 0,
          creatures: 0,
          activeStatuses: 0,
        });
      },
    });

    meter.tick(() => {
      // Fast work (< 50 ms)
      let x = 0;
      for (let i = 0; i < 100; i++) x += i;
    });

    expect(slowTicks.size).toBe(0);
  });

  it('captures slow ticks (>= 50 ms) with exact phase breakdown and entity counts', () => {
    const slowTicks = new SlowTickBuffer();
    const region = new Region(WORLD_REGIONS[0]!);

    const meter = new LoadMeter(Date.now, {
      slowTickThresholdMs: 10, // lowered for unit test speed
      onSlowTick: (totalMs, err) => {
        const counts = region.counts();
        slowTicks.record({
          at: Date.now(),
          host: 'gateway',
          region: region.def.id,
          totalMs,
          phases: region.profiler.currentPhases(),
          players: counts.players,
          creatures: counts.creatures,
          activeStatuses: counts.activeStatuses,
          ...(err ? { error: (err as Error).message ?? String(err) } : {}),
        });
      },
    });

    meter.tick(() => {
      region.tick();
      // Simulate slow tick exceeding 10ms threshold
      const start = performance.now();
      while (performance.now() - start < 15) {
        // busy wait to trigger threshold
      }
    });

    expect(slowTicks.size).toBe(1);
    const entry = slowTicks.list()[0]!;
    expect(entry.region).toBe(region.def.id);
    expect(entry.totalMs).toBeGreaterThanOrEqual(10);
    expect(entry.creatures).toBe(region.counts().creatures);
    expect(entry.phases).toBeDefined();
    expect(typeof entry.phases.inputs).toBe('number');
  });

  it('captures tick exceptions in the record error property', () => {
    const slowTicks = new SlowTickBuffer();

    const meter = new LoadMeter(Date.now, {
      slowTickThresholdMs: 5,
      onSlowTick: (totalMs, err) => {
        slowTicks.record({
          at: Date.now(),
          host: 'gateway',
          region: 'sanctum',
          totalMs,
          phases: {},
          players: 1,
          creatures: 2,
          activeStatuses: 0,
          error: (err as Error)?.message ?? String(err),
        });
      },
    });

    meter.tick(() => {
      const start = performance.now();
      while (performance.now() - start < 8) {}
      throw new Error('tick disaster');
    });

    expect(slowTicks.size).toBe(1);
    const record = slowTicks.list()[0]!;
    expect(record.error).toBe('tick disaster');
    expect(record.totalMs).toBeGreaterThanOrEqual(5);
  });
});
