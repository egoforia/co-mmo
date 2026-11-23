import { afterEach, describe, expect, it } from 'vitest';
import {
  GALLEON_ART,
  GALLEON_FLOORS,
  GALLEON_MOD,
  GALLEON_SIZE,
  GALLEON_STYLE,
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
const galleon = (map: RegionMap) => map.buildings.find((b) => b.style === GALLEON_STYLE)!;

/** The open tiles a walker can reach on a deck from a spot inside the galleon, not counting stairs. */
function reach(map: RegionMap, from: { x: number; y: number }, floor: number): Set<string> {
  const b = galleon(map);
  const seen = new Set<string>();
  const todo = [[Math.floor(from.x), Math.floor(from.y)]];
  while (todo.length) {
    const [x, y] = todo.pop()!;
    const key = `${x},${y}`;
    if (seen.has(key) || x! < b.x || y! < b.y || x! >= b.x + b.width || y! >= b.y + b.height || collides(map, x! + 0.5, y! + 0.5, floor)) continue;
    seen.add(key);
    if (stairwayAt(map, x! + 0.5, y! + 0.5, floor)) continue;
    todo.push([x! + 1, y!], [x! - 1, y!], [x!, y! + 1], [x!, y! - 1]);
  }
  return seen;
}

afterEach(() => switchMod(GALLEON_MOD, true));

describe('the Sunken Galleon Dungeon', () => {
  it('has plans the size of its hull, with every way down matched by a way up below it', () => {
    for (const plan of GALLEON_FLOORS) {
      expect(plan.rows, plan.name).toHaveLength(GALLEON_SIZE.height);
      for (const row of plan.rows) expect(row, plan.name).toHaveLength(GALLEON_SIZE.width);
      const below = GALLEON_FLOORS.find((f) => f.floor === plan.floor - 1);
      plan.rows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === 'v') expect(below?.rows[y]![x], `${plan.name} at (${x}, ${y})`).toMatch(/[SH]/);
      }));
    }
  });

  it('lies on the shore with three decks under the sand, soundly joined', () => {
    const map = shore();
    const b = galleon(map);
    expect(b.art).toEqual(GALLEON_ART);
    expect([b.width, b.height]).toEqual([GALLEON_SIZE.width, GALLEON_SIZE.height]);
    const decks = map.storeys.filter((s) => s.style === GALLEON_STYLE);
    expect(decks.map((s) => s.floor).sort((a, b) => a - b)).toEqual([-3, -2, -1]);
    for (const s of decks) expect(s.art).toEqual(GALLEON_ART);
    expect(floorChecks(map)).toEqual([]);
    // It stands clear of the sea and of the shore's other buildings.
    for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) expect(map.tiles[y * map.width + x]).not.toBe(2);
    for (const other of map.buildings.filter((o) => o !== b)) {
      const apart = other.x >= b.x + b.width + 1 || b.x >= other.x + other.width + 1 || other.y >= b.y + b.height + 1 || b.y >= other.y + other.height + 1;
      expect(apart, other.style).toBe(true);
    }
    expect(map.landmarks.filter((l) => l.asset === 'galleon-chest' && l.floor === -3)).toHaveLength(2);
  });

  it('can be walked from the gangway down to the hold, and the road reaches the gangway', () => {
    const map = shore();
    const b = galleon(map);
    expect(map.tiles[(b.door.y + 1) * map.width + b.door.x]).toBe(1);
    const door = { x: b.door.x + 0.5, y: b.door.y - 0.5 };
    const go = (from: { x: number; y: number }, floor: number, to: number) => {
      const way = map.stairways.find((s) => s.x >= b.x && s.x < b.x + b.width && s.y >= b.y && s.y < b.y + b.height && s.upper === floor && s.lower === to)!;
      const tiles = reach(map, from, floor);
      const step = [[way.x, way.y - 1], [way.x, way.y + way.height], [way.x - 1, way.y], [way.x + way.width, way.y]].find(([x, y]) => tiles.has(`${x},${y}`));
      expect(step, `the way from ${floor} to ${to} can be reached`).toBeDefined();
      const there = takeStairs(map, { x: way.x + 0.5, y: way.y + 0.5, floor })!;
      expect(there.floor).toBe(to);
      return there;
    };
    let at = go(door, 0, -1);
    at = go(at, -1, -2);
    at = go(at, -2, -3);
    expect(at.floor).toBe(-3);
  });

  it('names its decks on the stairs and to those who take them', () => {
    const map = shore();
    const b = galleon(map);
    const mine = map.stairways.filter((s) => s.x >= b.x && s.x < b.x + b.width && s.y >= b.y && s.y < b.y + b.height);
    const down = mine.find((s) => s.upper === 0)!;
    expect(stairsLabel(down, 0)).toBe('Stairs down to the Gun Deck (underground floor 1)');
    const ladder = mine.find((s) => s.lower === -3)!;
    expect(ladder.kind).toBe('ladder');
    expect(climbWords(ladder, -2)).toBe('You climb down the ladder to the Flooded Hold, underground floor 3.');
  });

  it('keeps its crew on their own decks, the hold guarded by the drowned', () => {
    const map = shore();
    const b = galleon(map);
    const inside = map.creatures.filter((c) => c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height);
    expect(inside.filter((c) => c.floor === -3).map((c) => c.kind)).toContain('drowned-deckhand');
    expect(inside.filter((c) => c.floor === -2).map((c) => c.kind)).toContain('hermit-crab');
    expect(inside.filter((c) => !c.floor).map((c) => c.kind)).toContain('gull-raider');
    for (const c of inside) expect(collides(map, c.x, c.y, c.floor ?? 0), `${c.kind} at (${c.x}, ${c.y})`).toBe(false);
  });

  it('is not on the shore while its wish is off', () => {
    switchMod(GALLEON_MOD, false);
    const map = shore();
    expect(map.buildings.find((b) => b.style === GALLEON_STYLE)).toBeUndefined();
    expect(map.storeys.some((s) => s.style === GALLEON_STYLE)).toBe(false);
    expect(map.landmarks.some((l) => l.asset.startsWith('galleon-'))).toBe(false);
  });
});
