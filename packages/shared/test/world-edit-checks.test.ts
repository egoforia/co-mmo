import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, Tile, WORLD_REGIONS, generateRegion, landChecks, type RegionMap } from '../src/index.ts';

// The editor's checks panel: shapes and walks.

describe('land checks', () => {
  it('finds nothing wrong in the lands players start in', () => {
    for (const def of WORLD_REGIONS) expect(landChecks(generateRegion(def)), def.id).toEqual({ shapes: [], walks: [] });
    // The testbed too: every stair stands on open floor at both ends, and everyone can be walked to.
    expect(landChecks(generateRegion(ARCH_TESTBED_REGION))).toEqual({ shapes: [], walks: [] });
  });

  it('finds a person shut away by walls, and nothing wrong once they are let out', () => {
    const map: RegionMap = structuredClone(generateRegion(ARCH_TESTBED_REGION));
    const x = Math.floor(map.spawn.x) + 12;
    const y = Math.floor(map.spawn.y) + 12;
    const before = landChecks(map).walks.length;
    // Everyone in the testbed as shipped can be walked to, up and down its stairs.
    expect(before).toBe(0);
    // A ring of rock with Hesper inside it.
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) === 2 || Math.abs(dy) === 2) map.tiles[(y + dy) * map.width + x + dx] = Tile.Rock;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) map.tiles[(y + dy) * map.width + x + dx] = Tile.Ground;
    map.npcs.push({ id: 'shut', name: 'Hesper', asset: 'npc-mara', x: x + 0.5, y: y + 0.5 });
    const shut = landChecks(map);
    expect(shut.walks).toHaveLength(before + 1);
    expect(shut.walks.some((w) => /^Hesper .* cannot be walked to/.test(w))).toBe(true);
    map.tiles[(y + 2) * map.width + x] = Tile.Path;
    expect(landChecks(map).walks).toHaveLength(before);
  });

  it('lists stairs that do not join next floors', () => {
    const map: RegionMap = structuredClone(generateRegion(ARCH_TESTBED_REGION));
    const shapes = landChecks(map).shapes.length;
    map.stairways.push({ kind: 'stairs', x: 5, y: 5, width: 1, height: 2, lower: 0, upper: 2, bottom: { x: 5.5, y: 7.5 }, top: { x: 5.5, y: 4.5 } } as RegionMap['stairways'][number]);
    expect(landChecks(map).shapes.length).toBeGreaterThan(shapes);
  });
});
