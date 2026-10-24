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
): (Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer)[] {
  const ground = PROJECTION.ground;
  const face = wallFaceKey(scene, style, art);
  if (!face) return [];
  const storeyRise = Math.round(ground.height * 2.0);
  const cutRise = Math.round(ground.height * WALL_RISE);
  const lift = floorLift(floor);
  const depthOff = floorDepthOffset(floor);
  const fullSouth = registerWallFace(scene, face, 'south', ground.width, ground.height, storeyRise);
  const fullEast = registerWallFace(scene, face, 'east', ground.width, ground.height, storeyRise);
  const lowSouth = cutaway ? registerWallFace(scene, face, 'south', ground.width, ground.height, cutRise) : fullSouth;
  const lowEast = cutaway ? registerWallFace(scene, face, 'east', ground.width, ground.height, cutRise) : fullEast;
  if (!fullSouth || !fullEast || !lowSouth || !lowEast) return [];

  const wall = (x: number, y: number) => rows[y]?.[x] === Tile.Wall;
  const open = (x: number, y: number) => (rows[y]?.[x] === undefined ? outward : !wall(x, y));
  const indoor = (x: number, y: number) => rows[y]?.[x] !== undefined && rows[y]![x] !== Tile.Wall;
  // Far North/West walls (with no indoor floor to their North/West, and indoor floor to their South/East) stand tall;
  // near South/East walls and South/East corridor flanks cut low.
  const isFull = (x: number, y: number) =>
    !cutaway ||
    (!indoor(x, y - 1) && !indoor(x - 1, y) && !indoor(x - 1, y - 1) && (indoor(x, y + 1) || indoor(x + 1, y) || indoor(x + 1, y + 1)));

  const parts: (Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer)[] = [];
  const tilesetKey = registerKitTileset(scene, style, art);
  const halfGround = { width: ground.width / 2, height: ground.height / 2 };
  const halfTileset = registerDiamondTileset(scene, tilesetKey, halfGround.width, halfGround.height);
  const atTop = PROJECTION.toScreen(left, top);
  const h = rows.length;
  const w = rows[0]?.length ?? 0;

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
          if (!wall(x, y) || isFull(x, y) !== wantFull) continue;
          any = true;
          halfRows[y * 2 + 1]![x * 2 + 1] = Tile.Wall;
          if (open(x, y + 1) || wall(x - 1, y) || rows[y]?.[x - 1] === Tile.Door || (!wall(x, y - 1) && !wall(x, y + 1))) {
            halfRows[y * 2 + 1]![x * 2] = Tile.Wall;
          }
          if (open(x + 1, y) || wall(x, y - 1) || rows[y - 1]?.[x] === Tile.Door || (!wall(x - 1, y) && !wall(x + 1, y))) {
            halfRows[y * 2]![x * 2 + 1] = Tile.Wall;
          }
        }
      }
      if (!any) return;
      const cap = diamondLayer(scene, halfRows, atTop, halfTileset, halfGround).setDepth(depth).setData('shell', true);
      cap.y -= lift + rise;
      tilemaps.push(cap.tilemap);
      parts.push(cap);
    };
    makeHalfCap(true, storeyRise, depthOff - 0.3);
    if (cutaway) makeHalfCap(false, cutRise, depthOff - 0.4);
  }

  rows.forEach((row, y) => row.forEach((_, x) => {
    if (!wall(x, y)) return;
    const [tx, ty] = [left + x, top + y];
    const full = isFull(x, y);
    const rise = full ? storeyRise : cutRise;
    const southKey = full ? fullSouth : lowSouth;
    const eastKey = full ? fullEast : lowEast;
    if (open(x, y + 1) || (full && wall(x, y + 1) && !isFull(x, y + 1))) {
      const at = PROJECTION.toScreen(tx, ty + 1);
      const img = scene.add.image(at.x, at.y - lift - rise, southKey).setOrigin(0, 0).setDepth(depthOff + PROJECTION.depth(tx + 0.5, ty + 1)).setData('shell', true);
      parts.push(img);
    }
    if (open(x + 1, y) || (full && wall(x + 1, y) && !isFull(x + 1, y))) {
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
  return parts;
}
