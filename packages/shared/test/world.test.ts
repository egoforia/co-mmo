import { describe, expect, it } from 'vitest';
import {
  BUILDING_STYLES,
  COTTAGE_SIZE,
  OPPOSITE,
  PLAYER_SPEED,
  REVEAL_REACH,
  TICK_SECONDS,
  Tile,
  WORLD_REGIONS,
  arrivalPoint,
  cellBeyond,
  collides,
  linkRegions,
  nearestOpenSide,
  openSides,
  neighbourOffset,
  generateRegion,
  exteriorSpan,
  furnitureArt,
  isBlocking,
  nearBuilding,
  outsideSide,
  step,
  tileAt,
  type RegionMap,
  type Side,
  type WildLand,
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

describe("Old Bramble's cottage", () => {
  const woods = maps.find((m) => m.def.id === 'woods')!;
  const bramble = woods.npcs.find((n) => n.id === 'old-bramble')!;
  const floorAt = (x: number, y: number) => {
    const t = woods.tiles[y * woods.width + x];
    return t === Tile.Floor || t === Tile.Blocked;
  };

  it('has a 16 by 16 floor inside its walls', () => {
    // Bramble stands inside; find the room around her.
    let left = Math.floor(bramble.x);
    while (floorAt(left - 1, Math.floor(bramble.y))) left--;
    let top = Math.floor(bramble.y);
    while (floorAt(left, top - 1)) top--;
    let floor = 0;
    for (let y = top; y < top + COTTAGE_SIZE; y++) for (let x = left; x < left + COTTAGE_SIZE; x++) if (floorAt(x, y)) floor++;
    expect(COTTAGE_SIZE).toBe(16);
    expect(floor).toBe(COTTAGE_SIZE * COTTAGE_SIZE);
    // Walled all round, but for the doorway in the south wall.
    const right = left + COTTAGE_SIZE;
    const bottom = top + COTTAGE_SIZE;
    for (let y = top - 1; y <= bottom; y++) {
      expect(tileAt(woods, left - 1, y)).toBe(Tile.Wall);
      expect(tileAt(woods, right, y)).toBe(Tile.Wall);
    }
    const door = [];
    for (let x = left; x < right; x++) {
      expect(tileAt(woods, x, top - 1)).toBe(Tile.Wall);
      if (tileAt(woods, x, bottom) !== Tile.Wall) door.push(tileAt(woods, x, bottom));
    }
    expect(door).toEqual([Tile.Door, Tile.Door]);
    // No wall pokes out past the corners into the clearing.
    for (let y = top - 2; y <= bottom + 1; y++) for (const x of [left - 2, right + 1]) expect(tileAt(woods, x, y)).not.toBe(Tile.Wall);
    for (let x = left - 2; x <= right + 1; x++) for (const y of [top - 2, bottom + 1]) expect(tileAt(woods, x, y)).not.toBe(Tile.Wall);
    // The building the client draws matches the walls.
    expect(woods.buildings).toEqual([expect.objectContaining({ x: left - 1, y: top - 1, width: COTTAGE_SIZE + 2, height: COTTAGE_SIZE + 2 })]);
  });

  it('can be walked into through the door you see from the road', () => {
    const home = woods.buildings[0]!;
    const doorstep = { x: home.door.x + 1, y: home.door.y + 1.5 };
    expect(tileAt(woods, doorstep.x, doorstep.y)).toBe(Tile.Path);
    const seen = reachable(woods, woods.spawn);
    expect(seen[Math.floor(doorstep.y) * woods.width + Math.floor(doorstep.x)]).toBe(1);
    expect(seen[Math.floor(bramble.y) * woods.width + Math.floor(bramble.x)]).toBe(1);
    let pos = { ...doorstep };
    for (let i = 0; i < 60; i++) pos = step(woods, pos, 0, -1);
    expect(tileAt(woods, pos.x, pos.y)).not.toBe(Tile.Path);
    expect(pos.y).toBeLessThan(home.door.y);
    expect(isBlocking(Tile.Wall)).toBe(true);
    expect(isBlocking(Tile.Door)).toBe(false);
    // The outside art is centred on the doorway and covers the whole cottage.
    const art = exteriorSpan(home);
    expect(art.left + art.width / 2).toBe(home.door.x + 1);
    expect(art.bottom).toBe(home.y + home.height);
    expect(art.left).toBeLessThanOrEqual(home.x);
    expect(art.left + art.width).toBeGreaterThanOrEqual(home.x + home.width);
    expect(BUILDING_STYLES[home.style]).toBeDefined();
  });

  it('is furnished inside, with room left to walk', () => {
    const home = woods.buildings[0]!;
    const style = BUILDING_STYLES[home.style]!;
    const furniture = woods.landmarks.filter((l) => l.asset.startsWith(`${style.id}-furniture-`));
    // Every piece is one the building's style paints.
    for (const f of furniture) expect(Object.keys(style.furniture).map((key) => furnitureArt(style.id, key))).toContain(f.asset);
    expect(new Set(furniture.map((f) => f.asset)).size).toBeGreaterThanOrEqual(5);
    for (const f of furniture) {
      expect(f.x).toBeGreaterThan(home.x + 1);
      expect(f.x).toBeLessThan(home.x + home.width - 1);
      expect(f.y).toBeGreaterThan(home.y + 1);
      expect(f.y).toBeLessThan(home.y + home.height);
      expect(tileAt(woods, f.x, f.y - 0.5)).toBe(Tile.Blocked);
    }
  });

  it('shows its inside only to players close by', () => {
    const home = woods.buildings[0]!;
    expect(nearBuilding(home, bramble.x, bramble.y)).toBe(true);
    expect(nearBuilding(home, home.door.x + 1, home.door.y + 1 + REVEAL_REACH - 0.5)).toBe(true);
    expect(nearBuilding(home, home.door.x + 1, home.door.y + 1 + REVEAL_REACH + 0.5)).toBe(false);
    expect(nearBuilding(home, woods.spawn.x, woods.spawn.y)).toBe(false);
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

  it('lands players at the same point along the edge in the next region', () => {
    const woods = maps.find((m) => m.def.id === 'woods')!;
    const entry = woods.entries.east!;
    // Find a spot on the Woods' east edge, off the road, that is open ground.
    let y = 2;
    while (collides(woods, entry.x, y)) y++;
    expect(arrivalPoint(woods, 'west', { x: -0.1, y })).toEqual({ x: entry.x, y });
    expect(neighbourOffset('west')).toEqual({ x: -sanctum.width, y: 0 });
  });

  it('falls back to the road when the matching spot is blocked, and has no way into a closed edge', () => {
    const woods = maps.find((m) => m.def.id === 'woods')!;
    const entry = woods.entries.east!;
    let y = 2;
    while (!collides(woods, entry.x, y)) y++;
    expect(arrivalPoint(woods, 'west', { x: -0.1, y })).toEqual(entry);
    expect(arrivalPoint(woods, 'east', { x: 64.1, y: 30 })).toBeUndefined();
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

describe('a growing world', () => {
  const land = (id: string, at: { x: number; y: number }, wild?: Partial<WildLand>) => ({
    id, name: id, biome: 'frostpeak' as const, seed: 77, at, exits: {},
    wild: { danger: 2, trees: 2, rocks: 1, water: 1, creatures: [{ kind: 'walking-mushroom', name: 'Walking Mushroom', asset: 'woods-mushroom', count: 4 }], wisher: 'Mara', ...wild },
  });

  it('works out the launch roads from where each region sits', () => {
    const links = linkRegions(WORLD_REGIONS);
    for (const def of WORLD_REGIONS) expect(links.get(def.id)).toEqual(def.exits);
  });

  it('joins a new region to every region beside it, and finds the open edges', () => {
    const corner = land('corner', { x: -1, y: 1 });
    const links = linkRegions([...WORLD_REGIONS, corner]);
    expect(links.get('corner')).toEqual({ north: 'woods', east: 'desert' });
    expect(links.get('woods')).toMatchObject({ south: 'corner' });
    expect(links.get('desert')).toMatchObject({ west: 'corner' });
    const woods = WORLD_REGIONS.find((r) => r.id === 'woods')!;
    expect(openSides(WORLD_REGIONS, woods)).toEqual(['north', 'south', 'west']);
    expect(nearestOpenSide(WORLD_REGIONS, woods, 2, 30)).toBe('west');
    expect(nearestOpenSide(WORLD_REGIONS, woods, 30, 62)).toBe('south');
    expect(cellBeyond(woods, 'north')).toEqual({ x: -1, y: -1 });
  });

  it('lays out a wished region the same every time, with its creatures, person and roads reachable', () => {
    const def = { ...land('frost', { x: -2, y: 0 }, { npc: { id: 'frost-npc', name: 'Hermit', asset: 'wished-frost-npc' } }), exits: { east: 'woods', north: 'up' } };
    const map = generateRegion(def);
    expect(generateRegion(def).tiles).toEqual(map.tiles);
    expect(map.creatures).toHaveLength(4);
    expect(map.npcs.map((n) => n.name)).toEqual(['Hermit']);
    const seen = reachable(map, map.spawn);
    for (const entry of Object.values(map.entries)) expect(seen[Math.floor(entry.y) * map.width + Math.floor(entry.x)]).toBe(1);
    for (const n of map.npcs) expect(collides(map, n.x, n.y)).toBe(false);
  });

  it('grows trees, rocks and water as thick as the wish asked', () => {
    const count = (map: RegionMap, tile: Tile) => map.tiles.filter((t) => t === tile).length;
    const bare = generateRegion(land('bare', { x: 5, y: 5 }, { trees: 0, rocks: 0, water: 0 }));
    const thick = generateRegion(land('thick', { x: 5, y: 5 }, { trees: 3, rocks: 3, water: 3 }));
    expect(count(bare, Tile.Tree) + count(bare, Tile.Rock) + count(bare, Tile.Water)).toBe(0);
    expect(count(thick, Tile.Tree)).toBeGreaterThan(100);
    expect(count(thick, Tile.Water)).toBeGreaterThan(100);
  });
});
