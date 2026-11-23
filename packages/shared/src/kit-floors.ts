import { addStairs, addStorey, blockOn, setOn } from './floors.ts';
import { Tile, type Building, type RegionMap, type TileArt } from './world.ts';

// A building put together from a kit's pieces, floor by floor, from plans of
// letters the size of its walls (the sea cave, the sunken galleon). Each
// floor is drawn tile by tile in the kit's floor, wall and walkway, its props
// stand about, stairs and ladders join it to the floors next to it, and its
// creatures live on it. The plans read like a map of the place.

/**
 * What each letter of a plan lays. Props stand on their leftmost letter's
 * tile and run right across their footprint; stairs and ladders are drawn on
 * the floor they climb from, and as `v` on the floor they reach.
 */
const LEGEND: Record<string, 'rock' | 'floor' | 'planks' | 'door' | 'stairs' | 'ladder' | 'down'> = {
  '#': 'rock', '.': 'floor', '=': 'planks', D: 'door', S: 'stairs', H: 'ladder', v: 'down',
};

/** Creatures that live on a floor of a kit building. */
export interface CaveDen {
  creature: string;
  name: string;
  asset: string;
  count: number;
}

/** One floor of a kit building: its number, its name for players and the plan of it, row by row. */
export interface CaveFloor {
  floor: number;
  name: string;
  rows: string[];
  den?: CaveDen;
}

/** A building built from plans: its name, size in tiles (walls included), tiles, props by letter and floors. */
export interface KitPlans {
  name: string;
  size: { width: number; height: number };
  art: TileArt;
  /** Each prop's picture id and the tiles it stands on, by its letter in a plan. */
  props: Record<string, { id: string; footprint: { width: number; height: number } }>;
  floors: CaveFloor[];
}

/** The name of a floor of a kit building, for a building's floor at `floor`. */
export function planFloorName(plans: KitPlans, floor: number): string | undefined {
  return plans.floors.find((f) => f.floor === floor)?.name;
}

/**
 * Builds a kit building over a building laid out its plans' size: its ground
 * floor's walls, walkway and props over the walls, the floors above and
 * below as storeys, and the stairs and ladders between them. The building is
 * drawn in the kit's tiles and shows no outside picture.
 */
export function buildFromPlans(map: RegionMap, b: Building, plans: KitPlans): void {
  const { size, art } = plans;
  if (b.width !== size.width || b.height !== size.height) {
    throw new Error(`${plans.name} is ${size.width} by ${size.height} tiles, not ${b.width} by ${b.height}.`);
  }
  b.art = art;
  // Every floor's tiles first, so the stairs find their landings on open floor.
  for (const plan of plans.floors) {
    if (plan.floor !== 0) addStorey(map, b, plan.floor, b.style, art);
    eachLetter(plan, (ch, x, y) => {
      const what = LEGEND[ch] ?? (plans.props[ch] ? 'floor' : undefined);
      if (!what) throw new Error(`${plans.name}'s ${plan.name} has a "${ch}" at (${x}, ${y}), which is not in its legend.`);
      // The doorway is the building's own; everything else is laid as planned.
      if (what === 'door') return;
      const tile = what === 'rock' ? Tile.Wall : what === 'planks' ? Tile.Path : Tile.Floor;
      setOn(map, plan.floor, b.x + x, b.y + y, tile);
    });
  }
  for (const plan of plans.floors) {
    placeProps(map, b, plans, plan);
    const names = { lower: planFloorName(plans, plan.floor), upper: planFloorName(plans, plan.floor + 1) };
    eachLetter(plan, (ch, x, y, row) => {
      if (ch === 'H') addStairs(map, { kind: 'ladder', x: b.x + x, y: b.y + y, width: 1, height: 1, from: plan.floor, names });
      // A flight of stairs is two letters wide: laid from its left one.
      if (ch === 'S' && row[x - 1] !== 'S') addStairs(map, { kind: 'stairs', x: b.x + x, y: b.y + y, width: 2, height: 1, from: plan.floor, names });
    });
    if (plan.den) den(map, b, plan);
  }
}

/** Calls `fn` with each letter of a plan and where it is in the building. */
function eachLetter(plan: CaveFloor, fn: (ch: string, x: number, y: number, row: string) => void): void {
  plan.rows.forEach((row, y) => [...row].forEach((ch, x) => fn(ch, x, y, row)));
}

/** Stands a floor's props, each on its leftmost letter and blocking its footprint. */
function placeProps(map: RegionMap, b: Building, plans: KitPlans, plan: CaveFloor): void {
  eachLetter(plan, (ch, x, y, row) => {
    const piece = plans.props[ch];
    if (!piece) return;
    const width = piece.footprint.width;
    // Only the first letter of each prop: a run of two crates is two props.
    let start = x;
    while (start > 0 && row[start - 1] === ch) start--;
    if ((x - start) % width !== 0) return;
    const at = { x: b.x + x + width / 2, y: b.y + y + 1 };
    map.landmarks.push({ asset: piece.id, x: at.x, y: at.y, footprint: { ...piece.footprint }, ...(plan.floor ? { floor: plan.floor } : {}) });
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
