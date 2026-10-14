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
    expect(p.position).toEqual(step(map, step(map, server, 1, 0), 0, 1));
  });

  it('snaps to the server when it disagrees', () => {
    const p = new Predictor(map, map.spawn);
    p.apply(1, 0);
    p.reconcile(1, { x: 10.5, y: 10.5 });
    expect(p.position).toEqual({ x: 10.5, y: 10.5 });
  });
});

describe('Interpolator', () => {
  it('renders between snapshots, delayed', () => {
    const i = new Interpolator(100);
    i.push(1000, 0, 0);
    i.push(1100, 10, 0);
    expect(i.sample(1150)).toEqual({ x: 5, y: 0 });
    expect(i.sample(500)).toEqual({ x: 0, y: 0 });
    expect(i.sample(5000)).toEqual({ x: 10, y: 0 });
  });
});
