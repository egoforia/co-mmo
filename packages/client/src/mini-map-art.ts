import Phaser from 'phaser';
import { TILE_PIXELS, Tile, type RegionMap } from '@co-mmo/shared';
import { TILE_MARGIN, propTexture, registerBuildingTileset, registerStoreyTileset, registerTileset } from './textures.ts';

// The mini map's pictures of each floor, put together from the same painted
// tiles, trees, rocks and set pieces the world is drawn with, only smaller.
// Nothing here is drawn in code: every pixel is copied from painted art.

/** Pixels across one tile in a floor's picture; the map shows it smaller or larger as it zooms. */
export const PLAN_PIXELS = 8;

/** A part of a floor's picture and the tiles it covers. */
export interface PlanPiece {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

const T = TILE_PIXELS;

/**
 * A floor of a region as the mini map shows it: the whole land for the
 * ground (buildings as their floor plans), or each storey of a floor above
 * or below it over its own rectangle.
 */
export function floorPlan(scene: Phaser.Scene, map: RegionMap, floor: number): PlanPiece[] {
  const swatch = swatches(scene);
  if (floor !== 0) {
    return map.storeys
      .filter((s) => s.floor === floor)
      .map((s) => {
        const strip = registerStoreyTileset(scene, s);
        // Furniture stands on the floor, as it is drawn in the world.
        const piece = tiles(s.width, s.height, (x, y) => {
          const t = s.tiles[y * s.width + x] as Tile;
          return swatch(strip, t === Tile.Blocked ? Tile.Floor : t);
        });
        const ctx = piece.getContext('2d')!;
        landmarks(scene, ctx, map, floor, s.x, s.y);
        stairs(scene, ctx, map, floor, s.x, s.y);
        return { canvas: piece, x: s.x, y: s.y, width: s.width, height: s.height };
      });
  }
  const land = registerTileset(scene, map.def);
  const inside = map.buildings.map((b) => ({ b, strip: registerBuildingTileset(scene, b.style) }));
  const canvas = tiles(map.width, map.height, (x, y) => {
    const home = inside.find(({ b }) => x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height);
    const t = groundTile(map, x, y);
    return swatch(home?.strip ?? land, home && t === Tile.Ground ? Tile.Floor : t);
  });
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y * map.width + x];
      if (t !== Tile.Tree && t !== Tile.Rock) continue;
      const art = propTexture(scene, map.def.biome, t === Tile.Tree ? 'tree' : 'rock', (x * 7 + y * 13) % 3);
      if (art) stand(ctx, source(scene, art), x + 0.5, y + 1, t === Tile.Tree ? 1.4 : 1);
    }
  }
  landmarks(scene, ctx, map, 0, 0, 0);
  stairs(scene, ctx, map, 0, 0, 0);
  return [{ canvas, x: 0, y: 0, width: map.width, height: map.height }];
}

/** The tile to show on the ground: under a tree or rock its ground, under a set piece whatever surrounds it. */
function groundTile(map: RegionMap, x: number, y: number): Tile {
  const at = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height ? undefined : (map.tiles[ty * map.width + tx] as Tile));
  const t = at(x, y)!;
  if (t !== Tile.Blocked) return t;
  const around = [at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)];
  return around.includes(Tile.Floor) ? Tile.Floor : around.filter((n) => n === Tile.Path).length >= 2 ? Tile.Path : Tile.Ground;
}

/** A canvas `width` by `height` tiles, each copied from the swatch the callback picks. */
function tiles(width: number, height: number, pick: (x: number, y: number) => HTMLCanvasElement | undefined): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width * PLAN_PIXELS;
  canvas.height = height * PLAN_PIXELS;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = pick(x, y);
      if (s) ctx.drawImage(s, x * PLAN_PIXELS, y * PLAN_PIXELS);
    }
  }
  return canvas;
}

/** Set pieces and furniture standing on a floor, on a picture whose top-left tile is (ox, oy). */
function landmarks(scene: Phaser.Scene, ctx: CanvasRenderingContext2D, map: RegionMap, floor: number, ox: number, oy: number): void {
  for (const l of map.landmarks) {
    if ((l.floor ?? 0) !== floor || !scene.textures.exists(l.asset)) continue;
    stand(ctx, source(scene, l.asset), l.x - ox, l.y - oy, l.footprint.width);
  }
}

/** Stairs and ladders on a floor, once their pictures are painted (until then the world labels them). */
function stairs(scene: Phaser.Scene, ctx: CanvasRenderingContext2D, map: RegionMap, floor: number, ox: number, oy: number): void {
  for (const s of map.stairways) {
    if (s.lower !== floor && s.upper !== floor) continue;
    const art = floor === s.lower ? s.art?.up : s.art?.down;
    if (art && scene.textures.exists(art)) stand(ctx, source(scene, art), s.x - ox + s.width / 2, s.y - oy + s.height, s.width);
  }
}

/** Draws a picture `width` tiles across, its bottom middle at tile point (x, y). */
function stand(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, width: number): void {
  if (!img.width || !img.height) return;
  const w = width * PLAN_PIXELS;
  const h = (w * img.height) / img.width;
  ctx.drawImage(img, x * PLAN_PIXELS - w / 2, y * PLAN_PIXELS - h, w, h);
}

function source(scene: Phaser.Scene, key: string): HTMLImageElement | HTMLCanvasElement {
  return scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
}

/**
 * Each painted tile of a tile strip shrunk to the plan's size once, so
 * putting a land together is copying small squares, not shrinking the
 * painting tens of thousands of times.
 */
function swatches(scene: Phaser.Scene): (strip: string, tile: Tile) => HTMLCanvasElement | undefined {
  const made = new Map<string, HTMLCanvasElement | undefined>();
  return (strip, tile) => {
    const key = `${strip}:${tile}`;
    if (made.has(key)) return made.get(key);
    const src = source(scene, strip);
    const step = T + TILE_MARGIN * 2;
    let canvas: HTMLCanvasElement | undefined;
    if ((tile + 1) * step <= src.width) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = PLAN_PIXELS;
      canvas.getContext('2d')!.drawImage(src, tile * step + TILE_MARGIN, TILE_MARGIN, T, T, 0, 0, PLAN_PIXELS, PLAN_PIXELS);
    }
    made.set(key, canvas);
    return canvas;
  };
}
