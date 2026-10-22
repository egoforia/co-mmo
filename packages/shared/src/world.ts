import type { BiomeId } from './biomes.ts';
import { rand2, valueNoise } from './random.ts';
import { furnitureArt } from './buildings.ts';
import { modsOff } from './mods.ts';
import { layPlaces } from './places.ts';
import { applyEdits, type WorldEdit } from './world-edits.ts';
import type { Stairway, Storey } from './floors.ts';
import { addStairs, addStorey, setOn } from './floors.ts';

export enum Tile {
  /** The biome's own ground (meadow, moss, sand, dunes). */
  Ground = 0,
  /** Old pilgrim road of Sanctum flagstones, linking regions. */
  Path = 1,
  Water = 2,
  Tree = 3,
  Rock = 4,
  /** Under a landmark: drawn as ground, never walkable. */
  Blocked = 5,
  /** Wooden floor inside a building, part of the region so players walk straight in. */
  Floor = 6,
  /** A building's timber wall. */
  Wall = 7,
  /** An open doorway in a building's wall: walk through it to go inside. */
  Door = 8,
  /** Wooden planks where a road crosses water. */
  Bridge = 9,
}

const BLOCKING = new Set<Tile>([Tile.Water, Tile.Tree, Tile.Rock, Tile.Blocked, Tile.Wall]);

export function isBlocking(tile: Tile): boolean {
  return BLOCKING.has(tile);
}

export type Side = 'north' | 'south' | 'east' | 'west';

export const OPPOSITE: Record<Side, Side> = { north: 'south', south: 'north', east: 'west', west: 'east' };

export interface RegionDef {
  id: string;
  name: string;
  biome: BiomeId;
  seed: number;
  /** Which region lies beyond each edge; edges without one are closed. */
  exits: Partial<Record<Side, string>>;
  /** Its square on the world grid: the Sanctum is (0, 0), east is +x, south is +y. */
  at: { x: number; y: number };
  /** A region wished into being: how wild it is and what lives there. */
  wild?: WildLand;
  /** Changes the Owner and Stewards made in the world editor, laid over the land in order (world-edits.ts). */
  edits?: WorldEdit[];
}

/**
 * How a wished region is laid out (design doc, World structure): its danger,
 * how thick its trees, rocks and water are, its creatures and its one
 * person, and who wished it.
 */
export interface WildLand {
  /** 1 (gentle) to 6 (deadly): the level of the creatures wished for it. */
  danger: number;
  /** 0 (none) to 3 (thick). */
  trees: number;
  rocks: number;
  water: number;
  creatures: { kind: string; name: string; asset: string; count: number }[];
  npc?: { id: string; name: string; asset: string };
  /** The credit line: who wished it. */
  wisher: string;
}

/** The launch world: the Sanctum in the middle, a biome on three sides. */
export const WORLD_REGIONS: RegionDef[] = [
  { id: 'sanctum', name: 'the Sanctum', biome: 'sanctum', seed: 1337, at: { x: 0, y: 0 }, exits: { west: 'woods', east: 'shore', south: 'desert' } },
  { id: 'woods', name: 'Whispering Woods', biome: 'whispering-woods', seed: 2001, at: { x: -1, y: 0 }, exits: { east: 'sanctum' } },
  { id: 'shore', name: 'Sunlit Shore', biome: 'sunlit-shore', seed: 3001, at: { x: 1, y: 0 }, exits: { west: 'sanctum' } },
  { id: 'desert', name: 'Mirage Desert', biome: 'mirage-desert', seed: 4001, at: { x: 0, y: 1 }, exits: { north: 'sanctum' } },
];

/** Regions players wished into being, by id (filled in by applyContent). */
export const WISHED_REGIONS = new Map<string, RegionDef>();

/** A launch region or a wished one, by id. */
export function regionDef(id: string): RegionDef | undefined {
  return WORLD_REGIONS.find((r) => r.id === id) ?? WISHED_REGIONS.get(id);
}

export const SIDES: Side[] = ['north', 'east', 'south', 'west'];

/** One step across the world grid toward a side. */
export const SIDE_STEP: Record<Side, { x: number; y: number }> = { north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 } };

/** The grid square beyond a region's edge. */
export function cellBeyond(def: RegionDef, side: Side): { x: number; y: number } {
  return { x: def.at.x + SIDE_STEP[side].x, y: def.at.y + SIDE_STEP[side].y };
}

/**
 * Exits for every region from where it sits: neighbours on the grid are
 * joined by a road, so a region wished beside two others reaches both.
 */
export function linkRegions(defs: RegionDef[]): Map<string, Partial<Record<Side, string>>> {
  const byCell = new Map(defs.map((d) => [`${d.at.x},${d.at.y}`, d.id]));
  const links = new Map<string, Partial<Record<Side, string>>>();
  for (const def of defs) {
    const exits: Partial<Record<Side, string>> = {};
    for (const side of SIDES) {
      const cell = cellBeyond(def, side);
      const other = byCell.get(`${cell.x},${cell.y}`);
      if (other) exits[side] = other;
    }
    links.set(def.id, exits);
  }
  return links;
}

/** The edges of a region with no region beyond them yet: where the world can grow. */
export function openSides(defs: RegionDef[], def: RegionDef): Side[] {
  const taken = new Set(defs.map((d) => `${d.at.x},${d.at.y}`));
  return SIDES.filter((side) => {
    const cell = cellBeyond(def, side);
    return !taken.has(`${cell.x},${cell.y}`);
  });
}

/** The open edge nearest a spot in the region, or undefined when every edge has a neighbour. */
export function nearestOpenSide(defs: RegionDef[], def: RegionDef, x: number, y: number, size = REGION_SIZE): Side | undefined {
  const distance: Record<Side, number> = { north: y, south: size - y, west: x, east: size - x };
  return openSides(defs, def).sort((a, b) => distance[a] - distance[b])[0];
}

/** A large painted set piece; its footprint tiles are blocked. */
export interface Landmark {
  asset: string;
  /** Bottom centre of the art, in tiles. */
  x: number;
  y: number;
  footprint: { width: number; height: number };
  /** The floor it stands on (floors.ts), when not the ground. */
  floor?: number;
}

/** Where an NPC starts; on the server, where they stand now as they stroll. */
export interface NpcPlacement {
  id: string;
  name: string;
  asset: string;
  x: number;
  y: number;
  /** The floor they live on (floors.ts), when not the ground. */
  floor?: number;
}

export interface CreatureSpawn {
  kind: string;
  name: string;
  asset: string;
  x: number;
  y: number;
  /** The floor it lives on (floors.ts), when not the ground. */
  floor?: number;
}

/**
 * A walled building. From afar players see its exterior art; close by, the
 * art fades to show the floor and furniture inside.
 */
export interface Building {
  /** Top-left corner of the walls, in tiles; the size includes the walls. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Left tile of the two-tile doorway, in the south wall. */
  door: { x: number; y: number };
  /** Its look, outside and in: a key of BUILDING_STYLES. */
  style: string;
  /**
   * How wide the outside art is drawn, in tiles. The art's door is painted at
   * the middle of its bottom edge, so it is drawn centred on the doorway.
   */
  exteriorWidth: number;
  /**
   * Picture ids its floor, walls and walkways are drawn in instead of its
   * style's tiles: a building put together from a kit's pieces (the sea
   * cave), which shows no outside picture, its rock seen from above.
   */
  art?: TileArt;
}

/** Kit pictures drawn for a building's or a storey's tiles: its floor, its walls, and planks or paths across it. */
export interface TileArt {
  floor?: string;
  wall?: string;
  path?: string;
  /** The upright face of its walls, which the isometric camera shows on their edges facing it. */
  face?: string;
}

/** Where a building's outside art is drawn: left edge and width, in tiles, bottom on the doorway's outer edge. */
export function exteriorSpan(b: Building): { left: number; width: number; bottom: number } {
  return { left: b.door.x + 1 - b.exteriorWidth / 2, width: b.exteriorWidth, bottom: b.door.y + 1 };
}

/** How close, in tiles, a player must come before a building shows its inside. */
export const REVEAL_REACH = 3;

/** True when (x, y) is close enough to a building to see inside it. */
export function nearBuilding(b: Building, x: number, y: number, reach = REVEAL_REACH): boolean {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.height));
  return Math.hypot(dx, dy) <= reach;
}

export interface RegionMap {
  def: RegionDef;
  width: number;
  height: number;
  seed: number;
  tiles: Uint8Array;
  /** Where new and respawning players appear. */
  spawn: { x: number; y: number };
  /** Where a player arriving through each open edge appears. */
  entries: Partial<Record<Side, { x: number; y: number }>>;
  landmarks: Landmark[];
  buildings: Building[];
  /** Floors above and below the ground, each over its own rectangle (floors.ts). */
  storeys: Storey[];
  /** The stairs and ladders between floors. */
  stairways: Stairway[];
  npcs: NpcPlacement[];
  creatures: CreatureSpawn[];
}

/**
 * Tiles along each side of a region: 256, sixteen times the first lands'
 * area, so there is room to explore (egoforia, 2026-10-17).
 */
export const REGION_SIZE = 256;

/** Lands laid out lately, by definition: a big land takes a while to lay out, and the world, its cells and every browser ask for the same few again. */
const laidOut = new Map<string, RegionMap>();
const LAID_OUT_KEPT = 24;

/**
 * Builds a region from its definition. Deterministic, so server and client
 * agree. Each call gets its own copy, free to change.
 */
export function generateRegion(def: RegionDef, size = REGION_SIZE): RegionMap {
  // Edits from a wish (a sea cave piece) are laid only while it is on.
  const key = `${size}:${modsOff()}:${JSON.stringify(def)}`;
  let map = laidOut.get(key);
  if (!map) {
    map = layOut(structuredClone(def), size);
    laidOut.set(key, map);
    if (laidOut.size > LAID_OUT_KEPT) laidOut.delete(laidOut.keys().next().value!);
  }
  const { def: _, ...rest } = map;
  return { ...structuredClone(rest), def };
}

function layOut(def: RegionDef, size: number): RegionMap {
  const map: RegionMap = {
    def,
    width: size,
    height: size,
    seed: def.seed,
    tiles: new Uint8Array(size * size),
    spawn: { x: size / 2, y: size / 2 },
    entries: {},
    landmarks: [],
    buildings: [],
    storeys: [],
    stairways: [],
    npcs: [],
    creatures: [],
  };
  const c = Math.floor(size / 2);
  const layout = def.wild ? wildLayout(def.wild) : BIOME_LAYOUTS[def.biome] ?? sanctumLayout;
  layout(map, c);
  // The launch lands' caves, palaces, castles and the rest, each joined to the middle by a road.
  if (!def.wild) layPlaces(map, c);

  // Roads from every open edge to the middle, then entry points just inside.
  for (const side of Object.keys(def.exits) as Side[]) {
    const edge = edgePoint(side, size, c);
    road(map, edge.x, edge.y, c, c);
    const inward = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }[side];
    map.entries[side] = { x: edge.x + 1 + inward[0]! * 1.5, y: edge.y + 1 + inward[1]! * 1.5 };
  }
  // NPCs stroll around their spot, so only landmarks block tiles. Those on other floors blocked theirs when placed.
  for (const l of map.landmarks) if (!l.floor) block(map, l.x, l.y, l.footprint.width, l.footprint.height);
  openUp(map);
  // After the trails are cut, so a tree an editor planted stays where it was put.
  if (def.edits?.length) applyEdits(map, def.edits);
  settle(map);
  return map;
}

/** Open ground cut off from the middle by trees or rocks is joined to it by a trail when it is at least this many tiles. */
const GLADE_TILES = 12;

/**
 * Cuts trails through trees and rocks so every glade worth the walk can be
 * reached from the middle: a big land is for exploring, and dense woods
 * would otherwise shut most of it away. Each glade gets the trail that
 * fells the fewest trees. Water, walls and landmarks are never cut.
 */
function openUp(map: RegionMap): void {
  const { width, height, tiles } = map;
  const n = width * height;
  const cuttable = (t: Tile) => t === Tile.Tree || t === Tile.Rock;
  // Trees felled to reach each tile from the middle, and the step it came from (0-1 search).
  const cost = new Int32Array(n).fill(-1);
  const from = new Int32Array(n).fill(-1);
  const start = Math.floor(map.spawn.y) * width + Math.floor(map.spawn.x);
  const deque = new Int32Array(n * 2);
  let head = n;
  let tail = n;
  const best = new Int32Array(n).fill(0x7fffffff);
  best[start] = 0;
  deque[tail++] = start;
  while (head < tail) {
    const i = deque[head++]!;
    if (cost[i]! >= 0) continue;
    cost[i] = best[i]!;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      const t = tiles[j] as Tile;
      if (cost[j]! >= 0 || (isBlocking(t) && !cuttable(t))) continue;
      const step = cuttable(t) ? 1 : 0;
      if (best[i]! + step >= best[j]!) continue;
      best[j] = best[i]! + step;
      from[j] = i;
      if (step) deque[tail++] = j;
      else deque[--head] = j;
    }
  }
  // Each open glade not yet reached: fell the trees along its cheapest trail.
  const done = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (done[i] || isBlocking(tiles[i] as Tile) || cost[i]! <= 0) continue;
    const glade = gladeAt(map, i, done);
    if (glade.length < GLADE_TILES) continue;
    let cheapest = glade[0]!;
    for (const g of glade) if (cost[g]! >= 0 && (cost[cheapest]! < 0 || cost[g]! < cost[cheapest]!)) cheapest = g;
    for (let j = cheapest; j >= 0 && cost[j]! > 0; j = from[j]!) if (cuttable(tiles[j] as Tile)) tiles[j] = Tile.Ground;
  }
}

/** The open tiles joined to tile i without crossing anything blocking, marked done. */
function gladeAt(map: RegionMap, i: number, done: Uint8Array): number[] {
  const out: number[] = [];
  const stack = [i];
  done[i] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    out.push(k);
    const x = k % map.width;
    const y = (k - x) / map.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const j = ny * map.width + nx;
      if (done[j] || isBlocking(map.tiles[j] as Tile)) continue;
      done[j] = 1;
      stack.push(j);
    }
  }
  return out;
}

/**
 * Moves each creature shut away where no one could reach it (in walls built
 * after it was placed, or a pocket among the trees) to open ground that can
 * be walked to, and lets go of any with nowhere to go.
 */
function settle(map: RegionMap): void {
  const reached = new Uint8Array(map.width * map.height);
  const start = Math.floor(map.spawn.y) * map.width + Math.floor(map.spawn.x);
  for (const k of gladeAt(map, start, reached)) reached[k] = 1;
  const free = (x: number, y: number) => reached[Math.floor(y) * map.width + Math.floor(x)] === 1 && map.tiles[Math.floor(y) * map.width + Math.floor(x)] === Tile.Ground;
  map.creatures = map.creatures.flatMap((c, n) => {
    if (reached[Math.floor(c.y) * map.width + Math.floor(c.x)] && !isBlocking(tileAt(map, c.x, c.y))) return [c];
    for (let i = 0; i < 400; i++) {
      // Somewhere near where it was meant to be, farther afield the longer it looks.
      const r = 4 + i / 4;
      const x = Math.floor(c.x + (rand2(i, n, map.seed + 11) - 0.5) * 2 * r);
      const y = Math.floor(c.y + (rand2(i, n, map.seed + 13) - 0.5) * 2 * r);
      if (x >= 1 && y >= 1 && x < map.width - 1 && y < map.height - 1 && free(x, y)) return [{ ...c, x: x + 0.5, y: y + 0.5 }];
    }
    return [];
  });
}

type Layout = (map: RegionMap, c: number) => void;

const sanctumLayout: Layout = (map, c) => {
  scatter(map, (x, y) => {
    const water = valueNoise(x, y, map.seed, 9);
    if (water < 0.22) return Tile.Water;
    if (valueNoise(x, y, map.seed + 2, 7) > 0.66 && rand2(x, y, map.seed + 3) < 0.6) return Tile.Tree;
    return Tile.Ground;
  });
  disc(map, c, c, 7, Tile.Path);
  map.landmarks.push({ asset: 'sanctum-shrine', x: c + 1, y: c + 1, footprint: { width: 2, height: 1 } });
  // The Sanctum Arcanum stands under the weeping trees north-east of the
  // clearing, between the two ponds, with a lane from its door to the clearing.
  const left = c + 8;
  const top = c - 16;
  const shop = building(map, left, top, ARCANUM_SIZE.width, ARCANUM_SIZE.height, 'sanctum-arcanum');
  map.buildings.push(shop);
  disc(map, left - 5, top + 4, 3, Tile.Water);
  disc(map, left + ARCANUM_SIZE.width + 7, top + 3, 3, Tile.Water);
  const lane = shop.y + shop.height + 1;
  road(map, c, lane, shop.door.x, shop.door.y + 1);
  furnishArcanum(map, left + 1, top + 1);

  // The Holy City District of the Sanctum
  // Clear noise water and trees from the city quarters so buildings and streets are open.
  const clearArea = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = map.tiles[y * map.width + x];
      if (t === Tile.Water || t === Tile.Tree) set(map, x, y, Tile.Ground);
    }
  };
  // Cathedral, avenue and graveyard:
  clearArea(c - 28, c - 34, c + 2, c - 18);
  // Scriptorium and lane:
  clearArea(c + 12, c - 34, c + 28, c - 19);
  // Inn and street:
  clearArea(c - 28, c - 18, c - 12, c - 3);

  // The High Cathedral of the Bell, north of the Grand Plaza.
  const cathLeft = c - 8;
  const cathTop = c - 32;
  const cathedral = building(map, cathLeft, cathTop, CATHEDRAL_SIZE.width, CATHEDRAL_SIZE.height, 'sanctum-cathedral');
  map.buildings.push(cathedral);
  furnishCathedral(map, cathLeft + 1, cathTop + 1);

  // Cathedral Floor 1: The Choir Loft.
  addStorey(map, cathedral, 1, cathedral.style);
  addStairs(map, {
    kind: 'stairs',
    x: cathLeft + 2,
    y: cathTop + 5,
    width: 2,
    height: 1,
    from: 0,
    names: { lower: 'Cathedral Nave', upper: 'Choir Loft' },
  });

  // Cathedral Floor 2: The High Belfry open rooftop and bell tower.
  addStorey(map, { x: cathLeft + 3, y: cathTop + 2, width: 10, height: 8 }, 2, cathedral.style, undefined, true);
  addStairs(map, {
    kind: 'ladder',
    x: cathLeft + 11,
    y: cathTop + 5,
    width: 1,
    height: 1,
    from: 1,
    names: { lower: 'Choir Loft', upper: 'High Belfry' },
  });

  // The Clerics' Scriptorium, east of the Cathedral.
  const scripLeft = c + 14;
  const scripTop = c - 32;
  const scriptorium = building(map, scripLeft, scripTop, SCRIPTORIUM_SIZE.width, SCRIPTORIUM_SIZE.height, 'sanctum-scriptorium');
  map.buildings.push(scriptorium);
  furnishScriptorium(map, scripLeft + 1, scripTop + 1);

  // Scriptorium Floor 1: Upper Archive & West Observation Terrace overlooking Cathedral Avenue.
  addStorey(map, { x: scripLeft - 2, y: scripTop, width: scriptorium.width + 2, height: scriptorium.height }, 1, scriptorium.style, undefined, true);
  setOn(map, 1, scripLeft, scripTop + 5, Tile.Door);
  setOn(map, 1, scripLeft - 1, scripTop + 5, Tile.Floor);
  addStairs(map, {
    kind: 'stairs',
    x: scripLeft + 6,
    y: scripTop + 5,
    width: 2,
    height: 1,
    from: 0,
    names: { lower: 'Scriptorium Hall', upper: 'Upper Archive' },
  });

  // The Pilgrim's Haven Inn, west of the Grand Plaza.
  const innLeft = c - 26;
  const innTop = c - 16;
  const inn = building(map, innLeft, innTop, INN_SIZE.width, INN_SIZE.height, 'sanctum-inn');
  map.buildings.push(inn);
  furnishInn(map, innLeft + 1, innTop + 1);

  // Pilgrim's Haven Floor 1: Guest Quarters with overhanging balcony facing south onto the street.
  addStorey(map, { x: innLeft, y: innTop, width: inn.width, height: inn.height + 2 }, 1, inn.style);
  setOn(map, 1, inn.door.x, innTop + 9, Tile.Door);
  setOn(map, 1, inn.door.x, innTop + 10, Tile.Floor);
  addStairs(map, {
    kind: 'stairs',
    x: innLeft + 7,
    y: innTop + 7,
    width: 2,
    height: 1,
    from: 0,
    names: { lower: 'Tavern Common Room', upper: 'Guest Rooms' },
  });

  // The Cathedral Avenue connecting the Grand Plaza to the Cathedral bronze doors.
  road(map, c - 1, c - 18, c - 1, c - 7);
  road(map, c, c - 18, c, c - 7);
  road(map, c + 1, c - 18, c + 1, c - 7);

  // Connecting streets to the Scriptorium, Inn, and Graveyard.
  road(map, c + 1, c - 20, scriptorium.door.x, scriptorium.door.y + 1);
  road(map, inn.door.x, inn.door.y + 1, c - 7, inn.door.y + 1);
  road(map, c - 18, c - 26, c - 1, c - 26);

  // The Cathedral Graveyard: ancient crypt stones and weeping ground.
  map.landmarks.push({ asset: 'sanctum-standing-stones', x: c - 20, y: c - 29, footprint: { width: 4, height: 2 } });

  // --- Subterranean Catacombs & Chained Demon Vault (Floors -1 & -2) ---
  // Floor -1: The Catacombs of the Restless spanning beneath the Graveyard and Cathedral.
  addStorey(map, { x: c - 22, y: c - 34, width: 34, height: 16 }, -1, 'sanctum-cathedral');

  // Entrance 1: Cathedral Crypt Gate down to Catacombs.
  addStairs(map, {
    kind: 'ladder',
    x: cathLeft + 14,
    y: cathTop + 4,
    width: 1,
    height: 1,
    from: -1,
    names: { lower: 'Catacombs of the Restless', upper: 'Cathedral Crypt Gate' },
    climbs: 'south',
  });

  // Entrance 2: Graveyard Mausoleum down to Catacombs.
  addStairs(map, {
    kind: 'ladder',
    x: c - 16,
    y: c - 30,
    width: 1,
    height: 1,
    from: -1,
    names: { lower: 'Catacombs of the Restless', upper: 'Graveyard Mausoleum' },
    climbs: 'south',
  });

  // Floor -2: The Chained Demon's Vault.
  addStorey(map, { x: cathLeft + 2, y: cathTop + 4, width: 12, height: 8 }, -2, 'sanctum-cathedral');

  // Stairs between Floor -1 (Catacombs) and Floor -2 (Demon Vault).
  addStairs(map, {
    kind: 'stairs',
    x: cathLeft + 7,
    y: cathTop + 7,
    width: 2,
    height: 1,
    from: -2,
    names: { lower: "The Demon's Vault", upper: 'Catacombs of the Restless' },
    climbs: 'north',
  });

  // Skeletons roaming the Catacombs (Floor -1).
  map.creatures.push({ kind: 'crypt-skeleton', name: 'Crypt Skeleton', asset: 'desert-mummy-guard', x: c - 12.5, y: c - 28.5, floor: -1 });
  map.creatures.push({ kind: 'crypt-skeleton', name: 'Crypt Skeleton', asset: 'desert-mummy-guard', x: c - 4.5, y: c - 25.5, floor: -1 });
  map.creatures.push({ kind: 'crypt-skeleton', name: 'Crypt Skeleton', asset: 'desert-mummy-guard', x: c + 3.5, y: c - 28.5, floor: -1 });

  // The Imprisoned Demon in the deep Vault (Floor -2).
  map.creatures.push({ kind: 'chained-demon', name: 'Chained Demon', asset: 'desert-sand-wyrm', x: cathLeft + 8.0, y: cathTop + 9.0, floor: -2 });

  // The City's Clerics and Citizens. Sister Amala is first so tests and quest guides find her at npcs[0].
  map.npcs.push({ id: 'sister-amala', name: 'Sister Amala', asset: 'sanctum-pilgrim', x: c - 2.5, y: c + 4.5 });
  map.npcs.push({ id: 'high-priest-cassian', name: 'High Priest Cassian', asset: 'sanctum-pilgrim', x: c, y: c - 27.5 });
  map.npcs.push({ id: 'brother-paul', name: 'Brother Paul', asset: 'sanctum-pilgrim', x: c + 19.5, y: c - 27.5 });
  map.npcs.push({ id: 'mother-elena', name: 'Mother Elena', asset: 'sanctum-pilgrim', x: c - 18.5, y: c - 14.5 });
  map.npcs.push({ id: 'gravedigger-joshua', name: 'Gravedigger Joshua', asset: 'sanctum-pilgrim', x: c - 18, y: c - 26.5 });
  map.npcs.push({ id: 'bramble-ursine-npc', name: 'Bramble Ursine', asset: 'bramble-ursine', x: c - 3.5, y: c - 2.0 });
  map.npcs.push({ id: 'tide-lutran-npc', name: 'Tide Lutran', asset: 'tide-lutran', x: c + 4.0, y: c - 1.5 });
  map.npcs.push({ id: 'zephyr-falcon-npc', name: 'Zephyr Falcon', asset: 'zephyr-falcon', x: c - 4.5, y: c + 1.5 });
  map.npcs.push({ id: 'dune-scorpid-npc', name: 'Dune Scorpid', asset: 'dune-scorpid', x: c + 3.5, y: c + 3.5 });
  map.npcs.push({ id: 'sylvan-cervid-npc', name: 'Sylvan Cervid', asset: 'sylvan-cervid', x: c - 1.0, y: c - 4.0 });
  map.spawn = { x: c + 1, y: c + 4 };
};

/** The Sanctum Arcanum's floor, in tiles, inside the walls. */
export const ARCANUM_SIZE = { width: 10, height: 8 };
export const CATHEDRAL_SIZE = { width: 16, height: 12 };
export const SCRIPTORIUM_SIZE = { width: 12, height: 10 };
export const INN_SIZE = { width: 12, height: 10 };

/** The High Cathedral's furniture: altar, pews, braziers, lectern, and the locked crypt gate. */
function furnishCathedral(map: RegionMap, fx: number, fy: number): void {
  const put = placer(map, 'sanctum-cathedral', fx, fy);
  put('high-altar', 8, 2, 4, 1);
  put('brazier', 3, 2, 1, 1);
  put('brazier', 13, 2, 1, 1);
  put('crypt-gate', 14.5, 3, 2, 1);
  put('lectern', 10, 4, 1.5, 1);
  put('gold-pew', 3.5, 6, 3, 1);
  put('gold-pew', 3.5, 9, 3, 1);
  put('gold-pew', 12.5, 6, 3, 1);
  put('gold-pew', 12.5, 9, 3, 1);
}

/** The Scriptorium's furniture: desks, tall bookshelves, reading lecterns, and relic display. */
function furnishScriptorium(map: RegionMap, fx: number, fy: number): void {
  const put = placer(map, 'sanctum-scriptorium', fx, fy);
  put('tall-bookshelf', 1.5, 1, 2, 1);
  put('tall-bookshelf', 4, 1, 2, 1);
  put('relic-case', 8, 1, 2, 1);
  put('tall-bookshelf', 10.5, 1, 2, 1);
  put('scribe-desk', 2, 4, 2, 1);
  put('scribe-desk', 10, 4, 2, 1);
  put('reading-lectern', 2, 7, 1.5, 1);
  put('tall-bookshelf', 10.5, 7, 2, 1);
}

/** The Pilgrim's Haven Inn furniture: hearth, counter, ale casks, dining tables, and benches. */
function furnishInn(map: RegionMap, fx: number, fy: number): void {
  const put = placer(map, 'sanctum-inn', fx, fy);
  put('hearth', 2, 1, 3, 1);
  put('bar-counter', 7.5, 2, 3, 1);
  put('ale-cask', 10.5, 1, 1, 1);
  put('dining-table', 2.5, 5, 2.6, 1);
  put('bench', 2.5, 6.5, 2, 1);
  put('dining-table', 2.5, 8.5, 2.6, 1);
  put('dining-table', 9.5, 5, 2.6, 1);
  put('bench', 9.5, 6.5, 2, 1);
}

/** The Arcanum's furniture, placed as landmarks from the floor's top-left tile, leaving a way in from the door. */
function furnishArcanum(map: RegionMap, fx: number, fy: number): void {
  const put = placer(map, 'sanctum-arcanum', fx, fy);
  put('shelf', 1, 1, 2, 1);
  put('herb-rack', 4, 1, 2, 1);
  put('shelf', 7, 1, 2, 1);
  put('scrying-basin', 9.5, 3, 1, 1);
  put('counter', 5, 4, 3, 1);
  put('stool', 2.5, 5, 1, 1);
  put('stool', 7.5, 5, 1, 1);
  put('display-case', 1, 7, 2, 1);
  put('display-case', 9, 7, 2, 1);
}

/** Places a building style's furniture as landmarks, from its floor's top-left tile. */
export function placer(map: RegionMap, style: string, fx: number, fy: number) {
  return (key: string, x: number, y: number, width: number, height: number) =>
    map.landmarks.push({ asset: furnitureArt(style, key), x: fx + x, y: fy + y, footprint: { width, height } });
}

/** Old Bramble's cottage: its floor is this many tiles square, inside the walls. */
export const COTTAGE_SIZE = 16;

const woodsLayout: Layout = (map, c) => {
  scatter(map, (x, y) => (valueNoise(x, y, map.seed, 5) > 0.42 && rand2(x, y, map.seed + 1) < 0.75 ? Tile.Tree : Tile.Ground));
  // The cottage stands west of the middle. From outside it is her great
  // hollow tree, and the doorway sits in the south wall right where the
  // tree's door is painted, so the door you see is the door you walk through.
  const left = c - 30;
  const top = c - 10;
  const home = building(map, left, top, COTTAGE_SIZE, COTTAGE_SIZE, 'bramble-cottage');
  map.buildings.push(home);
  disc(map, c, c, 4, Tile.Ground);
  // The road leaves the doorstep southward, turns east, then runs up to the middle.
  const lane = home.y + home.height + 1;
  road(map, c, lane, home.door.x, home.door.y + 1);
  road(map, c, c, c, lane);
  furnish(map, left + 1, top + 1);
  map.npcs.push({ id: 'old-bramble', name: 'Old Bramble', asset: 'woods-herbalist', x: left + 9.5, y: top + 12.5 });
  creatures(map, 'walking-mushroom', 'Walking Mushroom', 'woods-mushroom', 5 * SPREAD);
  map.spawn = { x: c, y: c + 1 };
};

/** Old Bramble's furniture, placed as landmarks from the floor's top-left tile. */
function furnish(map: RegionMap, fx: number, fy: number): void {
  const put = placer(map, 'bramble-cottage', fx, fy);
  put('bed', 1, 3, 2, 2);
  put('bookshelf', 4, 1, 2, 1);
  put('hearth', 8.5, 1, 3, 1);
  put('herb-rack', 13, 1, 2, 1);
  put('cauldron', 14.5, 4, 1, 1);
  put('table', 8, 8, 2, 1);
  put('barrel', 14.5, 15, 1, 1);
  put('barrel', 15.5, 15, 1, 1);
}

const shoreLayout: Layout = (map, c) => {
  scatter(map, (x, y) => {
    const coast = map.width * 0.66 + (valueNoise(0, y, map.seed, 6) - 0.5) * 10;
    if (x > coast) return Tile.Water;
    if (rand2(x, y, map.seed + 1) < 0.015) return Tile.Rock;
    // Palms line the beach and thin out inland.
    if (rand2(x, y, map.seed + 2) < (x > coast - 6 ? 0.12 : 0.015)) return Tile.Tree;
    return Tile.Ground;
  });
  const lx = Math.floor(map.width * 0.58);
  disc(map, lx, c, 4, Tile.Ground);
  road(map, c, c, lx - 2, c);
  map.landmarks.push({ asset: 'shore-lighthouse', x: lx + 0.5, y: c - 1, footprint: { width: 2, height: 2 } });
  map.npcs.push({ id: 'marina', name: 'Marina the Trader', asset: 'shore-trader', x: lx - 3.5, y: c + 2.5 });
  creatures(map, 'crab-knight', 'Crab Knight', 'shore-crab-knight', 5 * SPREAD);
  map.spawn = { x: c, y: c + 1 };
};

const desertLayout: Layout = (map, c) => {
  scatter(map, (x, y) => {
    const water = valueNoise(x, y, map.seed, 8);
    if (water < 0.12) return Tile.Water;
    if (rand2(x, y, map.seed + 1) < 0.025) return Tile.Rock;
    // Cacti, a little thicker around the oases.
    if (rand2(x, y, map.seed + 2) < (water < 0.2 ? 0.08 : 0.02)) return Tile.Tree;
    return Tile.Ground;
  });
  const ry = c + 12;
  disc(map, c, ry, 5, Tile.Ground);
  road(map, c, c, c, ry - 3);
  map.landmarks.push({ asset: 'desert-ruin', x: c + 0.5, y: ry, footprint: { width: 3, height: 2 } });
  map.npcs.push({ id: 'cactus-elder', name: 'Cactus Elder', asset: 'desert-cactus-folk', x: c + 3.5, y: ry - 3.5 });
  creatures(map, 'sun-scarab', 'Sun Scarab', 'desert-scarab', 5 * SPREAD);
  map.spawn = { x: c, y: c + 1 };
};

/** How likely each tile is to hold a tree, rock or water, from 0 (none) to 3 (thick). */
const TREE_CHANCE = [0, 0.03, 0.08, 0.16];
const ROCK_CHANCE = [0, 0.008, 0.02, 0.04];
const WATER_LEVEL = [0, 0.12, 0.2, 0.28];

/**
 * A wished region: the biome's ground with trees, rocks and water as thick
 * as the wish asked, a clearing in the middle where its person stands, and
 * its creatures roaming the rest.
 */
function wildLayout(wild: WildLand): Layout {
  const level = (n: number) => Math.max(0, Math.min(3, Math.round(n)));
  return (map, c) => {
    scatter(map, (x, y) => {
      if (valueNoise(x, y, map.seed, 9) < WATER_LEVEL[level(wild.water)]!) return Tile.Water;
      if (rand2(x, y, map.seed + 1) < ROCK_CHANCE[level(wild.rocks)]!) return Tile.Rock;
      // Trees grow in groves, thinning out between them.
      const grove = valueNoise(x, y, map.seed + 2, 6);
      if (rand2(x, y, map.seed + 3) < TREE_CHANCE[level(wild.trees)]! * (0.4 + grove * 1.2)) return Tile.Tree;
      return Tile.Ground;
    });
    disc(map, c, c, 5, Tile.Ground);
    if (wild.npc) map.npcs.push({ ...wild.npc, x: c - 2.5, y: c + 3.5 });
    // A wished land has just the creatures its wisher asked for.
    for (const kind of wild.creatures) creatures(map, kind.kind, kind.name, kind.asset, kind.count);
    map.spawn = { x: c, y: c + 1 };
  };
}

const BIOME_LAYOUTS: Partial<Record<BiomeId, Layout>> = {
  sanctum: sanctumLayout,
  'whispering-woods': woodsLayout,
  'sunlit-shore': shoreLayout,
  'mirage-desert': desertLayout,
};

/** Creatures roam the whole land, so each kind comes this many times over to keep the first lands' liveliness. */
const SPREAD = 8;

function scatter(map: RegionMap, pick: (x: number, y: number) => Tile): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) map.tiles[y * map.width + x] = pick(x, y);
  }
}

/** Sets one tile, ignoring spots outside the region. */
export function set(map: RegionMap, x: number, y: number, t: Tile): void {
  if (x >= 0 && y >= 0 && x < map.width && y < map.height) map.tiles[y * map.width + x] = t;
}

/** A round patch of one tile kind. */
export function disc(map: RegionMap, cx: number, cy: number, r: number, t: Tile): void {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) set(map, cx + x, cy + y, t);
}

/**
 * A walled building whose floor is `width` by `height` tiles, its wall's
 * top-left corner at (left, top), in a clearing a tile wide, with a two-tile
 * doorway in the south wall. Its look is a key of BUILDING_STYLES.
 */
export function building(map: RegionMap, left: number, top: number, width: number, height: number, style: string): Building {
  const right = left + width + 1;
  const bottom = top + height + 1;
  for (let y = top - 1; y <= bottom + 1; y++) {
    for (let x = left - 1; x <= right + 1; x++) {
      const inside = x > left && x < right && y > top && y < bottom;
      // The walls are the building's own edge; the ring around it is clearing.
      const within = x >= left && x <= right && y >= top && y <= bottom;
      const wall = within && !inside;
      set(map, x, y, wall ? Tile.Wall : inside ? Tile.Floor : Tile.Ground);
    }
  }
  // The doorway is in the middle of the south wall, so the outside art,
  // centred on it, covers the building evenly on both sides.
  const door = { x: left + Math.floor(width / 2), y: bottom };
  set(map, door.x, door.y, Tile.Door);
  set(map, door.x + 1, door.y, Tile.Door);
  return {
    x: left,
    y: top,
    width: width + 2,
    height: height + 2,
    door,
    style,
    exteriorWidth: width + 4,
  };
}

/** A two-tile-wide road: horizontal leg first, then vertical. Where it crosses water it becomes a bridge. */
export function road(map: RegionMap, x0: number, y0: number, x1: number, y1: number): void {
  const pave = (x: number, y: number) => {
    const here = x >= 0 && y >= 0 && x < map.width && y < map.height ? map.tiles[y * map.width + x] : undefined;
    // Roads never cut through a building's walls or floor.
    if (here === Tile.Wall || here === Tile.Floor || here === Tile.Door || here === Tile.Blocked) return;
    set(map, x, y, here === Tile.Water || here === Tile.Bridge ? Tile.Bridge : Tile.Path);
  };
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    pave(x, y0);
    pave(x, y0 + 1);
  }
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 1; y++) {
    pave(x1, y);
    pave(x1 + 1, y);
  }
}

/** Blocks the footprint whose bottom row is centred under (x, y). */
export function block(map: RegionMap, x: number, y: number, w: number, h: number): void {
  const left = Math.floor(x - w / 2);
  const bottom = Math.floor(y - 0.01);
  for (let ty = bottom - h + 1; ty <= bottom; ty++) for (let tx = left; tx < left + w; tx++) set(map, tx, ty, Tile.Blocked);
}

function edgePoint(side: Side, size: number, c: number): { x: number; y: number } {
  switch (side) {
    case 'west': return { x: 0, y: c };
    case 'east': return { x: size - 1, y: c };
    case 'north': return { x: c, y: 0 };
    case 'south': return { x: c, y: size - 1 };
  }
}

/** Scatters creatures of a kind over open ground, away from the middle where travellers arrive. */
export function creatures(map: RegionMap, kind: string, name: string, asset: string, count: number): void {
  let placed = 0;
  for (let i = 0; placed < count && i < count * 100; i++) {
    const x = 4 + Math.floor(rand2(i, 7, map.seed) * (map.width - 8));
    const y = 4 + Math.floor(rand2(i, 9, map.seed) * (map.height - 8));
    if (map.tiles[y * map.width + x] !== Tile.Ground) continue;
    if (Math.hypot(x - map.width / 2, y - map.height / 2) < 8) continue;
    map.creatures.push({ kind, name, asset, x: x + 0.5, y: y + 0.5 });
    placed++;
  }
}

/**
 * The tile under a position on a floor (the ground unless said); outside the
 * region counts as an open or closed edge. Off the ground, wherever no storey
 * of that floor lies is solid: there is nothing there to stand on.
 */
export function tileAt(map: RegionMap, x: number, y: number, floor = 0): Tile {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (floor !== 0) {
    const s = storeyAt(map, tx, ty, floor);
    return s ? (s.tiles[(ty - s.y) * s.width + (tx - s.x)] as Tile) : Tile.Blocked;
  }
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) {
    const side = outsideSide(map, x, y);
    return side && map.def.exits[side] ? Tile.Path : Tile.Water;
  }
  return map.tiles[ty * map.width + tx] as Tile;
}

/** The storey of a floor over a tile, if any. */
export function storeyAt(map: RegionMap, tx: number, ty: number, floor: number): Storey | undefined {
  return map.storeys.find((s) => s.floor === floor && tx >= s.x && ty >= s.y && tx < s.x + s.width && ty < s.y + s.height);
}

/** Where the neighbour beyond `side` sits, in tiles, so regions can be drawn side by side. */
export function neighbourOffset(side: Side, size = REGION_SIZE): { x: number; y: number } {
  return { north: { x: 0, y: -size }, south: { x: 0, y: size }, east: { x: size, y: 0 }, west: { x: -size, y: 0 } }[side];
}

/** Which edge a position has crossed, if any. */
export function outsideSide(map: RegionMap, x: number, y: number): Side | null {
  if (x < 0) return 'west';
  if (x >= map.width) return 'east';
  if (y < 0) return 'north';
  if (y >= map.height) return 'south';
  return null;
}
