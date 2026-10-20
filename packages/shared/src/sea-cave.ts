import { addStairs, addStorey, blockOn, setOn } from './floors.ts';
import { SEA_CAVE_MOD, SEA_CAVE_PIECES } from './sea-cave-kit.ts';
import { modOn } from './mods.ts';
import { Tile, type Building, type RegionMap, type TileArt } from './world.ts';

// The Smugglers' Sea Cave built from its Art Kit (wish #75) instead of one
// painted outside picture: the ground floor where the sea comes in, three
// floors climbing the cliff above it and two below, each drawn tile by tile
// in the kit's sea cave rock, floor and plank walkway, with the kit's props
// standing about. Every floor is a plan of letters, the same size as the
// cave's walls and laid over them, so the cave reads like a map here.
// While the kit's wish is switched off the cave stands as it was before.

/** The kit pieces the cave's tiles are drawn in. */
export const SEA_CAVE_ART: TileArt = { floor: 'sea-cave-floor', wall: 'sea-cave-wall', path: 'sea-cave-planks' };

/**
 * What each letter of a plan lays. Props stand on their leftmost letter's
 * tile and run right across their footprint; stairs and ladders are drawn on
 * the floor they climb from, and as `v` on the floor they reach.
 */
const LEGEND: Record<string, 'rock' | 'floor' | 'planks' | 'door' | 'stairs' | 'ladder' | 'down'> = {
  '#': 'rock', '.': 'floor', '=': 'planks', D: 'door', S: 'stairs', H: 'ladder', v: 'down',
};

/** Props by their letter in a plan: ids in SEA_CAVE_PIECES. */
const PROPS: Record<string, string> = {
  B: 'sea-cave-boulder', i: 'sea-cave-stalagmite', g: 'sea-cave-glow-barnacles', o: 'sea-cave-tide-pool',
  c: 'sea-cave-crates', r: 'sea-cave-rope-nets', l: 'sea-cave-lantern',
};

/** Creatures that live on a floor of the cave. */
export interface CaveDen {
  creature: string;
  name: string;
  asset: string;
  count: number;
}

/** One floor of the cave: its number, its name for players and the plan of it, row by row. */
export interface CaveFloor {
  floor: number;
  name: string;
  rows: string[];
  den?: CaveDen;
}

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

/** True when the sea cave is built from its kit now: while the kit's wish is on. */
export function seaCaveBuilt(): boolean {
  return modOn(SEA_CAVE_MOD);
}

/** The name of a floor of the sea cave, for a building's floor at `floor`. */
export function seaCaveFloorName(floor: number): string | undefined {
  return SEA_CAVE_FLOORS.find((f) => f.floor === floor)?.name;
}

/**
 * Builds the sea cave over a building laid out the cave's size: its ground
 * floor's rock, walkway and props over the walls, the floors above and below
 * as storeys, and the stairs and ladders between them. The building is drawn
 * in the kit's tiles and shows no outside picture.
 */
export function buildSeaCave(map: RegionMap, b: Building): void {
  if (b.width !== SEA_CAVE_SIZE.width || b.height !== SEA_CAVE_SIZE.height) {
    throw new Error(`The sea cave is ${SEA_CAVE_SIZE.width} by ${SEA_CAVE_SIZE.height} tiles, not ${b.width} by ${b.height}.`);
  }
  b.art = SEA_CAVE_ART;
  // Every floor's tiles first, so the stairs find their landings on open floor.
  for (const plan of SEA_CAVE_FLOORS) {
    if (plan.floor !== 0) addStorey(map, b, plan.floor, b.style, SEA_CAVE_ART);
    eachLetter(plan, (ch, x, y) => {
      const what = LEGEND[ch] ?? (PROPS[ch] ? 'floor' : undefined);
      if (!what) throw new Error(`The sea cave's ${plan.name} has a "${ch}" at (${x}, ${y}), which is not in its legend.`);
      // The doorway is the building's own; everything else is laid as planned.
      if (what === 'door') return;
      const tile = what === 'rock' ? Tile.Wall : what === 'planks' ? Tile.Path : Tile.Floor;
      setOn(map, plan.floor, b.x + x, b.y + y, tile);
    });
  }
  for (const plan of SEA_CAVE_FLOORS) {
    placeProps(map, b, plan);
    const names = { lower: seaCaveFloorName(plan.floor), upper: seaCaveFloorName(plan.floor + 1) };
    eachLetter(plan, (ch, x, y, row) => {
      if (ch === 'H') addStairs(map, { kind: 'ladder', x: b.x + x, y: b.y + y, width: 1, height: 1, from: plan.floor, names });
      // A flight of stairs is two letters wide: laid from its left one.
      if (ch === 'S' && row[x - 1] !== 'S') addStairs(map, { kind: 'stairs', x: b.x + x, y: b.y + y, width: 2, height: 1, from: plan.floor, names });
    });
    if (plan.den) den(map, b, plan);
  }
}

/** Calls `fn` with each letter of a plan and where it is in the cave. */
function eachLetter(plan: CaveFloor, fn: (ch: string, x: number, y: number, row: string) => void): void {
  plan.rows.forEach((row, y) => [...row].forEach((ch, x) => fn(ch, x, y, row)));
}

/** Stands a floor's props, each on its leftmost letter and blocking its footprint. */
function placeProps(map: RegionMap, b: Building, plan: CaveFloor): void {
  eachLetter(plan, (ch, x, y, row) => {
    const id = PROPS[ch];
    if (!id) return;
    const piece = SEA_CAVE_PIECES.find((p) => p.id === id)!;
    const width = piece.footprint.width;
    // Only the first letter of each prop: a run of two crates is two props.
    let start = x;
    while (start > 0 && row[start - 1] === ch) start--;
    if ((x - start) % width !== 0) return;
    const at = { x: b.x + x + width / 2, y: b.y + y + 1 };
    map.landmarks.push({ asset: id, x: at.x, y: at.y, footprint: { ...piece.footprint }, ...(plan.floor ? { floor: plan.floor } : {}) });
    blockOn(map, plan.floor, at.x, at.y, width, piece.footprint.height);
  });
}

/** A floor's creatures, spread over its open floor. */
function den(map: RegionMap, b: Building, plan: CaveFloor): void {
  const spots: { x: number; y: number }[] = [];
  eachLetter(plan, (ch, x, y) => {
    if (ch === '.') spots.push({ x: b.x + x + 0.5, y: b.y + y + 0.5 });
  });
  const den = plan.den!;
  let placed = 0;
  for (let i = 0; placed < den.count && i < spots.length; i++) {
    const at = spots[(i * 37) % spots.length]!;
    // Not by the doorway or the stairs, and not on top of each other.
    if (map.creatures.some((c) => (c.floor ?? 0) === plan.floor && Math.hypot(c.x - at.x, c.y - at.y) < 3)) continue;
    if (map.stairways.some((s) => Math.hypot(s.x - at.x, s.y - at.y) < 3)) continue;
    if (plan.floor === 0 && Math.hypot(b.door.x - at.x, b.door.y - at.y) < 4) continue;
    map.creatures.push({ kind: den.creature, name: den.name, asset: den.asset, x: at.x, y: at.y, ...(plan.floor ? { floor: plan.floor } : {}) });
    placed++;
  }
}
