import { describe, expect, it } from 'vitest';
import { Interpolator, Predictor, SnapshotClock, WORLD_REGIONS, generateRegion, step } from '../src/index.ts';

describe('Predictor', () => {
  const map = generateRegion(WORLD_REGIONS[0]!);

  it('continues input numbering after a region change', () => {
    const p = new Predictor(map, map.spawn, 41);
    expect(p.apply(1, 0).seq).toBe(42);
    expect(p.lastSeq).toBe(42);
  });

  it('replays unacknowledged inputs on top of the server position', () => {
    const p = new Predictor(map, map.spawn);
    p.apply(1, 0);
    p.apply(1, 0);
    p.apply(0, 1);
    // Server applied only the first input.
    const server = step(map, map.spawn, 1, 0);
    p.reconcile(1, server);
    expect(p.unacknowledged).toBe(2);
    expect(p.position).toMatchObject(step(map, step(map, server, 1, 0), 0, 1));
  });

  it('snaps to the server when it disagrees', () => {
    const p = new Predictor(map, map.spawn);
    p.apply(1, 0);
    p.reconcile(1, { x: 10.5, y: 10.5 });
    expect(p.position).toMatchObject({ x: 10.5, y: 10.5 });
  });
});

describe('Interpolator', () => {
  it('draws between the snapshots around the server time it is asked for', () => {
    const i = new Interpolator();
    i.push(1000, 0, 0);
    i.push(1050, 10, 0);
    expect(i.sample(1025)).toEqual({ x: 5, y: 0 });
    expect(i.sample(500)).toEqual({ x: 0, y: 0 });
  });

  it('walks on a little way when the next snapshot is late, then waits', () => {
    const i = new Interpolator();
    i.push(1000, 0, 0);
    i.push(1050, 1, 0);
    expect(i.sample(1075)!.x).toBeCloseTo(1.5);
    // No further than 75 ms on, however late it is.
    expect(i.sample(5000)!.x).toBeCloseTo(2.5);
  });

  it('moves what it has onto a new timeline when the ticks start over', () => {
    const i = new Interpolator();
    i.push(1000, 0, 0);
    i.push(1050, 10, 0);
    i.rebase(-1000);
    expect(i.sample(25)).toEqual({ x: 5, y: 0 });
  });
});

describe('SnapshotClock', () => {
  /** Snapshots one tick apart, each late by the network's delay plus some wobble. */
  const feed = (clock: SnapshotClock, ticks: number, wobble: (n: number) => number, from = 0, startTick = 100) => {
    for (let n = 0; n < ticks; n++) clock.arrived(startTick + n, from + n * 50 + 40 + wobble(n));
  };

  it('draws others on the server time, so an uneven network does not make them stutter', () => {
    const clock = new SnapshotClock();
    // Every other snapshot 30 ms late.
    feed(clock, 60, (n) => (n % 2 ? 30 : 0));
    expect(clock.jitter).toBeGreaterThan(28);
    expect(clock.jitter).toBeLessThanOrEqual(30);
    expect(clock.gap).toBe(50);
    expect(clock.delay).toBeCloseTo(90, -1);
    // The drawn time moves exactly as fast as real time once settled, whatever the arrivals did.
    const a = clock.renderAt(3000);
    const b = clock.renderAt(3016);
    expect(b - a).toBeCloseTo(16, 0);
    // Server time = local - 40 ms delay - 90 ms drawn behind.
    expect(clock.renderAt(4000)).toBeCloseTo(4000 - 40 - 90 + 100 * 50, -1);
  });

  it('follows a busy server whose ticks fall behind real time, slowing others a little instead of stopping them', () => {
    const clock = new SnapshotClock();
    let last = 0;
    // The server stalls once, at tick 160: every later tick comes 200 ms later than it would have.
    for (let n = 0; n < 120; n++) {
      const arrival = n * 50 + 40 + (n >= 60 ? 200 : 0);
      clock.arrived(100 + n, arrival);
      for (let t = arrival; t < arrival + 50; t += 16) {
        const drawn = clock.renderAt(t);
        if (n > 2) expect(drawn - last).toBeGreaterThan(0);
        last = drawn;
      }
    }
  });

  it('draws further behind when a crowd makes snapshots come less often', () => {
    const clock = new SnapshotClock();
    for (let n = 0; n < 20; n++) clock.arrived(100 + n * 4, n * 200 + 40);
    expect(clock.gap).toBe(200);
    expect(clock.delay).toBe(210);
  });

  it('follows the ticks onto a new timeline in a new region', () => {
    const clock = new SnapshotClock();
    feed(clock, 20, () => 0);
    const before = clock.renderAt(1000);
    // A new region's ticks start near zero.
    const shift = clock.arrived(3, 1040);
    expect(shift).toBeLessThan(-4000);
    const after = clock.renderAt(1040);
    // Drawn time carries on smoothly on the new timeline.
    expect(after - (before + shift)).toBeGreaterThanOrEqual(0);
    expect(after - (before + shift)).toBeLessThan(100);
  });
});

describe('crossing into another region', () => {
  it('replays steps the server has not applied yet from where it says we arrived', () => {
    const map = generateRegion(WORLD_REGIONS[0]!);
    const old = new Predictor(map, map.spawn);
    for (let i = 0; i < 4; i++) old.apply(1, 0);
    // The server applied the first two steps before moving us; two remain.
    const start = { x: map.spawn.x + 0.5, y: map.spawn.y };
    const next = new Predictor(map, start, old.lastSeq, old.unapplied, 2);
    let expected = start;
    for (let i = 0; i < 2; i++) expected = step(map, expected, 1, 0);
    expect(next.position).toMatchObject(expected);
    expect(next.unacknowledged).toBe(2);
    expect(next.lastSeq).toBe(4);
  });
});
