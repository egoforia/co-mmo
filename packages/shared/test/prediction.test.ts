import { describe, expect, it } from 'vitest';
import { Interpolator, Predictor, WORLD_REGIONS, generateRegion, step } from '../src/index.ts';

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
  it('renders between snapshots, delayed', () => {
    const i = new Interpolator(100);
    i.push(1000, 0, 0);
    i.push(1050, 10, 0);
    expect(i.sample(1125)).toEqual({ x: 5, y: 0 });
    expect(i.sample(500)).toEqual({ x: 0, y: 0 });
    expect(i.sample(5000)).toEqual({ x: 10, y: 0 });
  });

  it('looks further back when snapshots come less often, so it never runs out of path', () => {
    const i = new Interpolator(100);
    for (let n = 0; n <= 4; n++) i.push(1000 + n * 200, n * 10, 0);
    expect(i.delay).toBe(250);
    // Just before the next snapshot is due, it is still between two it has.
    const at = i.sample(1800 + 199)!;
    expect(at.x).toBeLessThan(40);
    expect(at.x).toBeGreaterThan(30);
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
