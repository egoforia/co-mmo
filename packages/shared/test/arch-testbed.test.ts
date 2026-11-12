import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, ARCH_TESTBED_WAYPOINTS, Tile, generateRegion, regionDef, storeyAt } from '../src/index.ts';

describe('arch-testbed: architectural clean-room proving ground', () => {
  const def = ARCH_TESTBED_REGION;
  const map = generateRegion(def);

  it('is a registered region with clean-room guarantees', () => {
    expect(def).toBeDefined();
    expect(regionDef('arch-testbed')).toBeDefined();
    expect(def.id).toBe('arch-testbed');
    expect(def.biome).toBe('sanctum');
    // Clean-room guarantees: zero entities or clutter to distract automated testing
    expect(map.creatures).toHaveLength(0);
    expect(map.npcs).toHaveLength(0);
    expect(map.spots).toHaveLength(0);
  });

  it('lays out Bay 1: Ground Enclosed Pavilions & Central Marker', () => {
    const pavA = map.buildings.find((b) => b.x === 40 && b.y === 40);
    const pavB = map.buildings.find((b) => b.x === 56 && b.y === 40);
    expect(pavA).toBeDefined();
    expect(pavB).toBeDefined();
    expect(pavA!.style).toBe('sanctum-inn');
    expect(pavB!.style).toBe('sanctum-inn');

    // Central test marker inside Pavilion A
    const marker = map.landmarks.find((l) => l.x === 44.5 && l.y === 44.5);
    expect(marker).toBeDefined();
  });

  it('lays out Bay 2: Stepped Mountain Terrace Pedestal (F1, F2, F4)', () => {
    const t1 = map.storeys.find((s) => s.x === 100 && s.y === 40 && s.floor === 1);
    const t2 = map.storeys.find((s) => s.x === 102 && s.y === 40 && s.floor === 2);
    const t4 = map.storeys.find((s) => s.x === 118 && s.y === 40 && s.floor === 4);

    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t4).toBeDefined();

    expect(t1!.open).toBe(true);
    expect(t2!.open).toBe(true);
    expect(t4!.open).toBe(true);
  });

  it('lays out Bay 3: Two-Storey Modular House with Internal Stairs', () => {
    const groundHouse = map.buildings.find((b) => b.x === 40 && b.y === 100);
    const upperStorey = map.storeys.find((s) => s.x === 40 && s.y === 100 && s.floor === 1);
    expect(groundHouse).toBeDefined();
    expect(upperStorey).toBeDefined();
    expect(upperStorey!.open).toBeFalsy();

    // Internal stairs
    const stairs = map.stairways.find((s) => s.x === 48 && s.y === 104 && s.lower === 0 && s.upper === 1);
    expect(stairs).toBeDefined();
  });

  it('lays out Bay 4: The Overlap Bug Lab (Terrace Overlap & Cutaway Isolation)', () => {
    const bugCottage = map.buildings.find((b) => b.x === 104 && b.y === 104);
    const overlapTerrace = map.storeys.find((s) => s.x === 100 && s.y === 100 && s.floor === 1);
    const yardCottage = map.buildings.find((b) => b.x === 104 && b.y === 118);

    expect(bugCottage).toBeDefined();
    expect(overlapTerrace).toBeDefined();
    expect(yardCottage).toBeDefined();

    expect(overlapTerrace!.open).toBe(true);
    // Overlap zone exists: terrace covers cottage from x=104..112, y=104..112
    expect(storeyAt(map, 106, 106, 1)).toBe(overlapTerrace);
    // Cantilever zone exists: terrace covers empty ground from x=100..103, y=104..108
    expect(storeyAt(map, 101, 106, 1)).toBe(overlapTerrace);
  });

  it('lays out Bay 5: Subterranean Cavern Vaults (Floors -1 and -2)', () => {
    const v1 = map.storeys.find((s) => s.x === 40 && s.y === 160 && s.floor === -1);
    const v2 = map.storeys.find((s) => s.x === 40 && s.y === 160 && s.floor === -2);
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();

    const stairs = map.stairways.find((s) => s.x === 44 && s.y === 163 && s.lower === -2 && s.upper === -1);
    expect(stairs).toBeDefined();
  });

  it('lays out Bay 6: Vertical Proving Runway (Stairs, Bridges, Crypts)', () => {
    // Fixture A: Outdoor stairs
    expect(map.stairways.some((s) => s.x === 98 && s.y === 158 && s.lower === 0 && s.upper === 1)).toBe(true);

    // Fixture B: Indoor stairs
    expect(map.stairways.some((s) => s.x === 110 && s.y === 158 && s.lower === 0 && s.upper === 1)).toBe(true);

    // Fixture C: Crypt descent
    expect(map.stairways.some((s) => s.x === 122 && s.y === 159 && s.lower === -1 && s.upper === 0)).toBe(true);

    // Fixture D: Viaduct bridge (span at 132, 158, width 4, height 8 on floor 1)
    const bridgeSpan = map.storeys.find((s) => s.x === 132 && s.y === 158 && s.floor === 1);
    expect(bridgeSpan).toBeDefined();
    expect(bridgeSpan!.open).toBe(true);

    // Fixture E: Terrace stairs (Floor 1 to Floor 2), up through the upper terrace so both floors are open under them.
    expect(map.stairways.some((s) => s.x === 144 && s.y === 158 && s.lower === 1 && s.upper === 2)).toBe(true);
  });

  it('defines valid test waypoints for all 25 architectural combinations', () => {
    const expectedKeys = [
      'G1-A', 'G1-B', 'G1-C', 'G1-D', 'G1-E',
      'G2-A', 'G2-B', 'G2-C', 'G2-D', 'G2-E',
      'G3-A', 'G3-B', 'G3-C', 'G3-D',
      'D1', 'D2', 'D3', 'D4',
      'G5-A', 'G5-B',
      'G6-A', 'G6-B', 'G6-C', 'G6-D', 'G6-E',
    ];

    expect(Object.keys(ARCH_TESTBED_WAYPOINTS)).toEqual(expectedKeys);

    for (const [key, wp] of Object.entries(ARCH_TESTBED_WAYPOINTS)) {
      expect(wp.x, `${key} x`).toBeGreaterThanOrEqual(0);
      expect(wp.x, `${key} x`).toBeLessThan(map.width);
      expect(wp.y, `${key} y`).toBeGreaterThanOrEqual(0);
      expect(wp.y, `${key} y`).toBeLessThan(map.height);
      expect(Number.isInteger(wp.floor), `${key} floor integer`).toBe(true);
    }
  });

  it('lays the world editor\'s edits over its layout, like every other land', () => {
    const tree = { kind: 'paint' as const, tile: 'tree' as const, tiles: [[30, 34]] as [number, number][], id: 't1', by: 'Owner', made: 0 };
    const spawn = { kind: 'spawn' as const, creature: 'walking-mushroom', at: [34, 30] as [number, number], count: 2, id: 's1', by: 'Owner', made: 0 };
    const edited = generateRegion({ ...def, edits: [tree, spawn] });
    expect(map.tiles[34 * map.width + 30]).toBe(Tile.Ground);
    expect(edited.tiles[34 * edited.width + 30]).toBe(Tile.Tree);
    expect(edited.creatures.length).toBe(2);
    // The rest of the testbed is untouched.
    expect(edited.buildings.length).toBe(map.buildings.length);
    expect(edited.storeys.length).toBe(map.storeys.length);
  });
});

