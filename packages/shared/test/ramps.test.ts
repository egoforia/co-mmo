import { describe, expect, it } from 'vitest';
import {
  Predictor,
  Tile,
  addRamp,
  addStorey,
  climbWords,
  collides,
  floorChecks,
  rampProblem,
  rampTiles,
  stairsEntry,
  stairsLabel,
  stairwayAt,
  tileAt,
  walkOn,
  wallOn,
  type Placed,
  type RegionMap,
} from '../src/index.ts';

// Ramps: a kind of stairs standing on the lower floor only. Step on the
// foot, land in front of the top; step onto the head (over empty space)
// from the floor above, land in front of the foot, facing away.

/** An open land with a terrace on floor 1 over (10, 4)-(19, 9), and a ramp rising north to its south edge from (14, 11). */
function terraced(): RegionMap {
  const map: RegionMap = {
    def: { id: 'test', name: 'Test', biome: 'sanctum', seed: 1, exits: {}, at: { x: 0, y: 0 } },
    width: 32, height: 32, seed: 1, tiles: new Uint8Array(32 * 32), spawn: { x: 16, y: 28 }, entries: {},
    landmarks: [], buildings: [], storeys: [], stairways: [], npcs: [], creatures: [], spots: [],
  };
  addStorey(map, { x: 10, y: 4, width: 10, height: 6 }, 1, 'sanctum-inn', undefined, true);
  addRamp(map, { x: 14, y: 10, length: 2, from: 0, climbs: 'north', look: 'stone' });
  return map;
}

function walk(map: RegionMap, from: Placed, dx: number, dy: number, steps = 60): Placed {
  let at = from;
  for (let i = 0; i < steps && at.floor === from.floor; i++) at = walkOn(map, at, dx, dy);
  return at;
}

describe('ramps', () => {
  it('stand on the lower floor: an open foot, a solid body, and a head over empty space above', () => {
    const map = terraced();
    const ramp = map.stairways[0]!;
    expect(ramp).toMatchObject({ kind: 'ramp', lower: 0, upper: 1, ramp: { foot: { x: 14, y: 11 }, head: { x: 14, y: 10 } }, top: { x: 14.5, y: 9.5 }, bottom: { x: 14.5, y: 12.5 } });
    expect(tileAt(map, 14, 11, 0)).toBe(Tile.Ground);
    expect(tileAt(map, 14, 10, 0)).toBe(Tile.Blocked);
    // No floor under the head on floor 1, yet the step onto it from the terrace is open.
    expect(tileAt(map, 14, 10, 1)).toBe(Tile.Blocked);
    expect(wallOn(map, 14, 9, 'south', 1)).toBeUndefined();
    expect(wallOn(map, 13, 9, 'south', 1)).toBeDefined();
    // Taken only at its ends.
    expect(stairwayAt(map, 14.5, 11.5, 0)).toBe(ramp);
    expect(stairwayAt(map, 14.5, 10.5, 0)).toBeUndefined();
    expect(stairwayAt(map, 14.5, 10.5, 1)).toBe(ramp);
    expect(stairsEntry(ramp, 0)).toEqual({ x: 14.5, y: 11.5 });
    expect(stairsEntry(ramp, 1)).toEqual({ x: 14.5, y: 10.5 });
    expect(floorChecks(map)).toEqual([]);
    expect(stairsLabel(ramp, 0)).toBe('Ramp up to floor 1');
    expect(climbWords(ramp, 0)).toBe('You walk up the ramp to floor 1.');
    expect(ramp.art?.up).toBe('ramp-stone-2-away');
  });

  it('take you up from the foot to in front of the top, and down from the head to in front of the foot', () => {
    const map = terraced();
    const up = walk(map, { x: 14.5, y: 13.5, floor: 0 }, 0, -1);
    expect(up).toMatchObject({ x: 14.5, y: 9.5, floor: 1 });
    // Walking on north stays on the terrace.
    expect(walk(map, up, 0, -1, 10).floor).toBe(1);
    const down = walk(map, { x: 14.5, y: 8.5, floor: 1 }, 0, 1);
    expect(down).toMatchObject({ x: 14.5, y: 12.5, floor: 0 });
    // Walking on south carries you away from the ramp, not back up it.
    expect(walk(map, down, 0, 1, 10).floor).toBe(0);
  });

  it('cannot be walked into from the side or under', () => {
    const map = terraced();
    let at: Placed = { x: 12.5, y: 10.5, floor: 0 };
    for (let i = 0; i < 40; i++) at = walkOn(map, at, 1, 0);
    expect(at.x).toBeLessThan(14);
    expect(collides(map, 14.5, 10.5, 0)).toBe(true);
    // On the terrace, beside the head there is still nothing to stand on.
    let off: Placed = { x: 13.5, y: 8.5, floor: 1 };
    for (let i = 0; i < 40; i++) off = walkOn(map, off, 0, 1);
    expect(off).toMatchObject({ floor: 1, y: 9.5 });
  });

  it('are taken by the browser on the same step as the server', () => {
    const map = terraced();
    const p = new Predictor(map, { x: 14.5, y: 13.5 });
    let steps = 0;
    for (; steps < 60 && p.position.floor === 0; steps++) p.apply(0, -1);
    expect(p.position).toMatchObject({ x: 14.5, y: 9.5, floor: 1 });
    // The server's own walk changes floor on the same tick.
    let at: Placed = { x: 14.5, y: 13.5, floor: 0 };
    let server = 0;
    for (; server < 60 && at.floor === 0; server++) at = walkOn(map, at, 0, -1);
    expect(server).toBe(steps);
  });

  it('are refused in plain words when they do not fit', () => {
    const map = terraced();
    expect(rampProblem(map, { x: 4, y: 4, length: 4, from: 0, climbs: 'north' })).toMatch(/2 or 3/);
    // Rising east into open air: nothing to step off onto at the top.
    expect(rampProblem(map, { x: 22, y: 20, length: 2, from: 0, climbs: 'east' })).toMatch(/top/);
    // Over the ramp already there.
    expect(rampProblem(map, { x: 13, y: 11, length: 2, from: 0, climbs: 'east' })).toMatch(/other stairs|open floor/);
    expect(rampTiles({ x: 3, y: 3, length: 3, climbs: 'west' })).toEqual([{ x: 5, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 3 }]);
  });
});
