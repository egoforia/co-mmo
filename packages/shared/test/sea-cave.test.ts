import { afterEach, describe, expect, it } from 'vitest';
import {
  SEA_CAVE_ART,
  SEA_CAVE_FLOORS,
  SEA_CAVE_MOD,
  SEA_CAVE_SIZE,
  climbWords,
  collides,
  floorChecks,
  generateRegion,
  regionDef,
  stairsLabel,
  stairwayAt,
  switchMod,
  takeStairs,
  type RegionMap,
} from '../src/index.ts';

const shore = () => generateRegion(regionDef('shore')!);
const cave = (map: RegionMap) => map.buildings.find((b) => b.style === 'shore-sea-cave')!;

/** The open tiles a walker can reach on a floor from a spot inside the cave, not counting stairs. */
function reach(map: RegionMap, from: { x: number; y: number }, floor: number): Set<string> {
  const b = cave(map);
  const seen = new Set<string>();
  const todo = [[Math.floor(from.x), Math.floor(from.y)]];
  while (todo.length) {
    const [x, y] = todo.pop()!;
    const key = `${x},${y}`;
    if (seen.has(key) || x! < b.x || y! < b.y || x! >= b.x + b.width || y! >= b.y + b.height || collides(map, x! + 0.5, y! + 0.5, floor)) continue;
    seen.add(key);
    // Stepping onto stairs takes you off this floor, so the way stops there.
    if (stairwayAt(map, x! + 0.5, y! + 0.5, floor)) continue;
    todo.push([x! + 1, y!], [x! - 1, y!], [x!, y! + 1], [x!, y! - 1]);
  }
  return seen;
}

afterEach(() => switchMod(SEA_CAVE_MOD, true));

describe('the Smugglers\' Sea Cave', () => {
  it('has plans the size of its walls, with every way down matched by a way up below it', () => {
    for (const plan of SEA_CAVE_FLOORS) {
      expect(plan.rows, plan.name).toHaveLength(SEA_CAVE_SIZE.height);
      for (const row of plan.rows) expect(row, plan.name).toHaveLength(SEA_CAVE_SIZE.width);
      const below = SEA_CAVE_FLOORS.find((f) => f.floor === plan.floor - 1);
      plan.rows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === 'v') expect(below?.rows[y]![x], `${plan.name} at (${x}, ${y})`).toMatch(/[SH]/);
      }));
    }
  });

  it('is built from its kit: three floors above the ground, two below, soundly joined', () => {
    const map = shore();
    const b = cave(map);
    expect(b.art).toEqual(SEA_CAVE_ART);
    expect(map.storeys.map((s) => s.floor).sort((a, b) => a - b)).toEqual([-2, -1, 1, 2, 3]);
    for (const s of map.storeys) expect(s.art).toEqual(SEA_CAVE_ART);
    expect(floorChecks(map)).toEqual([]);
    // Its doorway is where the painted cave's was, so the road still reaches it.
    expect(b.door).toEqual({ x: 145, y: 195 });
    expect(map.landmarks.filter((l) => l.asset.startsWith('sea-cave-') && l.floor === -2).length).toBeGreaterThan(3);
  });

  it('can be walked from the doorway to the lookout and down to the hoard', () => {
    const map = shore();
    const b = cave(map);
    const door = { x: b.door.x + 0.5, y: b.door.y - 0.5 };
    const go = (from: { x: number; y: number }, floor: number, to: number) => {
      const way = map.stairways.find((s) => (s.lower === floor && s.upper === to) || (s.upper === floor && s.lower === to))!;
      const tiles = reach(map, from, floor);
      // Somewhere open beside the stairs leads onto them.
      const step = [[way.x, way.y - 1], [way.x, way.y + way.height], [way.x - 1, way.y], [way.x + way.width, way.y]].find(([x, y]) => tiles.has(`${x},${y}`));
      expect(step, `the way from ${floor} to ${to} can be reached`).toBeDefined();
      const there = takeStairs(map, { x: way.x + 0.5, y: way.y + 0.5, floor })!;
      expect(there.floor).toBe(to);
      return there;
    };
    let at = go(door, 0, 1);
    at = go(at, 1, 2);
    at = go(at, 2, 3);
    expect(at.floor).toBe(3);
    at = go(door, 0, -1);
    at = go(at, -1, -2);
    expect(at.floor).toBe(-2);
  });

  it('names its floors on the stairs and to those who take them', () => {
    const map = shore();
    const up = map.stairways.find((s) => s.lower === 0)!;
    expect(stairsLabel(up, 0)).toBe("Stairs up to the Smugglers' Loft (floor 1)");
    expect(climbWords(up, 1)).toBe('You go down the stairs to the Cave Mouth, the ground floor.');
    const ladder = map.stairways.find((s) => s.lower === -2)!;
    expect(ladder.kind).toBe('ladder');
    expect(climbWords(ladder, -1)).toBe('You climb down the ladder to the Drowned Hoard, underground floor 2.');
  });

  it('keeps creatures on their own floors, the hoard guarded below its ladder', () => {
    const map = shore();
    const b = cave(map);
    const inside = map.creatures.filter((c) => c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height);
    expect(inside.filter((c) => c.floor === -2).map((c) => c.kind)).toContain('drowned-deckhand');
    expect(inside.filter((c) => c.floor === -1).map((c) => c.kind)).toContain('hermit-crab');
    for (const c of inside) expect(collides(map, c.x, c.y, c.floor ?? 0), `${c.kind} at (${c.x}, ${c.y})`).toBe(false);
  });

  it('stands as its painted self, one floor and no kit, while the kit wish is off', () => {
    switchMod(SEA_CAVE_MOD, false);
    const map = shore();
    const b = cave(map);
    expect(b.art).toBeUndefined();
    expect([b.width, b.height]).toEqual([16, 12]);
    expect(map.storeys).toEqual([]);
    expect(map.stairways).toEqual([]);
    expect(b.door).toEqual({ x: 145, y: 195 });
  });
});
