import { afterEach, describe, expect, it } from 'vitest';
import {
  CREATURES,
  SEA_CAVE_MOD,
  SEA_CAVE_PIECES,
  Tile,
  WORLD_REGIONS,
  checkEdit,
  generateRegion,
  glowOf,
  landmarkAt,
  setPieces,
  switchMod,
  type RegionMap,
  type TilePoint,
  type WorldEdit,
} from '../src/index.ts';

const shoreDef = WORLD_REGIONS.find((r) => r.id === 'sunlit-shore') ?? WORLD_REGIONS[0]!;
const tile = (map: RegionMap, [x, y]: TilePoint) => map.tiles[y * map.width + x] as Tile;
const piece = (id: string, at: TilePoint): WorldEdit => ({ kind: 'piece', piece: id, at, id: `p-${id}`, by: 'Ego', made: 0 });
const edited = (...edits: WorldEdit[]) => generateRegion({ ...structuredClone(shoreDef), edits });

/** Two open ground tiles side by side, with open ground around them. */
function openPair(map: RegionMap): TilePoint {
  for (let y = 4; y < map.height - 4; y++) {
    for (let x = 4; x < map.width - 4; x++) {
      let clear = true;
      for (let j = -2; j <= 2 && clear; j++) for (let i = -2; i <= 3 && clear; i++) clear = tile(map, [x + i, y + j]) === Tile.Ground;
      if (clear) return [x, y];
    }
  }
  throw new Error('no open ground');
}

describe("the Smugglers' Sea Cave Art Kit", () => {
  const plain = generateRegion(shoreDef);
  const spot = openPair(plain);
  afterEach(() => switchMod(SEA_CAVE_MOD, true));

  it('stands a sea cave piece on open ground, blocking its footprint', () => {
    const boulder = SEA_CAVE_PIECES.find((p) => p.id === 'sea-cave-boulder')!;
    const map = edited(piece(boulder.id, spot));
    const placed = landmarkAt(map, spot);
    expect(placed).toMatchObject({ asset: boulder.id, x: spot[0] + 1, y: spot[1] + 1, footprint: { width: 2, height: 1 } });
    expect(landmarkAt(map, [spot[0] + 1, spot[1]])).toBe(placed);
    expect(tile(map, spot)).toBe(Tile.Blocked);
    expect(tile(map, [spot[0] + 1, spot[1]])).toBe(Tile.Blocked);
    expect(tile(map, [spot[0] + 2, spot[1]])).toBe(Tile.Ground);
  });

  it('refuses a piece where something stands, off the land, or of no kind', () => {
    const map = edited(piece('sea-cave-crates', spot));
    expect(checkEdit(map, { kind: 'piece', piece: 'sea-cave-lantern', at: spot }, CREATURES)).toMatch(/already stands/);
    expect(checkEdit(map, { kind: 'piece', piece: 'sea-cave-lantern', at: [-1, 3] }, CREATURES)).toMatch(/edge/);
    expect(checkEdit(map, { kind: 'piece', piece: 'sea-cave-crates', at: [map.width - 1, spot[1]] }, CREATURES)).toMatch(/edge/);
    expect(checkEdit(map, { kind: 'piece', piece: 'dragon-hoard', at: spot }, CREATURES)).toMatch(/no set piece/);
    expect(checkEdit(map, { kind: 'piece', piece: 'sea-cave-lantern', at: [spot[0] + 3, spot[1]] }, CREATURES)).toBeUndefined();
  });

  it('lights its ship lantern like any other lantern', () => {
    expect(glowOf('sea-cave-lantern')).toBeDefined();
  });

  it('takes its pieces out of the world and the editor while the wish is off', () => {
    switchMod(SEA_CAVE_MOD, false);
    expect(setPieces()).toEqual([]);
    const map = edited(piece('sea-cave-boulder', spot));
    expect(map.landmarks).toEqual(plain.landmarks);
    expect(map.tiles).toEqual(plain.tiles);
    expect(checkEdit(plain, { kind: 'piece', piece: 'sea-cave-boulder', at: spot }, CREATURES)).toMatch(/no set piece/);
  });
});
