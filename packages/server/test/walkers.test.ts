import { describe, expect, it } from 'vitest';
import { BodyGrid, PERSON_RADIUS, Tile, TICK_RATE, bodyOf, type RegionMap } from '@co-mmo/shared';
import { keepStepping, moveAway, moveToward, standClear, type Stepper } from '../src/walkers.ts';

// Creatures and people walk on tiles (docs/combat.md, Moving on tiles):
// whole steps from tile middle to tile middle, squares as wide as their
// size, round walls and round each other.

/** A small land of open ground, with trees where a test puts them. */
function land(width = 10, height = 10, trees: [number, number][] = []): RegionMap {
  const tiles = new Uint8Array(width * height).fill(Tile.Ground);
  for (const [x, y] of trees) tiles[y * width + x] = Tile.Tree;
  return { width, height, tiles, def: { exits: {} }, storeys: [] } as unknown as RegionMap;
}

/** Ticks a walker toward a point until it arrives (or gives up), noting every place it stood. */
function walk(map: RegionMap, w: Stepper, x: number, y: number, speed = 2, ticks = TICK_RATE * 10): { arrived: boolean; stood: { x: number; y: number }[] } {
  const stood: { x: number; y: number }[] = [];
  for (let i = 0; i < ticks; i++) {
    if (moveToward(map, w, x, y, speed)) return { arrived: true, stood };
    stood.push({ x: w.x, y: w.y });
  }
  return { arrived: false, stood };
}

const onMiddle = (v: number, width = 1) => Math.abs(v - width / 2 - Math.round(v - width / 2)) < 1e-9;

describe('walkers on tiles', () => {
  it('walks to a point and stands on the middle of the tile nearest it', () => {
    const map = land();
    const w: Stepper = { x: 1.5, y: 1.5, floor: 0 };
    expect(walk(map, w, 6.2, 3.9).arrived).toBe(true);
    expect(w).toMatchObject({ x: 6.5, y: 3.5 });
    expect(w.to).toBeUndefined();
  });

  it('settles onto a tile when put off its middle', () => {
    const map = land();
    const w: Stepper = { x: 3.2, y: 4.9, floor: 0 };
    walk(map, w, 3.2, 4.9);
    expect(w).toMatchObject({ x: 3.5, y: 4.5 });
  });

  it('goes round a wall of trees, never into one', () => {
    const wall: [number, number][] = [[5, 2], [5, 3], [5, 4], [5, 5], [5, 6]];
    const map = land(10, 10, wall);
    const w: Stepper = { x: 2.5, y: 4.5, floor: 0 };
    const { arrived, stood } = walk(map, w, 8.5, 4.5);
    expect(arrived).toBe(true);
    for (const s of stood) expect(wall.some(([tx, ty]) => Math.floor(s.x) === tx && Math.floor(s.y) === ty)).toBe(false);
  });

  it('a big creature, two tiles wide, does not fit a one-tile gap', () => {
    // A row of trees with one gap at (5, 4).
    const row: [number, number][] = [0, 1, 2, 3, 4, 6, 7, 8, 9].map((x) => [x, 4]);
    const map = land(10, 10, row);
    const small: Stepper = { x: 5.5, y: 1.5, floor: 0 };
    expect(walk(map, small, 5.5, 8.5).arrived).toBe(true);
    const big: Stepper = { x: 5, y: 2, floor: 0, width: 2 };
    expect(walk(map, big, 5, 8).arrived).toBe(false);
    expect(big.y).toBeLessThan(4);
    expect(onMiddle(big.x, 2) && onMiddle(big.y, 2)).toBe(true);
  });

  it('never steps onto a tile someone else holds, and steps off one it was put on', () => {
    const map = land();
    const other = { x: 5.5, y: 5.5, floor: 0 };
    const w: Stepper = { x: 5.5, y: 5.5, floor: 0 };
    const bodies = new BodyGrid([bodyOf(other, PERSON_RADIUS, 'player'), bodyOf(w, PERSON_RADIUS, 'creature')]);
    const among = { self: { r: PERSON_RADIUS, kind: 'creature' as const, floor: 0, of: w }, bodies };
    for (let i = 0; i < TICK_RATE; i++) {
      const before = { x: w.x, y: w.y };
      standClear(map, w, 2, among, () => 0.3);
      keepStepping(map, w, before, 2);
    }
    expect(Math.hypot(w.x - other.x, w.y - other.y)).toBeGreaterThanOrEqual(1);
    // Walking at them, it stops on the tile beside them.
    for (let i = 0; i < TICK_RATE * 5; i++) moveToward(map, w, other.x, other.y, 2, among);
    expect(Math.floor(w.x) === 5 && Math.floor(w.y) === 5).toBe(false);
    expect(Math.max(Math.abs(w.x - other.x), Math.abs(w.y - other.y))).toBe(1);
  });

  it('finishes a step it began, even when it does nothing else', () => {
    const map = land();
    const w: Stepper = { x: 2.5, y: 2.5, floor: 0 };
    moveToward(map, w, 8.5, 2.5, 2);
    expect(w.to).toEqual({ tx: 3, ty: 2 });
    for (let i = 0; i < TICK_RATE; i++) keepStepping(map, w, { x: w.x, y: w.y }, 2);
    expect(w).toMatchObject({ x: 3.5, y: 2.5 });
    expect(w.to).toBeUndefined();
  });

  it('runs away tile by tile and stands at bay in a corner', () => {
    const map = land();
    const w: Stepper = { x: 2.5, y: 2.5, floor: 0 };
    for (let i = 0; i < TICK_RATE * 5; i++) moveAway(map, w, 5, 5, 3);
    expect(w).toMatchObject({ x: 0.5, y: 0.5 });
  });
});
