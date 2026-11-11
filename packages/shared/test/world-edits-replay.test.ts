import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, Tile, WORLD_REGIONS, generateRegion, hashString, type RegionDef, type RegionMap, type TilePoint, type WorldEdit, type WorldEditDraft } from '../src/index.ts';

// Every kind of edit, laid on every shipped land: the maps must come out the
// same as they did before the editor's code was reorganised, tile for tile.
// The fingerprints below were taken on main before the edit kinds registry.

/** Tiles the edits below can be laid on. */
const OPEN: Tile[] = [Tile.Ground, Tile.Path];

/** Open ground with room around it, the same spot every run; the middle when there is none (edits that do not fit are passed over, which is tested too). */
function openSpot(map: RegionMap): TilePoint {
  for (let y = 10; y < map.height - 10; y++) {
    for (let x = 10; x < map.width - 10; x++) {
      let clear = true;
      for (let j = -6; j <= 7 && clear; j++) for (let i = -6; i <= 6 && clear; i++) clear = OPEN.includes(map.tiles[(y + j) * map.width + x + i] as Tile);
      if (clear) return [x, y];
    }
  }
  return [Math.floor(map.width / 2), Math.floor(map.height / 2)];
}

/** One of each kind, around a spot. */
function everyKind([x, y]: TilePoint): WorldEditDraft[] {
  return [
    { kind: 'paint', tile: 'tree', tiles: [[x - 6, y - 6], [x - 5, y - 6]] },
    { kind: 'paint', tile: 'water', tiles: [[x + 6, y - 6], [x + 6, y - 5], [x + 5, y - 5]] },
    { kind: 'paint', tile: 'path', tiles: [[x + 6, y - 5]] },
    { kind: 'move', from: [x - 6, y - 6], to: [x - 6, y + 6] },
    { kind: 'move', from: [x - 5, y - 6], to: null },
    { kind: 'road', from: [x - 6, y + 6], to: [x + 6, y + 6] },
    { kind: 'house', at: [x - 2, y - 5], floor: [4, 4], style: 'sanctum-inn' },
    { kind: 'floors', at: [x, y - 3], up: 1, down: 1 },
    { kind: 'spawn', creature: 'walking-mushroom', at: [x + 4, y + 3], count: 3 },
    { kind: 'clear', at: [x + 4, y + 3], radius: 1 },
    { kind: 'piece', piece: 'sea-cave-boulder', at: [x - 5, y + 3] },
    { kind: 'footprint', at: [x - 5, y + 3], footprint: [3, 2] },
    { kind: 'spot', spot: 'sanctum-sage', at: [x + 2, y + 3] },
    { kind: 'spot', spot: null, at: [x + 2, y + 3] },
    { kind: 'spot', spot: 'sanctum-sage', at: [x + 3, y + 4] },
  ];
}

/** A map's whole shape as one number. */
function fingerprint(map: RegionMap): number {
  const { def: _, tiles, storeys, ...rest } = map;
  return hashString(JSON.stringify({ tiles: [...tiles], storeys: storeys.map((s) => ({ ...s, tiles: [...s.tiles] })), ...rest }));
}

const LANDS: RegionDef[] = [...WORLD_REGIONS, ARCH_TESTBED_REGION];

const EXPECTED: Record<string, number> = {
  sanctum: 3404506665,
  woods: 1736359563,
  shore: 1518853151,
  desert: 2102079442,
  frostpeak: 712081707,
  'mushroom-hollow': 1416057618,
  'arch-testbed': 3516164357,
};

describe('world edits replay', () => {
  for (const def of LANDS) {
    it(`lays every kind of edit on ${def.name} as before`, () => {
      const plain = generateRegion(def);
      const at = openSpot(plain);
      const edits: WorldEdit[] = everyKind(at).map((d, i) => ({ ...d, id: `e${i}`, by: 'Test', made: 0 }) as WorldEdit);
      const map = generateRegion({ ...def, edits });
      const print = fingerprint(map);
      if (process.env.PRINT_FINGERPRINTS) console.log(`FP '${def.id}': ${print},`);
      expect(print).not.toBe(fingerprint(plain));
      expect(print).toBe(EXPECTED[def.id]);
    });
  }
});
