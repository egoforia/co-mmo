import { describe, expect, it } from 'vitest';
import {
  Predictor,
  Tile,
  addStairs,
  addStorey,
  applyEdit,
  blockOn,
  buildFloors,
  building,
  checkEdit,
  climbWords,
  collides,
  floorChecks,
  stairsLabel,
  stairsToward,
  stairwayAt,
  takeStairs,
  tileAt,
  walkOn,
  wayTaken,
  type Placed,
  type RegionMap,
} from '../src/index.ts';

/** A small open land with one house: walls at (4, 4), a 10 by 8 floor inside. */
function land(): RegionMap {
  const map: RegionMap = {
    def: { id: 'test', name: 'Test', biome: 'sanctum', seed: 1, exits: {}, at: { x: 0, y: 0 } },
    width: 32, height: 32, seed: 1, tiles: new Uint8Array(32 * 32), spawn: { x: 16, y: 28 }, entries: {},
    landmarks: [], buildings: [], storeys: [], stairways: [], npcs: [], creatures: [],
  };
  map.buildings.push(building(map, 4, 4, 10, 8, 'sanctum-arcanum'));
  return map;
}

/** The house with a floor above reached by stairs and a cellar reached by a ladder. */
function house(): RegionMap {
  const map = land();
  const b = map.buildings[0]!;
  addStorey(map, b, 1, b.style);
  addStorey(map, b, -1, b.style);
  addStairs(map, { kind: 'stairs', x: 10, y: 6, width: 2, height: 1, from: 0 });
  addStairs(map, { kind: 'ladder', x: 6, y: 9, width: 1, height: 1, from: -1 });
  return map;
}

/** Walks a player one way until they change floor (or give up). */
function walk(map: RegionMap, from: Placed, dx: number, dy: number, steps = 60): Placed {
  let at = from;
  for (let i = 0; i < steps && at.floor === from.floor; i++) at = walkOn(map, at, dx, dy);
  return at;
}

describe('floors', () => {
  it('give each storey its own walls and floor, and nothing to stand on beyond it', () => {
    const map = house();
    expect(tileAt(map, 4, 4, 1)).toBe(Tile.Wall);
    expect(tileAt(map, 8, 8, 1)).toBe(Tile.Floor);
    // Off the storey, floor 1 is thin air; the ground below goes on as before.
    expect(collides(map, 20.5, 20.5, 1)).toBe(true);
    expect(collides(map, 20.5, 20.5)).toBe(false);
    // The door is on the ground floor only.
    expect(tileAt(map, 9, 13)).toBe(Tile.Door);
    expect(tileAt(map, 9, 13, 1)).toBe(Tile.Wall);
    expect(floorChecks(map)).toEqual([]);
  });

  it('take you up the stairs onto the landing beside them, and down again', () => {
    const map = house();
    const way = map.stairways[0]!;
    const up = walk(map, { x: 10.5, y: 9.5, floor: 0 }, 0, -1);
    expect(up).toEqual({ ...way.top, floor: 1 });
    // The landing is beside the stairs, so standing there takes nobody back.
    expect(stairwayAt(map, up.x, up.y, 1)).toBeUndefined();
    expect(wayTaken(map, 0, up)).toBe(way);
    expect(climbWords(way, 0)).toBe('You climb the stairs to floor 1.');
    // Walking on, they move away from the stairs; turning back takes them down.
    expect(walk(map, up, 0, -1).floor).toBe(1);
    const down = walk(map, up, 0, 1);
    expect(down).toEqual({ ...way.bottom, floor: 0 });
    expect(climbWords(way, 1)).toBe('You go down the stairs to the ground floor.');
  });

  it('let players climb ladders, but not creatures', () => {
    const map = house();
    const ladder = map.stairways[1]!;
    const on = { x: 6.5, y: 9.5, floor: 0 };
    expect(takeStairs(map, on)).toEqual({ ...ladder.bottom, floor: -1 });
    expect(takeStairs(map, on, false)).toBeUndefined();
    expect(stairsLabel(ladder, 0)).toBe('Ladder down to underground floor 1');
    expect(stairsToward(map, { x: 8, y: 8, floor: 1 }, -1)).toBe(map.stairways[0]);
    expect(stairsToward(map, { x: 8, y: 8, floor: 0 }, -1, false)).toBeUndefined();
  });

  it('are taken the same way by the browser predicting its own player', () => {
    const map = house();
    const p = new Predictor(map, { x: 10.5, y: 9.5 });
    for (let i = 0; i < 60 && p.position.floor === 0; i++) p.apply(0, -1);
    expect(p.position.floor).toBe(1);
    // The server agrees it went up: replaying from its word keeps the floor.
    p.reconcile(0, { x: 10.5, y: 9.5 });
    expect(p.position.floor).toBe(1);
  });

  it('keep furniture solid on its own floor only', () => {
    const map = house();
    blockOn(map, 1, 6, 6, 2, 1);
    expect(tileAt(map, 5, 5, 1)).toBe(Tile.Blocked);
    expect(tileAt(map, 5, 5)).toBe(Tile.Floor);
  });

  it('are checked: stairs into walls, landings on stairs and floors out of the land are refused', () => {
    const map = house();
    map.stairways.push({ ...map.stairways[0]!, x: 4, y: 6, top: { x: 10.5, y: 6.5 } });
    map.stairways.push({ ...map.stairways[1]!, lower: -1, upper: 1 });
    map.storeys.push({ ...map.storeys[0]!, x: 28 });
    const problems = floorChecks(map);
    expect(problems.some((p) => p.includes('stands on something solid'))).toBe(true);
    expect(problems.some((p) => p.includes('is on stairs'))).toBe(true);
    expect(problems.some((p) => p.includes('not next to each other'))).toBe(true);
    expect(problems.some((p) => p.includes('past the edge of the land'))).toBe(true);
    expect(() => addStorey(map, { x: 30, y: 30, width: 5, height: 5 }, 2, 'sanctum-arcanum')).toThrow(/does not fit/);
  });
});

describe('a building given floors', () => {
  it('gets three floors up and two down, each joined to the next by stairs with room to step off', () => {
    const map = land();
    const b = map.buildings[0]!;
    expect(buildFloors(map, b, 3, 2)).toBe(true);
    expect(map.storeys.map((s) => s.floor).sort()).toEqual([-1, -2, 1, 2, 3].sort());
    expect(map.stairways.map((s) => s.lower)).toEqual([-2, -1, 0, 1, 2]);
    expect(floorChecks(map)).toEqual([]);
    // From the cellar at the bottom all the way to the top by walking from flight to flight.
    let at: Placed = { ...map.stairways[0]!.bottom, floor: -2 };
    for (const way of map.stairways) {
      expect(at.floor).toBe(way.lower);
      at = takeStairs(map, { x: way.x + 0.5, y: way.y + 0.5, floor: way.lower })!;
    }
    expect(at.floor).toBe(3);
    // Again, with ladders, takes the old floors off first.
    expect(buildFloors(map, b, 1, 0, 'ladder')).toBe(true);
    expect(map.storeys).toHaveLength(1);
    expect(map.stairways.map((s) => s.kind)).toEqual(['ladder']);
  });

  it('comes from the world editor, which refuses what does not fit', () => {
    const map = land();
    const edit = { kind: 'floors' as const, at: [6, 6] as [number, number], up: 2, down: 1 };
    expect(checkEdit(map, edit, {})).toBeUndefined();
    // Checking tries it on a copy: the land itself is untouched.
    expect(map.storeys).toEqual([]);
    applyEdit(map, { ...edit, id: 'e1', by: 'Robo', made: 0 });
    expect(map.storeys).toHaveLength(3);
    expect(checkEdit(map, { ...edit, at: [20, 20] }, {})).toMatch(/Click a building/);
    expect(checkEdit(map, { ...edit, up: 9 }, {})).toMatch(/up to 4 floors/);
    // A cupboard of a house has no room for a flight.
    const tiny = land();
    tiny.buildings = [building(tiny, 20, 20, 2, 2, 'sanctum-arcanum')];
    expect(checkEdit(tiny, { ...edit, at: [21, 21] }, {})).toMatch(/no room for the stairs/);
  });
});
