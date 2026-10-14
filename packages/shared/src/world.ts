import type { BiomeId } from './biomes.ts';
import { rand2, valueNoise } from './random.ts';

export enum Tile {
  /** The biome's own ground (meadow, moss, sand, dunes). */
  Ground = 0,
  /** Old pilgrim road of Sanctum flagstones, linking regions. */
  Path = 1,
  Water = 2,
  Tree = 3,
  Rock = 4,
  /** Under a landmark or NPC: drawn as ground, never walkable. */
  Blocked = 5,
}

const BLOCKING = new Set<Tile>([Tile.Water, Tile.Tree, Tile.Rock, Tile.Blocked]);

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
}

/** The launch world: the Sanctum in the middle, a biome on three sides. */
export const WORLD_REGIONS: RegionDef[] = [
  { id: 'sanctum', name: 'the Sanctum', biome: 'sanctum', seed: 1337, exits: { west: 'woods', east: 'shore', south: 'desert' } },
  { id: 'woods', name: 'Whispering Woods', biome: 'whispering-woods', seed: 2001, exits: { east: 'sanctum' } },
  { id: 'shore', name: 'Sunlit Shore', biome: 'sunlit-shore', seed: 3001, exits: { west: 'sanctum' } },
  { id: 'desert', name: 'Mirage Desert', biome: 'mirage-desert', seed: 4001, exits: { north: 'sanctum' } },
];

export function regionDef(id: string): RegionDef | undefined {
  return WORLD_REGIONS.find((r) => r.id === id);
}

/** A large painted set piece; its footprint tiles are blocked. */
export interface Landmark {
  asset: string;
  /** Bottom centre of the art, in tiles. */
  x: number;
  y: number;
  footprint: { width: number; height: number };
}

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
    npcs: [],
    creatures: [],
  };
  const c = Math.floor(size / 2);
  (BIOME_LAYOUTS[def.biome] ?? sanctumLayout)(map, c);

  // Roads from every open edge to the middle, then entry points just inside.
  for (const side of Object.keys(def.exits) as Side[]) {
    const edge = edgePoint(side, size, c);
    road(map, edge.x, edge.y, c, c);
    const inward = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }[side];
    map.entries[side] = { x: edge.x + 1 + inward[0]! * 1.5, y: edge.y + 1 + inward[1]! * 1.5 };
  }
  for (const l of map.landmarks) block(map, l.x, l.y, l.footprint.width, l.footprint.height);
  for (const n of map.npcs) block(map, n.x, n.y, 1, 1);
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
  map.npcs.push({ id: 'sister-amala', name: 'Sister Amala', asset: 'sanctum-pilgrim', x: c - 2.5, y: c + 4.5 });
  map.spawn = { x: c + 1, y: c + 4 };
};

const woodsLayout: Layout = (map, c) => {
  scatter(map, (x, y) => (valueNoise(x, y, map.seed, 5) > 0.42 && rand2(x, y, map.seed + 1) < 0.75 ? Tile.Tree : Tile.Ground));
  const hx = c - 12;
  disc(map, hx, c, 6, Tile.Ground);
  disc(map, c, c, 4, Tile.Ground);
  road(map, hx + 1, c + 1, c, c);
  map.landmarks.push({ asset: 'woods-tree-house', x: hx + 0.5, y: c - 1, footprint: { width: 3, height: 2 } });
  map.npcs.push({ id: 'old-bramble', name: 'Old Bramble', asset: 'woods-herbalist', x: hx + 3.5, y: c + 3.5 });
  creatures(map, 'walking-mushroom', 'Walking Mushroom', 'woods-mushroom', 5);
  map.spawn = { x: c, y: c + 1 };
};

const shoreLayout: Layout = (map, c) => {
  scatter(map, (x, y) => {
    const coast = map.width * 0.66 + (valueNoise(0, y, map.seed, 6) - 0.5) * 10;
    if (x > coast) return Tile.Water;
    if (rand2(x, y, map.seed + 1) < 0.015) return Tile.Rock;
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
    if (valueNoise(x, y, map.seed, 8) < 0.12) return Tile.Water;
    if (rand2(x, y, map.seed + 1) < 0.025) return Tile.Rock;
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
  let placed = 0;
  for (let i = 0; placed < count && i < 500; i++) {
    const x = 4 + Math.floor(rand2(i, 7, map.seed) * (map.width - 8));
    const y = 4 + Math.floor(rand2(i, 9, map.seed) * (map.height - 8));
    if (map.tiles[y * map.width + x] !== Tile.Ground) continue;
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

/** Which edge a position has crossed, if any. */
export function outsideSide(map: RegionMap, x: number, y: number): Side | null {
  if (x < 0) return 'west';
  if (x >= map.width) return 'east';
  if (y < 0) return 'north';
  if (y >= map.height) return 'south';
  return null;
}
