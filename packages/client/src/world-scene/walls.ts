// Tilemap layers, isometric cutaway walls (0.5-tile thick with tall North/West
// back walls and low South/East near walls), and roof/coping caps.

import Phaser from 'phaser';
import {
  Tile,
  buildingArt,
  type TileArt,
} from '@co-mmo/shared';
import { PROJECTION } from '../projection.ts';
import {
  DIAMOND_PAD,
  registerDiamondTileset,
  registerKitTileset,
  registerWallFace,
} from '../textures.ts';
import {
  EAST_WALL_TINT,
  WALL_RISE,
  floorDepthOffset,
  floorLift,
  wallCapDepth,
} from './types.ts';

/**
 * A ground layer of diamond tiles for the isometric camera, from a strip
 * made by registerDiamondTileset: the tile in row y, column x has its top
 * corner `(x - y) * width / 2` across and `(x + y) * height / 2` down from `top`.
 */
export function diamondLayer(
  scene: Phaser.Scene,
  tiles: number[][],
  top: { x: number; y: number },
  key: string,
  size: { width: number; height: number },
): Phaser.Tilemaps.TilemapLayer {
  const { width: w, height: h } = size;
  const iso = Phaser.Tilemaps.Orientation.ISOMETRIC;
  const rows = tiles.length;
  const columns = tiles[0]?.length ?? 0;
  const layer = new Phaser.Tilemaps.LayerData({ name: 'ground', width: columns, height: rows, tileWidth: w, tileHeight: h });
  // Before the tiles, which work out where they stand from it.
  layer.orientation = iso;
  layer.data = tiles.map((row, y) => row.map((index, x) => new Phaser.Tilemaps.Tile(layer, index, x, y, w, h, w, h)));
  const data = new Phaser.Tilemaps.MapData({ name: key, width: columns, height: rows, tileWidth: w, tileHeight: h, orientation: iso, format: Phaser.Tilemaps.Formats.ARRAY_2D, layers: [layer] });
  const tilemap = new Phaser.Tilemaps.Tilemap(scene, data);
  const tileset = tilemap.addTilesetImage(key, key, w, h, DIAMOND_PAD, DIAMOND_PAD * 2)!;
  // Phaser stands each diamond's box, not its top corner, at the tile's place.
  return tilemap.createLayer(0, tileset, top.x - w / 2, top.y)!;
}

/** A tile layer of the rows given, its top-left tile at world (x, y), from the tile strip `key`. */
export function groundLayer(
  scene: Phaser.Scene,
  tiles: number[][],
  x: number,
  y: number,
  depth: number,
  key: string,
): Phaser.Tilemaps.TilemapLayer {
  const at = PROJECTION.toScreen(x, y);
  const ground = PROJECTION.ground;
  return diamondLayer(scene, tiles, at, registerDiamondTileset(scene, key, ground.width, ground.height), ground).setDepth(depth);
}

/** Resolves the single seamless wall texture key for a building style or kit art override. */
export function wallFaceKey(scene: Phaser.Scene, style: string, art?: TileArt): string | undefined {
  const key = art?.face ?? art?.wall ?? buildingArt(style, 'wall');
  return scene.textures.exists(key) ? key : undefined;
}

/**
 * Builds 0.5-tile thick isometric walls from a single seamless wall texture:
 * - When `cutaway` is false (exterior shell), all perimeter walls stand at full storey height (`storeyRise`),
 *   and `roofCap` closes the top across the building footprint.
 * - When `cutaway` is true (interior cutaway or active storey), far North/West back walls (and far North/West
 *   corridor flanks) stand at full storey height (`storeyRise`), while camera-facing South/East walls and near
 *   South/East corridor flanks cut low (`cutRise` ~20px) so the player and floor are never occluded.
 * - For elevated storeys (`floor > 0`), vertical cliff/support walls (`skirt`) hang down beneath the outer
 *   South and East ledges so upper floors visibly rest on solid mountain stone or masonry rather than floating.
 */
export function rockWalls(
  scene: Phaser.Scene,
  rows: number[][],
  left: number,
  top: number,
  style: string,
  art: TileArt | undefined,
  tilemaps: Phaser.Tilemaps.Tilemap[],
  outward: boolean,
  cutaway = true,
  roofCap = false,
  floor = 0,
  openTerrace = false,
  neighbourTile?: (wx: number, wy: number) => number | undefined,
  cliffDrops?: (wx: number, wy: number) => number,
  hasUpperTile?: (wx: number, wy: number) => boolean,
): (Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer)[] {
  const ground = PROJECTION.ground;
  const face = wallFaceKey(scene, style, art);
  if (!face) return [];
  const cliffFace =
    (art?.face && scene.textures.exists(art.face) ? art.face : undefined) ??
    (style.startsWith('frostpeak-') && floor > 0 && scene.textures.exists('frostpeak-eyrie-wall')
      ? 'frostpeak-eyrie-wall'
      : face);
  const storeyRise = Math.round(ground.height * 2.0);
  const cutRise = Math.round(ground.height * WALL_RISE);
  const lift = floorLift(floor);
  const depthOff = floorDepthOffset(floor);
  const fullSouth = registerWallFace(scene, face, 'south', ground.width, ground.height, storeyRise);
  const fullEast = registerWallFace(scene, face, 'east', ground.width, ground.height, storeyRise);
  const lowSouth = cutaway ? registerWallFace(scene, face, 'south', ground.width, ground.height, cutRise) : fullSouth;
  const lowEast = cutaway ? registerWallFace(scene, face, 'east', ground.width, ground.height, cutRise) : fullEast;
  const cliffSouth = registerWallFace(scene, cliffFace, 'south', ground.width, ground.height, storeyRise) ?? fullSouth;
  const cliffEast = registerWallFace(scene, cliffFace, 'east', ground.width, ground.height, storeyRise) ?? fullEast;
  if (!fullSouth || !fullEast || !lowSouth || !lowEast || !cliffSouth || !cliffEast) return [];

  const h = rows.length;
  const w = rows[0]?.length ?? 0;

  const getTile = (x: number, y: number): number | undefined => {
    if (x >= 0 && x < w && y >= 0 && y < h) return rows[y]?.[x];
    if (neighbourTile) return neighbourTile(left + x, top + y);
    return undefined;
  };

  const wall = (x: number, y: number): boolean => getTile(x, y) === Tile.Wall;
  const exposedWall = (x: number, y: number): boolean =>
    wall(x, y) && !(openTerrace && hasUpperTile?.(left + x, top + y));
  const indoor = (x: number, y: number): boolean => {
    const t = getTile(x, y);
    return t !== undefined && t !== Tile.Wall && t !== Tile.Blocked;
  };
  const open = (x: number, y: number): boolean => {
    const t = getTile(x, y);
    if (t === undefined || t === Tile.Blocked) return outward;
    return t !== Tile.Wall;
  };

  // Far North/West walls (with no indoor floor to their North/West, and indoor floor to their South/East) stand tall;
  // near South/East walls and South/East corridor flanks cut low. Open-air terraces always stay low parapets.
  const isFull = (x: number, y: number): boolean =>
    !openTerrace &&
    (!cutaway ||
      (!indoor(x, y - 1) && !indoor(x - 1, y) && !indoor(x - 1, y - 1) && (indoor(x, y + 1) || indoor(x + 1, y) || indoor(x + 1, y + 1))));

  const parts: (Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer)[] = [];
  const tilesetKey = registerKitTileset(scene, style, art);
  const halfGround = { width: ground.width / 2, height: ground.height / 2 };
  const halfTileset = registerDiamondTileset(scene, tilesetKey, halfGround.width, halfGround.height);
  const atTop = PROJECTION.toScreen(left, top);

  if (roofCap && !cutaway) {
    const roof = rows.map((row) => row.map((t) => (t >= 0 ? Tile.Wall : -1)));
    const roofLayer = groundLayer(scene, roof, left, top, depthOff + PROJECTION.depth(left + w, top + h) + 1, tilesetKey).setData('shell', true);
    roofLayer.y -= lift + storeyRise;
    tilemaps.push(roofLayer.tilemap);
    parts.push(roofLayer);
  } else {
    const makeHalfCap = (wantFull: boolean, rise: number, depth: number) => {
      const halfRows: number[][] = Array.from({ length: h * 2 }, () => Array<number>(w * 2).fill(-1));
      let any = false;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!exposedWall(x, y) || isFull(x, y) !== wantFull) continue;
          any = true;

          const openN = open(x, y - 1);
          const openS = open(x, y + 1);
          const openW = open(x - 1, y);
          const openE = open(x + 1, y);

          // Sub-diamonds for tile (x, y):
          // (2x, 2y): North tip (along North-East & North-West edges)
          // (2x + 1, 2y): East tip (along North-East & South-East edges)
          // (2x, 2y + 1): West tip (along North-West & South-West edges)
          // (2x + 1, 2y + 1): South tip (along South-West & South-East edges)
          if (openN) {
            halfRows[y * 2]![x * 2] = Tile.Wall;
            halfRows[y * 2]![x * 2 + 1] = Tile.Wall;
          }
          if (openS) {
            halfRows[y * 2 + 1]![x * 2] = Tile.Wall;
            halfRows[y * 2 + 1]![x * 2 + 1] = Tile.Wall;
          }
          if (openW) {
            halfRows[y * 2]![x * 2] = Tile.Wall;
            halfRows[y * 2 + 1]![x * 2] = Tile.Wall;
          }
          if (openE) {
            halfRows[y * 2]![x * 2 + 1] = Tile.Wall;
            halfRows[y * 2 + 1]![x * 2 + 1] = Tile.Wall;
          }

          if (!openN && !openS && !openW && !openE) {
            if (open(x - 1, y - 1)) halfRows[y * 2]![x * 2] = Tile.Wall;
            if (open(x + 1, y - 1)) halfRows[y * 2]![x * 2 + 1] = Tile.Wall;
            if (open(x - 1, y + 1)) halfRows[y * 2 + 1]![x * 2] = Tile.Wall;
            if (open(x + 1, y + 1)) halfRows[y * 2 + 1]![x * 2 + 1] = Tile.Wall;
            if (!open(x - 1, y - 1) && !open(x + 1, y - 1) && !open(x - 1, y + 1) && !open(x + 1, y + 1)) {
              halfRows[y * 2]![x * 2] = Tile.Wall;
              halfRows[y * 2]![x * 2 + 1] = Tile.Wall;
              halfRows[y * 2 + 1]![x * 2] = Tile.Wall;
              halfRows[y * 2 + 1]![x * 2 + 1] = Tile.Wall;
            }
          }
        }
      }
      if (!any) return;
      const cap = diamondLayer(scene, halfRows, atTop, halfTileset, halfGround).setDepth(depth).setData('shell', true);
      cap.y -= lift + rise;
      tilemaps.push(cap.tilemap);
      parts.push(cap);
    };
    makeHalfCap(true, storeyRise, wallCapDepth(left, top, floor, true));
    if (cutaway) makeHalfCap(false, cutRise, wallCapDepth(left, top, floor, false));
  }

  rows.forEach((row, y) => row.forEach((_, x) => {
    if (!exposedWall(x, y)) return;
    const [tx, ty] = [left + x, top + y];
    const full = isFull(x, y);
    const rise = full ? storeyRise : cutRise;
    const southKey = full ? fullSouth : lowSouth;
    const eastKey = full ? fullEast : lowEast;
    if (open(x, y + 1) || (full && exposedWall(x, y + 1) && !isFull(x, y + 1))) {
      const at = PROJECTION.toScreen(tx, ty + 1);
      const img = scene.add.image(at.x, at.y - lift - rise, southKey).setOrigin(0, 0).setDepth(depthOff + PROJECTION.depth(tx + 0.5, ty + 1)).setData('shell', true);
      parts.push(img);
    }
    if (open(x + 1, y) || (full && exposedWall(x + 1, y) && !isFull(x + 1, y))) {
      const at = PROJECTION.toScreen(tx + 1, ty);
      const img = scene.add
        .image(at.x - ground.width / 2, at.y - lift - rise, eastKey)
        .setOrigin(0, 0)
        .setDepth(depthOff + PROJECTION.depth(tx + 1, ty + 0.5))
        .setTint(EAST_WALL_TINT)
        .setData('baseTint', EAST_WALL_TINT)
        .setData('shell', true);
      parts.push(img);
    }
  }));
  // Tagged so a cutaway can hide interior walls while keeping under-ledge cliff skirts visible.
  for (const p of parts) p.setData('wall', true);

  // Vertical cliff/support walls beneath the outer South and East ledges of elevated storeys (`floor > 0`).
  if (floor > 0) {
    rows.forEach((row, y) => row.forEach((_, x) => {
      if (getTile(x, y) === undefined) return;
      const [tx, ty] = [left + x, top + y];
      const southEdge = y === h - 1 && getTile(x, y + 1) === undefined;
      const eastEdge = x === w - 1 && getTile(x + 1, y) === undefined;
      if (!southEdge && !eastEdge) return;
      const drops = Math.max(1, cliffDrops ? cliffDrops(tx, ty) : 1);
      for (let d = 0; d < drops; d++) {
        const f = floor - d;
        if (f <= 0) break;
        const fLift = floorLift(f);
        const fDepthOff = floorDepthOffset(f - 1);
        if (southEdge) {
          const at = PROJECTION.toScreen(tx, ty + 1);
          const skirt = scene.add
            .image(at.x, at.y - fLift, cliffSouth)
            .setOrigin(0, 0)
            .setDepth(fDepthOff + PROJECTION.depth(tx + 0.5, ty + 1))
            .setData('shell', true)
            .setData('skirt', true);
          parts.push(skirt);
        }
        if (eastEdge) {
          const at = PROJECTION.toScreen(tx + 1, ty);
          const skirt = scene.add
            .image(at.x - ground.width / 2, at.y - fLift, cliffEast)
            .setOrigin(0, 0)
            .setDepth(fDepthOff + PROJECTION.depth(tx + 1, ty + 0.5))
            .setTint(EAST_WALL_TINT)
            .setData('baseTint', EAST_WALL_TINT)
            .setData('shell', true)
            .setData('skirt', true);
          parts.push(skirt);
        }
      }
    }));
  }

  return parts;
}
