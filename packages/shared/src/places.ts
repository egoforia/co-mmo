import type { BiomeId } from './biomes.ts';
import { block, building, creatures, disc, placer, road, Tile, type RegionMap } from './world.ts';

// The great places of each launch land: temples, caves, castles, palaces,
// tombs and wonders out in the wilds, each joined to the middle by a road
// (with bridges where it crosses water) and each with its own creatures and
// people. Places are data, laid out the same on server and client; their
// pictures are painted from BUILDING_STYLES and the anchors like all art.

/** A piece of furniture inside a building: its key in the style, where on the floor, and its footprint. */
type Furnish = [key: string, x: number, y: number, width: number, height: number];

/** Creatures that live at a place: on its floor when it is a building, else around it. */
interface Den {
  creature: string;
  name: string;
  asset: string;
  count: number;
}

export type Place =
  | {
    kind: 'building';
    style: string;
    /** Top-left corner of its walls, from the middle of the land, in tiles. */
    at: [number, number];
    /** Its floor inside the walls, in tiles. */
    floor: [number, number];
    furniture?: Furnish[];
    den?: Den;
    /** Someone who lives there: where they stand, from the floor's top-left tile. */
    npc?: { id: string; name: string; asset: string; x: number; y: number };
  }
  | {
    kind: 'landmark';
    asset: string;
    /** Bottom middle of the art, from the middle of the land, in tiles. */
    at: [number, number];
    footprint: [number, number];
    /** Open ground around it, in tiles. */
    clearing: number;
    den?: Den;
  };

const MOTHS: Den = { creature: 'lantern-moth', name: 'Lantern Moth', asset: 'sanctum-lantern-moth', count: 6 };
const WOLVES: Den = { creature: 'thorn-wolf', name: 'Thorn Wolf', asset: 'woods-thorn-wolf', count: 5 };
const GOLEMS: Den = { creature: 'bark-golem', name: 'Bark Golem', asset: 'woods-bark-golem', count: 4 };
const GULLS: Den = { creature: 'gull-raider', name: 'Gull Raider', asset: 'shore-gull-raider', count: 5 };
const DECKHANDS: Den = { creature: 'drowned-deckhand', name: 'Drowned Deckhand', asset: 'shore-drowned-deckhand', count: 4 };
const HERMITS: Den = { creature: 'hermit-crab', name: 'Hermit Crab', asset: 'shore-hermit-crab', count: 5 };
const JACKALS: Den = { creature: 'dune-jackal', name: 'Dune Jackal', asset: 'desert-dune-jackal', count: 5 };
const MUMMIES: Den = { creature: 'mummy-guard', name: 'Mummy Guard', asset: 'desert-mummy-guard', count: 5 };
const WYRMS: Den = { creature: 'sand-wyrm', name: 'Sand Wyrm', asset: 'desert-sand-wyrm', count: 2 };

/** Each launch land's great places. */
export const BIOME_PLACES: Partial<Record<BiomeId, Place[]>> = {
  sanctum: [
    {
      kind: 'building', style: 'sanctum-temple', at: [-44, -52], floor: [18, 12],
      furniture: [['altar', 8, 1, 3, 1], ['bell-rack', 2, 1, 3, 1], ['bell-rack', 14, 1, 3, 1], ['brazier', 5, 3, 1, 1], ['brazier', 13, 3, 1, 1],
        ['pew', 3, 7, 3, 1], ['pew', 13, 7, 3, 1], ['pew', 3, 10, 3, 1], ['pew', 13, 10, 3, 1]],
      npc: { id: 'brother-tolle', name: 'Brother Tolle', asset: 'sanctum-bell-keeper', x: 9.5, y: 4.5 },
    },
    { kind: 'landmark', asset: 'sanctum-standing-stones', at: [44, 34], footprint: [4, 2], clearing: 6, den: MOTHS },
    { kind: 'landmark', asset: 'sanctum-fountain', at: [-12, 16], footprint: [2, 1], clearing: 4 },
    { kind: 'landmark', asset: 'sanctum-bell-tower', at: [-60, 40], footprint: [2, 2], clearing: 5, den: MOTHS },
  ],
  'whispering-woods': [
    {
      kind: 'building', style: 'woods-cave', at: [-70, 40], floor: [16, 12],
      furniture: [['crystals', 2, 2, 2, 1], ['crystals', 13, 9, 2, 1], ['stalagmite', 6, 3, 1, 1], ['stalagmite', 11, 6, 1, 1], ['stalagmite', 3, 9, 1, 1], ['old-chest', 14, 2, 2, 1]],
      den: { ...WOLVES, count: 4 },
    },
    {
      kind: 'building', style: 'woods-castle', at: [30, -80], floor: [24, 16],
      furniture: [['throne', 12, 1, 2, 1], ['tapestry', 5, 1, 3, 1], ['tapestry', 18, 1, 3, 1], ['pillar', 6, 6, 1, 1], ['pillar', 18, 6, 1, 1],
        ['pillar', 6, 11, 1, 1], ['pillar', 18, 11, 1, 1], ['armour-stand', 2, 14, 1, 1], ['armour-stand', 22, 14, 1, 1]],
      npc: { id: 'sir-alder', name: 'Sir Alder', asset: 'woods-old-knight', x: 12.5, y: 4.5 },
    },
    { kind: 'landmark', asset: 'woods-fairy-ring', at: [46, 46], footprint: [3, 1], clearing: 5 },
    { kind: 'landmark', asset: 'woods-fallen-giant', at: [-56, -44], footprint: [6, 2], clearing: 4, den: WOLVES },
    { kind: 'landmark', asset: 'woods-castle-gate', at: [42, -40], footprint: [4, 2], clearing: 4, den: GOLEMS },
  ],
  'sunlit-shore': [
    {
      kind: 'building', style: 'shore-coral-palace', at: [4, -70], floor: [22, 14],
      furniture: [['coral-throne', 10, 1, 2, 1], ['giant-clam', 3, 2, 2, 1], ['giant-clam', 18, 2, 2, 1], ['kelp-pillar', 6, 6, 1, 1], ['kelp-pillar', 16, 6, 1, 1], ['pearl-fountain', 10, 9, 2, 1]],
      npc: { id: 'queen-nerissa', name: 'Queen Nerissa', asset: 'shore-sea-queen', x: 11, y: 4.5 },
    },
    {
      kind: 'building', style: 'shore-sea-cave', at: [10, 56], floor: [14, 10],
      furniture: [['treasure-chest', 6, 1, 2, 1], ['rum-barrel', 1, 2, 1, 1], ['rum-barrel', 2, 2, 1, 1], ['rope-coil', 11, 7, 1, 1], ['ship-lantern', 12, 2, 1, 1]],
      den: DECKHANDS,
    },
    { kind: 'landmark', asset: 'shore-shipwreck', at: [-40, 36], footprint: [6, 2], clearing: 5, den: GULLS },
    { kind: 'landmark', asset: 'shore-giant-shell', at: [-50, -36], footprint: [3, 2], clearing: 4, den: HERMITS },
    { kind: 'landmark', asset: 'shore-tide-shrine', at: [-80, 4], footprint: [2, 1], clearing: 4, den: GULLS },
  ],
  'mirage-desert': [
    {
      kind: 'building', style: 'desert-palace', at: [-78, 30], floor: [24, 16],
      furniture: [['golden-throne', 11, 1, 2, 1], ['carpet', 10, 7, 4, 2], ['cushions', 4, 4, 2, 1], ['cushions', 18, 4, 2, 1],
        ['palace-fountain', 11, 11, 2, 1], ['palm-pot', 1, 1, 1, 1], ['palm-pot', 22, 1, 1, 1]],
      npc: { id: 'sultana-zahra', name: 'Sultana Zahra', asset: 'desert-sultana', x: 12, y: 4.5 },
    },
    {
      kind: 'building', style: 'desert-tomb', at: [44, 44], floor: [16, 12],
      furniture: [['sarcophagus', 7, 1, 2, 2], ['canopic-jars', 2, 2, 2, 1], ['canopic-jars', 12, 2, 2, 1], ['sun-statue', 1, 8, 1, 1], ['sun-statue', 14, 8, 1, 1]],
      den: MUMMIES,
    },
    { kind: 'landmark', asset: 'desert-pyramid', at: [74, -50], footprint: [6, 3], clearing: 5, den: MUMMIES },
    { kind: 'landmark', asset: 'desert-obelisk', at: [-34, -44], footprint: [1, 1], clearing: 4, den: JACKALS },
    { kind: 'landmark', asset: 'desert-wyrm-bones', at: [12, -80], footprint: [6, 2], clearing: 6, den: WYRMS },
  ],
};

/** Night hunters and other roamers each land adds to its wilds, beyond those at its places. */
const ROAMERS: Partial<Record<BiomeId, Den[]>> = {
  sanctum: [{ ...MOTHS, count: 12 }],
  'whispering-woods': [{ ...WOLVES, count: 20 }],
  'sunlit-shore': [{ ...GULLS, count: 16 }, { ...HERMITS, count: 12 }],
  'mirage-desert': [{ ...JACKALS, count: 20 }],
};

/** Lays out a launch land's great places and roamers. */
export function layPlaces(map: RegionMap, c: number): void {
  for (const place of BIOME_PLACES[map.def.biome] ?? []) {
    if (place.kind === 'building') {
      const left = c + place.at[0];
      const top = c + place.at[1];
      const b = building(map, left, top, place.floor[0], place.floor[1], place.style);
      map.buildings.push(b);
      road(map, b.door.x, b.door.y + 1, c, c);
      const put = placer(map, place.style, left + 1, top + 1);
      for (const [key, x, y, w, h] of place.furniture ?? []) put(key, x, y, w, h);
      if (place.npc) map.npcs.push({ id: place.npc.id, name: place.npc.name, asset: place.npc.asset, x: left + 1 + place.npc.x, y: top + 1 + place.npc.y });
      if (place.den) indoors(map, b.x + 1, b.y + 1, b.width - 2, b.height - 2, place.den);
    } else {
      const x = c + place.at[0];
      const y = c + place.at[1];
      disc(map, Math.floor(x), Math.floor(y) - 1, place.clearing, Tile.Ground);
      map.landmarks.push({ asset: place.asset, x, y, footprint: { width: place.footprint[0], height: place.footprint[1] } });
      block(map, x, y, place.footprint[0], place.footprint[1]);
      road(map, Math.floor(x), Math.floor(y) + 1, c, c);
      if (place.den) around(map, x, y, place.clearing + 3, place.den);
    }
  }
  for (const den of ROAMERS[map.def.biome] ?? []) creatures(map, den.creature, den.name, den.asset, den.count);
}

/** A den inside a building: creatures on free floor tiles, spread out. */
function indoors(map: RegionMap, x0: number, y0: number, w: number, h: number, den: Den): void {
  let placed = 0;
  for (let i = 0; placed < den.count && i < 200; i++) {
    const x = x0 + 1 + ((i * 7) % Math.max(1, w - 2));
    const y = y0 + 2 + ((i * 5) % Math.max(1, h - 3));
    if (map.tiles[y * map.width + x] !== Tile.Floor) continue;
    if (map.creatures.some((s) => Math.hypot(s.x - x - 0.5, s.y - y - 0.5) < 2)) continue;
    map.creatures.push({ kind: den.creature, name: den.name, asset: den.asset, x: x + 0.5, y: y + 0.5 });
    placed++;
  }
}

/** A den around a landmark: creatures on open ground in a ring about it. */
function around(map: RegionMap, cx: number, cy: number, r: number, den: Den): void {
  let placed = 0;
  for (let i = 0; placed < den.count && i < 60; i++) {
    const a = (i / 12) * Math.PI * 2 + i * 0.37;
    const x = Math.floor(cx + Math.cos(a) * r);
    const y = Math.floor(cy + Math.sin(a) * r * 0.8);
    if (x < 1 || y < 1 || x >= map.width - 1 || y >= map.height - 1 || map.tiles[y * map.width + x] !== Tile.Ground) continue;
    map.creatures.push({ kind: den.creature, name: den.name, asset: den.asset, x: x + 0.5, y: y + 0.5 });
    placed++;
  }
}
