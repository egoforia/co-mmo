import { describe, expect, it } from 'vitest';
import { ARCANUM_SIZE, BUILDING_STYLES, WORLD_REGIONS, buildingKit, building, generateRegion, type Building, type RegionMap } from '../src/index.ts';

const { kitHouse, BAY_TILES, KitBuilding, shapeChecks } = buildingKit;

/** An empty map to build on. */
function blank(size = 64): RegionMap {
  const base = generateRegion(WORLD_REGIONS[0]!);
  return { ...base, width: size, height: size, tiles: new Uint8Array(size * size), landmarks: [], buildings: [] };
}

/** A building of `style` with a floor `w` by `h` tiles. */
function made(w: number, h: number, style = 'sanctum-arcanum'): Building {
  return building(blank(), 10, 10, w, h, style);
}

describe('kit houses for the game\'s buildings', () => {
  it('builds the Sanctum Arcanum on its floor, two tiles to a bay, with its door where the doorway is', () => {
    const shop = generateRegion(WORLD_REGIONS.find((r) => r.biome === 'sanctum')!).buildings.find((b) => b.style === 'sanctum-arcanum')!;
    const house = kitHouse(shop)!;
    expect(house.look).toBe('timber-cottage');
    expect(house.floor).toEqual({ left: shop.x + 1, top: shop.y + 1, right: shop.x + shop.width - 1, bottom: shop.y + shop.height - 1 });
    // a runs north and b west: W bays deep, D across.
    expect(house.spec.W).toBe(ARCANUM_SIZE.height / BAY_TILES);
    expect(house.spec.D).toBe(ARCANUM_SIZE.width / BAY_TILES);
    const south = house.spec.storeys[0]!.left!;
    const doorBay = Number(Object.entries(south).find(([, o]) => o === 'door')![0]);
    // The door's bay spans the doorway's two tiles, counted from the west.
    expect(house.floor.left + doorBay * BAY_TILES).toBe(shop.door.x);
  });

  it('passes every shape check, and the same layout always gets the same name', () => {
    for (const [w, h] of [[10, 8], [6, 4], [4, 4], [14, 6], [6, 10]]) {
      const house = kitHouse(made(w, h));
      if (!house) continue;
      const failed = shapeChecks(new KitBuilding(house.spec)).filter((c) => !c.ok).map((c) => c.check);
      expect(failed, `${w} by ${h}`).toEqual([]);
      expect(kitHouse(made(w, h))!.key).toBe(house.key);
    }
    expect(kitHouse(made(10, 8))!.key).not.toBe(kitHouse(made(6, 4))!.key);
  });

  it('leaves buildings it cannot build to their painted pictures', () => {
    // Old Bramble's hollow tree has no kit look.
    expect(BUILDING_STYLES['bramble-cottage']!.kit).toBeUndefined();
    expect(kitHouse(made(10, 8, 'bramble-cottage'))).toBeUndefined();
    // A floor that is not whole bays.
    expect(kitHouse(made(9, 8))).toBeUndefined();
    expect(kitHouse(made(10, 7))).toBeUndefined();
    // A doorway that straddles two bays (the middle of a floor 8 wide is tile 4, an odd tile from the west wall).
    expect(kitHouse(made(8, 8))).toBeUndefined();
  });
});
