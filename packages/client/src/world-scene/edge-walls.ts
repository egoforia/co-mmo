import type Phaser from 'phaser';
import { FALLBACK_BUILDING_STYLE, storeyAt, type EdgeWall, type RegionMap } from '@co-mmo/shared';
import { PROJECTION } from '../projection.ts';
import { registerWallCopingCap, registerWallFace } from '../textures.ts';
import { EAST_WALL_TINT, WALL_RISE, floorDepthOffset, floorLift } from './types.ts';
import { wallFaceKey } from './walls.ts';

// Walls on one side of a tile (the world editor's Wall tool, edge-walls.ts in
// shared): each stands upright on its edge as one face of its building look's
// painted wall texture, the same faces a building's walls are made of
// (registerWallFace), capped with a 1/8-tile coping stone. A wall in front of
// us turns see-through, so it never hides the player behind it.

/** One wall as drawn. */
export interface EdgeWallView {
  wall: EdgeWall;
  image: Phaser.GameObjects.Image;
  cap?: Phaser.GameObjects.Image;
}

/** How see-through a wall in front of us is. */
const SEE_THROUGH = 0.35;
/** The screen space a standing figure takes above its feet, in pixels. */
const FIGURE = { halfWidth: 28, height: 150 };

/** How tall a wall stands, in screen pixels. */
function riseOf(wall: EdgeWall): number {
  const ground = PROJECTION.ground;
  if (wall.height === 'low') return Math.round(ground.height * WALL_RISE);
  return Math.round(ground.height * (wall.height === 'half' ? 1 : 2));
}

/**
 * Stands a land's walls at its square in the world (`ox`, `oy` in tiles). A
 * wall running east-west shows its south face, one running north-south its
 * east face, each sorted at the middle of its edge like a building's walls.
 * A look not painted yet borrows the fallback look's wall.
 */
export function standEdgeWalls(scene: Phaser.Scene, map: RegionMap, ox: number, oy: number): EdgeWallView[] {
  const ground = PROJECTION.ground;
  const views: EdgeWallView[] = [];
  for (const wall of map.edgeWalls ?? []) {
    if (wall.height === 'low' && wall.floor) {
      const across = wall.along === 'h';
      const tx = across ? wall.x : wall.x - 1;
      const ty = across ? wall.y - 1 : wall.y;
      if (storeyAt(map, tx, ty, wall.floor + 1)) continue;
    }
    const face = wallFaceKey(scene, wall.style) ?? wallFaceKey(scene, FALLBACK_BUILDING_STYLE);
    if (!face) continue;
    const rise = riseOf(wall);
    const across = wall.along === 'h';
    const side = across ? 'south' : 'east';
    const key = registerWallFace(scene, face, side, ground.width, ground.height, rise);
    if (!key) continue;
    const [x, y] = [ox + wall.x, oy + wall.y];
    const at = PROJECTION.toScreen(x, y);
    const depth = floorDepthOffset(wall.floor) + (across ? PROJECTION.depth(x + 0.5, y) : PROJECTION.depth(x, y + 0.5));
    const image = scene.add
      .image(across ? at.x : at.x - ground.width / 2, at.y - floorLift(wall.floor) - rise, key)
      .setOrigin(0, 0)
      .setDepth(depth)
      .setData('edgeWall', true);
    if (!across) image.setTint(EAST_WALL_TINT).setData('baseTint', EAST_WALL_TINT);

    const capKey = registerWallCopingCap(scene, face, side, ground.width, ground.height);
    let cap: Phaser.GameObjects.Image | undefined;
    if (capKey) {
      const tw = Math.round((ground.width / 2) * (1 / 8));
      cap = scene.add
        .image(across ? at.x - tw : at.x - ground.width / 2, at.y - floorLift(wall.floor) - rise, capKey)
        .setOrigin(0, 0)
        .setDepth(depth + 0.1)
        .setData('edgeWall', true);
      if (!across) cap.setTint(EAST_WALL_TINT).setData('baseTint', EAST_WALL_TINT);
    }
    views.push({ wall, image, cap });
  }
  return views;
}

/**
 * Turns see-through each wall standing in front of the player at world tile
 * (x, y) on `floor` and over them on the screen, and solid again the rest.
 */
export function seeThroughWalls(walls: EdgeWallView[], x: number, y: number, floor: number): void {
  if (!walls.length) return;
  const me = PROJECTION.toScreen(x, y);
  const myDepth = PROJECTION.depth(x, y);
  const meY = me.y - floorLift(floor);
  for (const { wall, image, cap } of walls) {
    // In front means drawn after us on our floor, and over any of the space our figure stands in (about a storey tall above our feet, a body wide).
    // Its box is measured only for walls on our floor and in front: this runs every frame for every wall.
    const box = wall.floor === floor && image.depth - floorDepthOffset(floor) > myDepth ? image.getBounds() : undefined;
    const front = Boolean(box) && me.x + FIGURE.halfWidth > box!.left && me.x - FIGURE.halfWidth < box!.right && meY > box!.top && meY - FIGURE.height < box!.bottom;
    const alpha = front ? SEE_THROUGH : 1;
    if (image.alpha !== alpha) image.setAlpha(alpha);
    if (cap && cap.alpha !== alpha) cap.setAlpha(alpha);
  }
}
