import { describe, expect, it } from 'vitest';
import {
  CREATURES,
  KIT_HOUSE_FLOORS,
  Tile,
  WORLD_REGIONS,
  buildingKit,
  checkEdit,
  generateRegion,
  houseCorner,
  landmarkAt,
  type RegionDef,
  type RegionMap,
  type TilePoint,
  type WorldEdit,
  type WorldEditDraft,
} from '../src/index.ts';

const sanctumDef = WORLD_REGIONS.find((r) => r.id === 'sanctum')!;
let n = 0;
const stamp = (d: WorldEditDraft, extra: Partial<WorldEdit> = {}): WorldEdit => ({ ...d, id: `e${++n}`, by: 'Ego', made: 0, ...extra }) as WorldEdit;
const edited = (...edits: WorldEdit[]): RegionMap => generateRegion({ ...structuredClone(sanctumDef), edits });
const tile = (map: RegionMap, [x, y]: TilePoint) => map.tiles[y * map.width + x] as Tile;

/** An open ground tile in the plain map, at least `room` tiles from anything else. */
function openGround(map: RegionMap, near: TilePoint, room = 2): TilePoint {
  for (let r = 0; r < 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const [x, y] = [near[0] + dx, near[1] + dy];
        let clear = true;
        for (let j = -room; j <= room && clear; j++) for (let i = -room; i <= room && clear; i++) clear = tile(map, [x + i, y + j]) === Tile.Ground;
        if (clear) return [x, y];
      }
    }
  }
  throw new Error('no open ground');
}

describe('world edits', () => {
  const plain = generateRegion(sanctumDef);
  const spot = openGround(plain, [100, 140]);

  it('lays nothing new on a land without edits', () => {
    expect(edited().tiles).toEqual(plain.tiles);
  });

  it('paints tiles, bridging water with a path, and leaves buildings alone', () => {
    const arcanum = plain.buildings.find((b) => b.style === 'sanctum-arcanum')!;
    const wall: TilePoint = [arcanum.x, arcanum.y];
    const water = plain.tiles.findIndex((t) => t === Tile.Water);
    const wet: TilePoint = [water % plain.width, Math.floor(water / plain.width)];
    const map = edited(stamp({ kind: 'paint', tile: 'tree', tiles: [spot, wall] }), stamp({ kind: 'paint', tile: 'path', tiles: [wet] }));
    expect(tile(map, spot)).toBe(Tile.Tree);
    expect(tile(map, wall)).toBe(Tile.Wall);
    expect(tile(map, wet)).toBe(Tile.Bridge);
  });

  it('moves a tree from one spot to another, and takes one away', () => {
    const there = openGround(plain, [spot[0] + 6, spot[1]]);
    const map = edited(stamp({ kind: 'paint', tile: 'tree', tiles: [spot] }), stamp({ kind: 'move', from: spot, to: there }));
    expect(tile(map, spot)).toBe(Tile.Ground);
    expect(tile(map, there)).toBe(Tile.Tree);
    const gone = edited(stamp({ kind: 'paint', tile: 'tree', tiles: [spot] }), stamp({ kind: 'move', from: spot, to: null }));
    expect(tile(gone, spot)).toBe(Tile.Ground);
  });

  it('moves a set piece with its footprint', () => {
    const fountain = plain.landmarks.find((l) => l.asset === 'sanctum-fountain')!;
    const from: TilePoint = [Math.floor(fountain.x), Math.floor(fountain.y - 0.01)];
    expect(landmarkAt(plain, from)?.asset).toBe('sanctum-fountain');
    expect(tile(plain, from)).toBe(Tile.Blocked);
    const to: TilePoint = [from[0] + 3, from[1] + 1];
    const map = edited(stamp({ kind: 'move', from, to }));
    const moved = map.landmarks.find((l) => l.asset === 'sanctum-fountain')!;
    expect([moved.x, moved.y]).toEqual([fountain.x + 3, fountain.y + 1]);
    expect(tile(map, from)).toBe(Tile.Ground);
    expect(tile(map, to)).toBe(Tile.Blocked);
    expect(landmarkAt(map, to)?.asset).toBe('sanctum-fountain');
  });

  it('lays a road and a kit house at its end, with a doorway on the road', () => {
    const floor = KIT_HOUSE_FLOORS[1]!.floor;
    const doorstep: TilePoint = [spot[0] + 20, spot[1]];
    const at = houseCorner(doorstep, floor);
    const map = edited(
      stamp({ kind: 'paint', tile: 'ground', tiles: Array.from({ length: 16 * 16 }, (_, i) => [at[0] - 1 + (i % 16), at[1] - 1 + Math.floor(i / 16)] as TilePoint) }),
      stamp({ kind: 'road', from: spot, to: doorstep }),
      stamp({ kind: 'house', at, floor, style: 'sanctum-arcanum' }),
    );
    const house = map.buildings.at(-1)!;
    expect(house.style).toBe('sanctum-arcanum');
    expect(house.door).toEqual({ x: doorstep[0], y: doorstep[1] - 1 });
    expect(tile(map, [house.door.x, house.door.y])).toBe(Tile.Door);
    expect(tile(map, doorstep)).toBe(Tile.Ground);
    expect(tile(map, [spot[0] + 5, spot[1]])).toBe(Tile.Path);
    // Every kit-friendly floor makes a kit house the isometric camera can stand.
    for (const { floor: f } of KIT_HOUSE_FLOORS) {
      const m = edited(stamp({ kind: 'house', at: houseCorner(doorstep, f), floor: f, style: 'sanctum-arcanum' }));
      expect(buildingKit.kitHouse(m.buildings.at(-1)!), `${f}`).toBeDefined();
    }
  });

  it('places a monster spawn on open ground, the same every time, and clears monsters away', () => {
    const edit = stamp({ kind: 'spawn', creature: 'lantern-moth', at: spot, count: 4 }, { name: 'Lantern Moth', asset: 'sanctum-lantern-moth' });
    const map = edited(edit);
    const added = map.creatures.slice(-4);
    expect(added.every((c) => c.kind === 'lantern-moth' && Math.hypot(c.x - spot[0] - 0.5, c.y - spot[1] - 0.5) <= 3.6)).toBe(true);
    expect(added[0]).toMatchObject({ x: spot[0] + 0.5, y: spot[1] + 0.5 });
    expect(edited(edit).creatures).toEqual(map.creatures);
    const cleared = edited(edit, stamp({ kind: 'clear', at: spot, radius: 5 }));
    expect(cleared.creatures.some((c) => Math.hypot(c.x - spot[0] - 0.5, c.y - spot[1] - 0.5) <= 5)).toBe(false);
  });

  it('says why an edit cannot be made', () => {
    const def: RegionDef = structuredClone(sanctumDef);
    const map = generateRegion(def);
    const arcanum = map.buildings[0]!;
    expect(checkEdit(map, { kind: 'paint', tile: 'tree', tiles: [[-1, 4]] }, CREATURES)).toMatch(/edge/);
    expect(checkEdit(map, { kind: 'paint', tile: 'wall' as 'tree', tiles: [spot] }, CREATURES)).toMatch(/cannot lay/);
    expect(checkEdit(map, { kind: 'move', from: spot, to: null }, CREATURES)).toMatch(/nothing there/);
    expect(checkEdit(map, { kind: 'house', at: [arcanum.x + 1, arcanum.y], floor: [6, 6], style: 'sanctum-arcanum' }, CREATURES)).toMatch(/Another building/);
    expect(checkEdit(map, { kind: 'house', at: spot, floor: [6, 6], style: 'nope' }, CREATURES)).toMatch(/no house/);
    expect(checkEdit(map, { kind: 'spawn', creature: 'dragon-king', at: spot, count: 2 }, CREATURES)).toMatch(/no monster/);
    expect(checkEdit(map, { kind: 'spawn', creature: 'lantern-moth', at: spot, count: 99 }, CREATURES)).toMatch(/1 to 12/);
    expect(checkEdit(map, { kind: 'spawn', creature: 'lantern-moth', at: spot, count: 3 }, CREATURES)).toBeUndefined();
  });
});
