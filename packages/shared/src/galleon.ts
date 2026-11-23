import { buildFromPlans, planFloorName, type CaveFloor, type KitPlans } from './kit-floors.ts';
import { engineModId, modOn } from './mods.ts';
import { building, road, type RegionMap, type TileArt } from './world.ts';

// The Sunken Galleon Dungeon (wish #273): a huge castaway galleon run aground
// and half buried in the sand of the Sunlit Shore, its bow to the sea. Its
// broken top deck stands open on the beach, and three decks lie under the
// sand below it: the Gun Deck, the Orlop Deck and the Flooded Hold, where the
// drowned crew still guard the captain's chests. Like the sea cave it is built
// from its own kit pieces, floor by floor, from plans of letters
// (kit-floors.ts); the pieces are painted by the image model chosen in God's
// View (packages/server/src/assets/galleon-kit.ts). While the wish is
// switched off the galleon is not there and the shore is as it was.

/** The Sunken Galleon Dungeon wish (issue #273): the galleon stands only while this mod is on. */
export const GALLEON_MOD = engineModId(273);

/** The building style the galleon is laid out in (land-buildings.ts). */
export const GALLEON_STYLE = 'shore-sunken-galleon';

/** The kit pieces the galleon's tiles are drawn in. */
export const GALLEON_ART: TileArt = { floor: 'galleon-deck', wall: 'galleon-hull', face: 'galleon-hull-face' };

/** A prop of the galleon's kit: its picture's id, its name and the tiles it stands on. */
export interface GalleonPiece {
  id: string;
  name: string;
  footprint: { width: number; height: number };
}

/** The galleon's props, by their letter in a plan. */
export const GALLEON_PIECES: Readonly<Record<string, GalleonPiece>> = {
  C: { id: 'galleon-cannon', name: 'Rusted ship cannon', footprint: { width: 2, height: 1 } },
  b: { id: 'galleon-barrel', name: 'Barnacled barrel', footprint: { width: 1, height: 1 } },
  M: { id: 'galleon-mast', name: 'Broken mast stump', footprint: { width: 1, height: 1 } },
  W: { id: 'galleon-wheel', name: "Ship's wheel", footprint: { width: 1, height: 1 } },
  l: { id: 'galleon-lantern', name: 'Hanging ship lantern', footprint: { width: 1, height: 1 } },
  T: { id: 'galleon-chest', name: "Captain's chest", footprint: { width: 2, height: 1 } },
};

/** The galleon's hull and decks, in tiles: 24 by 10 inside, 26 by 12 with its hull all round. */
export const GALLEON_SIZE = { width: 26, height: 12 };

/** Where the galleon's hull starts, from the middle of the shore: on the beach between the palace and the lighthouse. */
const GALLEON_AT: [number, number] = [8, -40];

/** The galleon from its open top deck down to its hold, as plans the size of its hull. The bow points east, to the sea. */
export const GALLEON_FLOORS: CaveFloor[] = [
  {
    floor: 0, name: 'the Weather Deck',
    rows: [
      '##########################',
      '####...l.....b.....l######',
      '###.W................b####',
      '##.....vv....M.......CC.##',
      '#.b......................#',
      '#..CC.........l......CC..#',
      '#........................#',
      '#.b...................b..#',
      '##..CC......M........CC.##',
      '###..l...............b####',
      '####...l..........l.######',
      '############DD############',
    ],
    den: { creature: 'gull-raider', name: 'Gull Raider', asset: 'shore-gull-raider', count: 3 },
  },
  {
    floor: -1, name: 'the Gun Deck',
    rows: [
      '##########################',
      '####CC..CC..CC..CC..######',
      '###..................l####',
      '##.....SS..b.........b..##',
      '#........................#',
      '#..l.......bb........l...#',
      '#........................#',
      '#..b.....................#',
      '##...l............vv....##',
      '###..................b####',
      '####CC..CC..CC..CC..######',
      '##########################',
    ],
    den: { creature: 'drowned-deckhand', name: 'Drowned Deckhand', asset: 'shore-drowned-deckhand', count: 3 },
  },
  {
    floor: -2, name: 'the Orlop Deck',
    rows: [
      '##########################',
      '####..bb....bb.....b######',
      '###.......l..........b####',
      '##..b...................##',
      '#....bb........bb........#',
      '#..v.....................#',
      '#.........l..............#',
      '#....bb........bb........#',
      '##................SS....##',
      '###..b...........l....####',
      '####.....bb.....b...######',
      '##########################',
    ],
    den: { creature: 'hermit-crab', name: 'Hermit Crab', asset: 'shore-hermit-crab', count: 3 },
  },
  {
    floor: -3, name: 'the Flooded Hold',
    rows: [
      '##########################',
      '######......bb....########',
      '####..l..........TT..#####',
      '###.....................##',
      '##..b...................##',
      '##.H..........l.........##',
      '##......................##',
      '###...b........TT......###',
      '####........l.........####',
      '######..............######',
      '##########################',
      '##########################',
    ],
    den: { creature: 'drowned-deckhand', name: 'Drowned Deckhand', asset: 'shore-drowned-deckhand', count: 3 },
  },
];

/** The galleon as plans the kit builder lays. */
const GALLEON_PLANS: KitPlans = { name: 'The sunken galleon', size: GALLEON_SIZE, art: GALLEON_ART, props: GALLEON_PIECES, floors: GALLEON_FLOORS };

/** True when the galleon lies on the shore now: while its wish is on. */
export function galleonBuilt(): boolean {
  return modOn(GALLEON_MOD);
}

/** The name of a deck of the galleon, for a building's floor at `floor`. */
export function galleonFloorName(floor: number): string | undefined {
  return planFloorName(GALLEON_PLANS, floor);
}

/**
 * Lays the galleon on a shore whose middle is at (c, c), while its wish is
 * on: its hull, decks, props and crew, and a road from its gangway to the
 * middle. Returns whether it was laid.
 */
export function layGalleon(map: RegionMap, c: number): boolean {
  if (!galleonBuilt()) return false;
  const [w, h] = [GALLEON_SIZE.width - 2, GALLEON_SIZE.height - 2];
  const b = building(map, c + GALLEON_AT[0], c + GALLEON_AT[1], w, h, GALLEON_STYLE);
  map.buildings.push(b);
  road(map, b.door.x, b.door.y + 1, c, c);
  buildFromPlans(map, b, GALLEON_PLANS);
  return true;
}
