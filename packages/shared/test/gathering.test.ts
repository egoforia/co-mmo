import { describe, expect, it } from 'vitest';
import {
  BIOMES,
  ITEMS,
  SPOTS,
  Tile,
  WORLD_REGIONS,
  addItem,
  applyEdit,
  cannotGather,
  checkEdit,
  generateRegion,
  newCharacter,
  sensesSpots,
  spotNear,
  spotNeeds,
  tileAt,
  type BiomeId,
} from '../src/index.ts';

describe('gathering spots', () => {
  it('are four kinds in every shipped land, each gathered by a craft with a tool', () => {
    for (const def of WORLD_REGIONS) {
      const kinds = Object.values(SPOTS).filter((s) => s.biome === def.biome);
      expect(kinds, def.id).toHaveLength(4);
    }
    for (const [kind, def] of Object.entries(SPOTS)) {
      expect(ITEMS[def.material]?.material, kind).toBeDefined();
      expect(spotNeeds(kind), kind).toBeDefined();
      expect(BIOMES[def.biome as BiomeId]).toBeDefined();
    }
    // What only gathering gives says so.
    expect(ITEMS['copper-ore']!.material).toMatchObject({ source: 'gathered', family: 'ore', homes: ['sanctum'] });
  });

  it('stand on open ground away from the middle, blocking their tile, the same every time', () => {
    const map = generateRegion(WORLD_REGIONS.find((r) => r.id === 'frostpeak')!);
    expect(map.spots.length).toBeGreaterThanOrEqual(40);
    const c = map.width / 2;
    for (const s of map.spots) {
      expect(tileAt(map, s.x, s.y)).toBe(Tile.Blocked);
      expect(Math.hypot(s.x - c, s.y - c)).toBeGreaterThanOrEqual(10);
    }
    expect(generateRegion(WORLD_REGIONS.find((r) => r.id === 'frostpeak')!).spots).toEqual(map.spots);
    // A wished land of a biome with no spots of its own gets none.
    expect(generateRegion({ id: 'x', name: 'X', biome: 'ember-wastes', seed: 9, at: { x: 9, y: 9 }, exits: {} }).spots).toEqual([]);
  });

  it('need the right tool, fine enough for the material', () => {
    const c = newCharacter();
    expect(cannotGather(c, 'sanctum-copper')).toMatch(/need a pick/);
    addItem(c, 'tool-smithing-1');
    expect(cannotGather(c, 'sanctum-copper')).toBeUndefined();
    // Iron is tier 2.
    expect(cannotGather(c, 'woods-iron')).toMatch(/finer pick/);
    addItem(c, 'tool-smithing-2');
    expect(cannotGather(c, 'woods-iron')).toBeUndefined();
    expect(cannotGather(c, 'nothing')).toMatch(/nothing here/);
  });

  it('are found beside you', () => {
    const spots = [{ id: 'a', kind: 'sanctum-sage', x: 10, y: 10 }];
    expect(spotNear(spots, 11.6, 10.5)?.id).toBe('a');
    expect(spotNear(spots, 13, 10.5)).toBeUndefined();
  });

  it('are stood and taken away with the world editor', () => {
    const map = generateRegion(WORLD_REGIONS.find((r) => r.id === 'sanctum')!);
    const before = map.spots.length;
    let at: [number, number] = [0, 0];
    for (let y = 100; y < 160 && !at[0]; y++) for (let x = 100; x < 160; x++) if (tileAt(map, x, y) === Tile.Ground) { at = [x, y]; break; }
    const stamp = { id: 'e1', by: 'Owner', made: 0 };
    expect(checkEdit(map, { kind: 'spot', spot: 'no-such', at }, {})).toMatch(/no gathering spot of that kind/);
    expect(checkEdit(map, { kind: 'spot', spot: null, at }, {})).toMatch(/no gathering spot there/);
    expect(checkEdit(map, { kind: 'spot', spot: 'sanctum-sage', at }, {})).toBeUndefined();
    applyEdit(map, { kind: 'spot', spot: 'sanctum-sage', at, ...stamp });
    expect(map.spots).toHaveLength(before + 1);
    expect(tileAt(map, at[0], at[1])).toBe(Tile.Blocked);
    expect(checkEdit(map, { kind: 'spot', spot: 'sanctum-sage', at }, {})).toMatch(/already stands/);
    applyEdit(map, { kind: 'spot', spot: null, at, ...stamp, id: 'e2' });
    expect(map.spots).toHaveLength(before);
    expect(tileAt(map, at[0], at[1])).toBe(Tile.Ground);
  });

  it('show on the map for the Cervid', () => {
    const c = newCharacter();
    expect(sensesSpots(c)).toBe(false);
    c.race = 'cervid';
    expect(sensesSpots(c)).toBe(true);
    c.race = 'falcon';
    expect(sensesSpots(c)).toBe(false);
  });
});
