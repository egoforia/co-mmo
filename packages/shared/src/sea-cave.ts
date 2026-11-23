import { buildFromPlans, planFloorName, type CaveFloor, type KitPlans } from './kit-floors.ts';
import { SEA_CAVE_MOD, SEA_CAVE_PIECES } from './sea-cave-kit.ts';
import { modOn } from './mods.ts';
import type { Building, RegionMap, TileArt } from './world.ts';

// The Smugglers' Sea Cave built from its Art Kit (wish #75) instead of one
// painted outside picture: the ground floor where the sea comes in, three
// floors climbing the cliff above it and two below, each drawn tile by tile
// in the kit's sea cave rock, floor and plank walkway, with the kit's props
// standing about. Every floor is a plan of letters, the same size as the
// cave's walls and laid over them, so the cave reads like a map here.
// While the kit's wish is switched off the cave stands as it was before.

/** The kit pieces the cave's tiles are drawn in. */
export const SEA_CAVE_ART: TileArt = { floor: 'sea-cave-floor', wall: 'sea-cave-wall', path: 'sea-cave-planks', face: 'sea-cave-rock-face' };

/** Props by their letter in a plan: ids in SEA_CAVE_PIECES. */
const PROPS: Record<string, string> = {
  B: 'sea-cave-boulder', i: 'sea-cave-stalagmite', g: 'sea-cave-glow-barnacles', o: 'sea-cave-tide-pool',
  c: 'sea-cave-crates', r: 'sea-cave-rope-nets', l: 'sea-cave-lantern',
};

/** The cave's walls and floor, in tiles: 20 by 14 inside, 22 by 16 with its rock all round. */
export const SEA_CAVE_SIZE = { width: 22, height: 16 };

/** The cave from the top of the cliff to the bottom of the sea, as plans the size of its walls. */
export const SEA_CAVE_FLOORS: CaveFloor[] = [
  {
    floor: 3, name: 'the Lookout',
    rows: [
      '######################',
      '##########...#########',
      '########...l...r######',
      '#######.....v..=..####',
      '######....========####',
      '#######....cc..=..####',
      '########.....l....####',
      '##########.....#######',
      '######################',
      '######################',
      '######################',
      '######################',
      '######################',
      '######################',
      '######################',
      '######################',
    ],
  },
  {
    floor: 2, name: 'the Gallery',
    rows: [
      '######################',
      '######################',
      '#########...l...######',
      '########....H....#####',
      '#######..........#####',
      '######..r.....cc..####',
      '#####.....=======..###',
      '####...=====.......###',
      '###...=.....i....#####',
      '##...=....############',
      '##...=...#############',
      '##.vv=..##############',
      '##.....###############',
      '######################',
      '######################',
      '######################',
    ],
  },
  {
    floor: 1, name: "the Smugglers' Loft",
    rows: [
      '######################',
      '###########......#####',
      '#########..r.....l..##',
      '########......=vv...##',
      '#######.......=......#',
      '######..cc....=..cc..#',
      '#####.........=.....##',
      '####..===========...##',
      '###...=........#######',
      '##.r..=...l...########',
      '##....=......#########',
      '##.SS.=.....##########',
      '##.......i.###########',
      '###.....##############',
      '######################',
      '######################',
    ],
  },
  {
    floor: 0, name: 'the Cave Mouth',
    rows: [
      '######################',
      '#####......###########',
      '###....i.....l....####',
      '##..BB.........SS...##',
      '##.........=........##',
      '#...g......=.....cc..#',
      '#.........==.........#',
      '#.oo......=......r...#',
      '#.........==.........#',
      '##.........=......i..#',
      '###...vv...=.........#',
      '##........l=l.......##',
      '##..BB.....=.....oo..#',
      '###.......==........##',
      '####..cc..==......####',
      '##########DD##########',
    ],
    den: { creature: 'drowned-deckhand', name: 'Drowned Deckhand', asset: 'shore-drowned-deckhand', count: 4 },
  },
  {
    floor: -1, name: 'the Tide Grotto',
    rows: [
      '######################',
      '####....######....####',
      '###..g...####..i...###',
      '##..oo....##.......###',
      '##.........i.....v..##',
      '#...i..............g.#',
      '#..........oo........#',
      '#.g...##......BB.....#',
      '##...####...........##',
      '##....##....g...oo...#',
      '###...SS...........###',
      '###.........i......###',
      '####..oo.....g....####',
      '#####............#####',
      '#######......#########',
      '######################',
    ],
    den: { creature: 'hermit-crab', name: 'Hermit Crab', asset: 'shore-hermit-crab', count: 3 },
  },
  {
    floor: -2, name: 'the Drowned Hoard',
    rows: [
      '######################',
      '######################',
      '#######.....##########',
      '#####..cc......#..####',
      '####.............H.###',
      '###..r..=====.......##',
      '###..l..=...=..cc...##',
      '####....=...=.......##',
      '#####...=====..i...###',
      '######.....cc.....####',
      '########.........#####',
      '######################',
      '######################',
      '######################',
      '######################',
      '######################',
    ],
    den: { creature: 'drowned-deckhand', name: 'Drowned Deckhand', asset: 'shore-drowned-deckhand', count: 2 },
  },
];

/** The cave as plans the kit builder lays (kit-floors.ts). */
const SEA_CAVE_PLANS: KitPlans = {
  name: 'The sea cave',
  size: SEA_CAVE_SIZE,
  art: SEA_CAVE_ART,
  props: Object.fromEntries(Object.entries(PROPS).map(([ch, id]) => [ch, SEA_CAVE_PIECES.find((p) => p.id === id)!])),
  floors: SEA_CAVE_FLOORS,
};

/** True when the sea cave is built from its kit now: while the kit's wish is on. */
export function seaCaveBuilt(): boolean {
  return modOn(SEA_CAVE_MOD);
}

/** The name of a floor of the sea cave, for a building's floor at `floor`. */
export function seaCaveFloorName(floor: number): string | undefined {
  return planFloorName(SEA_CAVE_PLANS, floor);
}

/**
 * Builds the sea cave over a building laid out the cave's size: its ground
 * floor's rock, walkway and props over the walls, the floors above and below
 * as storeys, and the stairs and ladders between them. The building is drawn
 * in the kit's tiles and shows no outside picture.
 */
export function buildSeaCave(map: RegionMap, b: Building): void {
  buildFromPlans(map, b, SEA_CAVE_PLANS);
}
