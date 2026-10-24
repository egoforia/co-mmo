import { describe, expect, it } from 'vitest';
import { ARCANUM_SIZE, BUILDING_STYLES, WALLED_STYLES, WORLD_REGIONS, buildingKit, building, generateRegion, type Building, type RegionMap } from '../src/index.ts';

const { kitHouse, BAY_TILES, KitBuilding, KIT_LOOKS, shapeChecks } = buildingKit;

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

  it('builds each land\'s great hall from the kit, crowned with its towers, battlements or dome', () => {
    const crowns: Record<string, (s: buildingKit.BuildingSpec) => unknown> = {
      'sanctum-temple': (s) => s.dome,
      'woods-castle': (s) => s.battlements && s.towers?.length,
      'shore-coral-palace': (s) => s.dome && s.towers?.length,
      'desert-palace': (s) => s.dome && s.towers?.length,
    };
    const built = new Set<string>();
    for (const region of WORLD_REGIONS.filter((r) => !r.wild)) {
      for (const b of generateRegion(region).buildings.filter((x) => crowns[x.style])) {
        built.add(b.style);
        const house = kitHouse(b);
        expect(house, b.style).toBeDefined();
        expect(house!.spec.roof, b.style).toBe('flat');
        expect(crowns[b.style]!(house!.spec), b.style).toBeTruthy();
        for (const cut of [null, 0]) expect(shapeChecks(new KitBuilding(house!.spec, { cut })).filter((c) => !c.ok).map((c) => c.check), `${b.style} cut ${cut}`).toEqual([]);
      }
    }
    expect([...built].sort()).toEqual(Object.keys(crowns).sort());
  });

  it('keeps no window under a tower, and no house when the door would be under one', () => {
    const castle = kitHouse(made(26, 16, 'woods-castle'))!;
    const { left, front } = castle.spec.storeys[0]!;
    // The front-left tower stands over the front wall's first bay and the south wall's last.
    expect(front![0]).toBeUndefined();
    expect(left![castle.spec.D - 1]).toBeUndefined();
    // A floor two tiles wide is one bay, under the castle's corner towers.
    expect(kitHouse(made(2, 4, 'woods-castle'))).toBeUndefined();
  });

  it('gives every building style a kit look, wished ones too, except the caves and Old Bramble\'s tree', () => {
    for (const [id, style] of Object.entries(BUILDING_STYLES)) {
      if (WALLED_STYLES.includes(id)) expect(style.kit, `${id} stands as tall walls`).toBeUndefined();
      else expect(KIT_LOOKS[style.kit ?? ''], `${id} needs a kit look from building-kit/looks.ts`).toBeDefined();
    }
  });

  it('stands every building in every land as a kit house that passes its checks, unless it stands as walls', () => {
    for (const region of WORLD_REGIONS) {
      for (const b of generateRegion(region).buildings.filter((x) => !WALLED_STYLES.includes(x.style))) {
        const house = kitHouse(b);
        expect(house, `${region.id} ${b.style}: its floor and doorway must fall on the kit's two-tile bays`).toBeDefined();
        expect(shapeChecks(new KitBuilding(house!.spec)).filter((c) => !c.ok).map((c) => c.check), `${region.id} ${b.style}`).toEqual([]);
      }
    }
  });
});
