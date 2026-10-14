import { describe, expect, it } from 'vitest';
import {
  OPPOSITE,
  PLAYER_SPEED,
  TICK_SECONDS,
  Tile,
  WORLD_REGIONS,
  collides,
  generateRegion,
  isBlocking,
  outsideSide,
  step,
  tileAt,
  type RegionMap,
  type Side,
} from '../src/index.ts';

const maps = WORLD_REGIONS.map((def) => generateRegion(def));
const sanctum = maps[0]!;

/** Walkable tiles reachable from a point. */
function reachable(map: RegionMap, from: { x: number; y: number }): Uint8Array {
  const seen = new Uint8Array(map.width * map.height);
  const stack = [[Math.floor(from.x), Math.floor(from.y)]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x! < 0 || y! < 0 || x! >= map.width || y! >= map.height) continue;
    const i = y! * map.width + x!;
    if (seen[i] || isBlocking(map.tiles[i] as Tile)) continue;
    seen[i] = 1;
    stack.push([x! + 1, y!], [x! - 1, y!], [x!, y! + 1], [x!, y! - 1]);
  }
  return seen;
}

describe('world layout', () => {
  it('is deterministic', () => {
    expect(generateRegion(WORLD_REGIONS[1]!).tiles).toEqual(generateRegion(WORLD_REGIONS[1]!).tiles);
  });

  it('links regions both ways', () => {
    for (const def of WORLD_REGIONS) {
      for (const [side, target] of Object.entries(def.exits) as [Side, string][]) {
        const other = WORLD_REGIONS.find((r) => r.id === target)!;
        expect(other.exits[OPPOSITE[side]]).toBe(def.id);
      }
    }
  });

  it.each(maps.map((m) => [m.def.id, m] as const))('%s: spawn, entries, NPCs and creatures are reachable', (_id, map) => {
    expect(collides(map, map.spawn.x, map.spawn.y)).toBe(false);
    const seen = reachable(map, map.spawn);
    const at = (p: { x: number; y: number }) => seen[Math.floor(p.y) * map.width + Math.floor(p.x)];
    for (const entry of Object.values(map.entries)) {
      expect(collides(map, entry.x, entry.y)).toBe(false);
      expect(at(entry)).toBe(1);
    }
    for (const c of map.creatures) expect(collides(map, c.x, c.y)).toBe(false);
    expect(map.landmarks.length).toBeGreaterThanOrEqual(1);
    expect(map.npcs.length).toBeGreaterThanOrEqual(1);
  });

  it.each(maps.map((m) => [m.def.id, m] as const))('%s: every road is clear from its edge to the middle', (_id, map) => {
    const c = Math.floor(map.width / 2);
    const inward: Record<Side, [number, number]> = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] };
    for (const [side, entry] of Object.entries(map.entries) as [Side, { x: number; y: number }][]) {
      const [dx, dy] = inward[side];
      let pos = { ...entry };
      let closest = Infinity;
      for (let i = 0; i < 400; i++) {
        pos = step(map, pos, dx, dy);
        closest = Math.min(closest, Math.abs(dx ? pos.x - c : pos.y - c));
      }
      // Straight in to the centrepiece, without walking round anything.
      expect(closest, `${side} road`).toBeLessThan(3);
    }
  });

  it('opens edges only where a region lies beyond', () => {
    expect(tileAt(sanctum, -0.5, 32.5)).toBe(Tile.Path);
    expect(tileAt(sanctum, 32.5, -0.5)).toBe(Tile.Water);
    expect(outsideSide(sanctum, -0.1, 10)).toBe('west');
    expect(outsideSide(sanctum, 10, 64.2)).toBe('south');
  });
});

describe('step', () => {
  it('moves at player speed and normalises diagonals', () => {
    const start = sanctum.spawn;
    const right = step(sanctum, start, 1, 0);
    expect(right.x - start.x).toBeCloseTo(PLAYER_SPEED * TICK_SECONDS);
    const diag = step(sanctum, start, 1, 1);
    expect(Math.hypot(diag.x - start.x, diag.y - start.y)).toBeCloseTo(PLAYER_SPEED * TICK_SECONDS);
  });

  it('stops at the shrine', () => {
    let pos = sanctum.spawn;
    for (let i = 0; i < 100; i++) pos = step(sanctum, pos, 0, -1);
    expect(collides(sanctum, pos.x, pos.y)).toBe(false);
    expect(pos.y).toBeGreaterThan(sanctum.landmarks[0]!.y - 0.1);
  });

  it('can walk out of an open edge but not a closed one', () => {
    let west = sanctum.entries.west!;
    for (let i = 0; i < 40; i++) west = step(sanctum, west, -1, 0);
    expect(west.x).toBeLessThan(0);
    const desert = maps.find((m) => m.def.id === 'desert')!;
    let pos = desert.entries.north!;
    for (let i = 0; i < 40; i++) pos = step(desert, pos, 0, -1);
    expect(pos.y).toBeLessThan(0);
    let south = desert.spawn;
    for (let i = 0; i < 2000; i++) south = step(desert, south, 0, 1);
    expect(south.y).toBeLessThan(desert.height);
  });
});
