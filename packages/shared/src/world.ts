import { valueNoise, rand2 } from './random.ts';

export enum Tile {
  Grass = 0,
  Flowers = 1,
  Sand = 2,
  Water = 3,
  Tree = 4,
  Path = 5,
  Shrine = 6,
}

const BLOCKING = new Set<Tile>([Tile.Water, Tile.Tree, Tile.Shrine]);

export function isBlocking(tile: Tile): boolean {
  return BLOCKING.has(tile);
}

export interface RegionMap {
  width: number;
  height: number;
  seed: number;
  tiles: Uint8Array;
  /** Where new and respawning players appear. */
  spawn: { x: number; y: number };
  shrine: { x: number; y: number };
}

export const REGION_SIZE = 64;
const PLAZA_RADIUS = 6;

/**
 * Builds the Sanctum region: a stone plaza with the God's shrine in the
 * middle, paths to each edge, and grass, lakes and woods around it.
 * Deterministic from the seed, so server and client generate the same map.
 */
export function generateSanctum(seed: number, size = REGION_SIZE): RegionMap {
  const tiles = new Uint8Array(size * size);
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const water = valueNoise(x, y, seed, 9) * 0.7 + valueNoise(x, y, seed + 1, 4) * 0.3;
      const wood = valueNoise(x, y, seed + 2, 7);
      let tile = Tile.Grass;
      if (water < 0.28) tile = Tile.Water;
      else if (water < 0.33) tile = Tile.Sand;
      else if (wood > 0.62 && rand2(x, y, seed + 3) < 0.7) tile = Tile.Tree;
      else if (rand2(x, y, seed + 4) < 0.06) tile = Tile.Flowers;
      tiles[y * size + x] = tile;
    }
  }

  // Plaza and paths are carved last so the hub is always reachable.
  const set = (x: number, y: number, t: Tile) => {
    if (x >= 0 && y >= 0 && x < size && y < size) tiles[y * size + x] = t;
  };
  for (let y = -PLAZA_RADIUS; y <= PLAZA_RADIUS; y++) {
    for (let x = -PLAZA_RADIUS; x <= PLAZA_RADIUS; x++) {
      if (x * x + y * y <= PLAZA_RADIUS * PLAZA_RADIUS) set(cx + x, cy + y, Tile.Path);
    }
  }
  for (let i = 0; i < size; i++) {
    set(cx, i, Tile.Path);
    set(cx + 1, i, Tile.Path);
    set(i, cy, Tile.Path);
    set(i, cy + 1, Tile.Path);
  }
  set(cx, cy, Tile.Shrine);

  return {
    width: size,
    height: size,
    seed,
    tiles,
    spawn: { x: cx + 0.5, y: cy + 3.5 },
    shrine: { x: cx, y: cy },
  };
}

export function tileAt(map: RegionMap, x: number, y: number): Tile {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  // Outside the region counts as blocked until neighbouring regions exist.
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return Tile.Water;
  return map.tiles[ty * map.width + tx] as Tile;
}
