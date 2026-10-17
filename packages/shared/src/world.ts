import type { BiomeId } from './biomes.ts';
import { rand2, valueNoise } from './random.ts';
import { furnitureArt } from './buildings.ts';

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
}

/** Where an NPC starts; on the server, where they stand now as they stroll. */
export interface NpcPlacement {
  id: string;
  name: string;
  asset: string;
  x: number;
  y: number;
}

export interface CreatureSpawn {
  kind: string;
  name: string;
  asset: string;
  x: number;
  y: number;
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
  npcs: NpcPlacement[];
  creatures: CreatureSpawn[];
}

export const REGION_SIZE = 64;

/** Builds a region from its definition. Deterministic, so server and client agree. */
export function generateRegion(def: RegionDef, size = REGION_SIZE): RegionMap {
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
    npcs: [],
    creatures: [],
  };
  const c = Math.floor(size / 2);
  const layout = def.wild ? wildLayout(def.wild) : BIOME_LAYOUTS[def.biome] ?? sanctumLayout;
  layout(map, c);

  // Roads from every open edge to the middle, then entry points just inside.
  for (const side of Object.keys(def.exits) as Side[]) {
    const edge = edgePoint(side, size, c);
    road(map, edge.x, edge.y, c, c);
    const inward = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }[side];
    map.entries[side] = { x: edge.x + 1 + inward[0]! * 1.5, y: edge.y + 1 + inward[1]! * 1.5 };
  }
  // NPCs stroll around their spot, so only landmarks block tiles.
  for (const l of map.landmarks) block(map, l.x, l.y, l.footprint.width, l.footprint.height);
  return map;
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
  const lane = shop.y + shop.height + 1;
  road(map, c, lane, shop.door.x, shop.door.y + 1);
  furnishArcanum(map, left + 1, top + 1);
  map.npcs.push({ id: 'sister-amala', name: 'Sister Amala', asset: 'sanctum-pilgrim', x: c - 2.5, y: c + 4.5 });
  map.spawn = { x: c + 1, y: c + 4 };
};

/** The Sanctum Arcanum's floor, in tiles, inside the walls. */
export const ARCANUM_SIZE = { width: 10, height: 8 };

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
function placer(map: RegionMap, style: string, fx: number, fy: number) {
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
  const left = 3;
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
  creatures(map, 'walking-mushroom', 'Walking Mushroom', 'woods-mushroom', 5);
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
  creatures(map, 'crab-knight', 'Crab Knight', 'shore-crab-knight', 5);
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
  creatures(map, 'sun-scarab', 'Sun Scarab', 'desert-scarab', 5);
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

function scatter(map: RegionMap, pick: (x: number, y: number) => Tile): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) map.tiles[y * map.width + x] = pick(x, y);
  }
}

function set(map: RegionMap, x: number, y: number, t: Tile): void {
  if (x >= 0 && y >= 0 && x < map.width && y < map.height) map.tiles[y * map.width + x] = t;
}

function disc(map: RegionMap, cx: number, cy: number, r: number, t: Tile): void {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) set(map, cx + x, cy + y, t);
}

/**
 * A walled building whose floor is `width` by `height` tiles, its wall's
 * top-left corner at (left, top), in a clearing a tile wide, with a two-tile
 * doorway in the south wall. Its look is a key of BUILDING_STYLES.
 */
function building(map: RegionMap, left: number, top: number, width: number, height: number, style: string): Building {
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

/** A two-tile-wide road: horizontal leg first, then vertical. */
function road(map: RegionMap, x0: number, y0: number, x1: number, y1: number): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    set(map, x, y0, Tile.Path);
    set(map, x, y0 + 1, Tile.Path);
  }
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 1; y++) {
    set(map, x1, y, Tile.Path);
    set(map, x1 + 1, y, Tile.Path);
  }
}

/** Blocks the footprint whose bottom row is centred under (x, y). */
function block(map: RegionMap, x: number, y: number, w: number, h: number): void {
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

function creatures(map: RegionMap, kind: string, name: string, asset: string, count: number): void {
  // Only where players can walk to from the middle: a creature born in a
  // pocket ringed by trees could never be reached or fought.
  const open = openFromMiddle(map);
  let placed = 0;
  for (let i = 0; placed < count && i < 500; i++) {
    const x = 4 + Math.floor(rand2(i, 7, map.seed) * (map.width - 8));
    const y = 4 + Math.floor(rand2(i, 9, map.seed) * (map.height - 8));
    if (map.tiles[y * map.width + x] !== Tile.Ground || !open[y * map.width + x]) continue;
    if (Math.hypot(x - map.width / 2, y - map.height / 2) < 8) continue;
    map.creatures.push({ kind, name, asset, x: x + 0.5, y: y + 0.5 });
    placed++;
  }
}

/** The tile under a position; outside the region counts as an open or closed edge. */
export function tileAt(map: RegionMap, x: number, y: number): Tile {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) {
    const side = outsideSide(map, x, y);
    return side && map.def.exits[side] ? Tile.Path : Tile.Water;
  }
  return map.tiles[ty * map.width + tx] as Tile;
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

/** Tiles a player can walk to from the middle of the region, stepping square by square. */
function openFromMiddle(map: RegionMap): Uint8Array {
  const w = map.width;
  const open = new Uint8Array(w * map.height);
  const start = Math.floor(map.height / 2) * w + Math.floor(w / 2);
  const queue = [start];
  open[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const x = at % w;
    const y = (at - x) / w;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= map.height) continue;
      const next = ny * w + nx;
      if (open[next] || isBlocking(map.tiles[next] as Tile)) continue;
      open[next] = 1;
      queue.push(next);
    }
  }
  return open;
}
