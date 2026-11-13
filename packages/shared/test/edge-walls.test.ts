import { describe, expect, it } from 'vitest';
import {
  CREATURES,
  PLAYER_RADIUS,
  WALL_HALF_THICKNESS,
  WORLD_REGIONS,
  applyEdit,
  checkEdit,
  collides,
  editWords,
  generateRegion,
  stampEdit,
  step,
  turnSide,
  wallBetween,
  wallOn,
  type RegionMap,
  type WorldEditDraft,
} from '../src/index.ts';

// A wall on one side of a tile closes only the line between two tiles: both
// stay open, crossing the line is stopped, walking along it is not, and the
// Wall edit stands it, takes it down and says what it did.

/** A tile whose 5 × 5 neighbourhood is all open ground on a land. */
function openPatch(map: RegionMap): [number, number] {
  for (let y = 10; y < map.height - 10; y++) {
    for (let x = 10; x < map.width - 10; x++) {
      let clear = true;
      for (let dy = -2; dy <= 2 && clear; dy++) for (let dx = -2; dx <= 2 && clear; dx++) clear = !collides(map, x + dx + 0.5, y + dy + 0.5);
      if (clear) return [x, y];
    }
  }
  throw new Error('no open ground');
}

const lay = (map: RegionMap, draft: WorldEditDraft, id = 'w1') => {
  expect(checkEdit(map, draft, CREATURES)).toBeUndefined();
  return applyEdit(map, stampEdit(draft, { id, by: 'Ego', made: 1 }, CREATURES));
};

/** Walks a body from (x, y) in a direction for a number of ticks. */
function walk(map: RegionMap, from: { x: number; y: number }, dx: number, dy: number, ticks = 40) {
  let at = from;
  for (let i = 0; i < ticks; i++) at = step(map, at, dx, dy);
  return at;
}

describe('walls on a tile\'s side', () => {
  it('stop a body crossing their line, but not walking along it', () => {
    const map = generateRegion(WORLD_REGIONS[0]!);
    const [x, y] = openPatch(map);
    const start = { x: x + 0.5, y: y + 0.5 };
    expect(walk(map, start, 0, -1).y).toBeLessThan(y - 1);
    lay(map, { kind: 'wall', side: 'north', tiles: [[x - 1, y], [x, y], [x + 1, y]], style: 'woods-castle', height: 'full' });
    expect(collides(map, x + 0.5, y + 0.5)).toBe(false);
    const stopped = walk(map, start, 0, -1);
    expect(stopped.y).toBeGreaterThanOrEqual(y + PLAYER_RADIUS + WALL_HALF_THICKNESS - 1e-9);
    // Sliding east along it still goes.
    expect(walk(map, start, 1, -1, 10).x).toBeGreaterThan(start.x + 0.5);
    // The north side of a tile is the south side of the tile above it.
    expect(wallOn(map, x, y - 1, 'south')).toBe(wallOn(map, x, y, 'north'));
    expect(wallBetween(map, x, y, 0, -1)).toBe(true);
    expect(wallBetween(map, x, y, 1, 0)).toBe(false);
  });

  it('stand on the east and west sides too, and are taken down by a Wall edit', () => {
    const map = generateRegion(WORLD_REGIONS[0]!);
    const [x, y] = openPatch(map);
    lay(map, { kind: 'wall', side: 'east', tiles: [[x, y]], style: 'woods-castle', height: 'half' });
    expect(walk(map, { x: x + 0.5, y: y + 0.5 }, 1, 0).x).toBeLessThan(x + 1);
    expect(wallOn(map, x + 1, y, 'west')?.height).toBe('half');
    const down: WorldEditDraft = { kind: 'wall', side: 'west', tiles: [[x + 1, y]], style: 'woods-castle', height: 'full', down: true };
    expect(editWords(down)).toBe('Walls taken down from the west side of 1 tile');
    lay(map, down, 'w2');
    expect(wallOn(map, x, y, 'east')).toBeUndefined();
    expect(walk(map, { x: x + 0.5, y: y + 0.5 }, 1, 0).x).toBeGreaterThan(x + 1.5);
    expect(checkEdit(map, down, CREATURES)).toBe('There is no wall on that side here to take down.');
  });

  it('turn round the four sides, and refuse what they cannot be, in plain words', () => {
    expect(['north', 'east', 'south', 'west'].map((s) => turnSide(s as never))).toEqual(['east', 'south', 'west', 'north']);
    expect(turnSide('north', -1)).toBe('west');
    const map = generateRegion(WORLD_REGIONS[0]!);
    const ok: WorldEditDraft = { kind: 'wall', side: 'north', tiles: [[5, 5]], style: 'woods-castle', height: 'full' };
    expect(checkEdit(map, { ...ok, side: 'up' as never }, CREATURES)).toBe('Pick a side of the tile for the wall.');
    expect(checkEdit(map, { ...ok, style: 'nowhere' }, CREATURES)).toBe('There is no look of that name.');
    expect(checkEdit(map, { ...ok, tiles: [[-1, 5]] }, CREATURES)).toBe('That spot is off the edge of this land.');
    expect(checkEdit(map, { ...ok, level: 1 }, CREATURES)).toBe('A wall off the ground stands on a storey: keep it on the floor shown.');
    expect(editWords(ok)).toBe('A wall on the north side of 1 tile');
  });
});
