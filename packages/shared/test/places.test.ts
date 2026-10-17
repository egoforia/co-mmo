import { describe, expect, it } from 'vitest';
import {
  BIOME_PLACES,
  BUILDING_STYLES,
  CREATURES,
  ITEMS,
  LAND_PEOPLE,
  LAND_QUESTS,
  NPC_NAMES,
  REGION_SIZE,
  Tile,
  WORLD_REGIONS,
  generateRegion,
  isBlocking,
  type RegionMap,
} from '../src/index.ts';

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

const maps = WORLD_REGIONS.map((def) => generateRegion(def));

describe('the bigger lands', () => {
  it('are sixteen times the first lands, with many more creatures to meet', () => {
    expect(REGION_SIZE * REGION_SIZE).toBeGreaterThanOrEqual(16 * 64 * 64);
    for (const map of maps) expect(map.creatures.length).toBeGreaterThan(20);
  });

  it.each(maps.map((m) => [m.def.id, m] as const))('%s: every great place, its people and its creatures can be walked to from the middle', (_id, map) => {
    const seen = reachable(map, map.spawn);
    const at = (p: { x: number; y: number }) => seen[Math.floor(p.y) * map.width + Math.floor(p.x)];
    for (const n of map.npcs) expect(at(n), n.name).toBe(1);
    const places = BIOME_PLACES[map.def.biome] ?? [];
    expect(places.length).toBeGreaterThanOrEqual(4);
    for (const b of map.buildings) expect(at({ x: b.door.x, y: b.door.y + 1 }), b.style).toBe(1);
    // Nearly every creature too: a few may be shut in by trees, as before.
    const free = map.creatures.filter((c) => at(c)).length;
    expect(free / map.creatures.length).toBeGreaterThan(0.85);
  });

  it('carry their roads over water on bridges', () => {
    const bridges = maps.reduce((n, map) => n + map.tiles.filter((t) => t === Tile.Bridge).length, 0);
    expect(bridges).toBeGreaterThan(0);
    expect(isBlocking(Tile.Bridge)).toBe(false);
  });

  it('describe every building, creature, person, treasure and quest they use', () => {
    for (const places of Object.values(BIOME_PLACES)) {
      for (const place of places!) {
        if (place.kind === 'building') {
          const style = BUILDING_STYLES[place.style]!;
          expect(style, place.style).toBeDefined();
          for (const [key] of place.furniture ?? []) expect(style.furniture, `${place.style} ${key}`).toHaveProperty([key]);
          if (place.npc) expect(NPC_NAMES[place.npc.id]).toBe(place.npc.name);
        }
        if (place.den) expect(CREATURES[place.den.creature], place.den.creature).toBeDefined();
      }
    }
    for (const [id, quest] of Object.entries(LAND_QUESTS)) {
      expect(LAND_PEOPLE[quest.giver], id).toBeDefined();
      if (quest.goal.kind === 'defeat') expect(CREATURES[quest.goal.creature], id).toBeDefined();
      for (const reward of quest.reward.items ?? []) expect(ITEMS[reward.item], id).toBeDefined();
    }
    for (const person of Object.values(LAND_PEOPLE)) for (const sale of person.shop?.sells ?? []) expect(ITEMS[sale.item], sale.item).toBeDefined();
  });
});
