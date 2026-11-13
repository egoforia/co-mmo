import type Phaser from 'phaser';
import { FALLBACK_BUILDING_STYLE, type EdgeWall, type RegionMap } from '@co-mmo/shared';
import { PROJECTION } from '../projection.ts';
import { registerWallFace } from '../textures.ts';
import { EAST_WALL_TINT, floorDepthOffset, floorLift } from './types.ts';
import { wallFaceKey } from './walls.ts';

// Walls on one side of a tile (the world editor's Wall tool, edge-walls.ts in
// shared): each stands upright on its edge as one face of its building look's
// painted wall texture, the same faces a building's walls are made of
// (registerWallFace). A wall in front of us turns see-through, so it never
// hides the player behind it.

/** One wall as drawn. */
export interface EdgeWallView {
  wall: EdgeWall;
  image: Phaser.GameObjects.Image;
}

/** How see-through a wall in front of us is. */
const SEE_THROUGH = 0.35;
/** The screen space a standing figure takes above its feet, in pixels. */
const FIGURE = { halfWidth: 28, height: 150 };

/** How tall a wall stands, in screen pixels. */
function riseOf(wall: EdgeWall): number {
  const ground = PROJECTION.ground;
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
    const face = wallFaceKey(scene, wall.style) ?? wallFaceKey(scene, FALLBACK_BUILDING_STYLE);
    if (!face) continue;
    const rise = riseOf(wall);
    const across = wall.along === 'h';
    const key = registerWallFace(scene, face, across ? 'south' : 'east', ground.width, ground.height, rise);
    if (!key) continue;
    const [x, y] = [ox + wall.x, oy + wall.y];
    const at = PROJECTION.toScreen(x, y);
    const image = scene.add
      .image(across ? at.x : at.x - ground.width / 2, at.y - floorLift(wall.floor) - rise, key)
      .setOrigin(0, 0)
      .setDepth(floorDepthOffset(wall.floor) + (across ? PROJECTION.depth(x + 0.5, y) : PROJECTION.depth(x, y + 0.5)))
      .setData('edgeWall', true);
    if (!across) image.setTint(EAST_WALL_TINT).setData('baseTint', EAST_WALL_TINT);
    views.push({ wall, image });
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
  for (const { wall, image } of walls) {
    const box = image.getBounds();
    // In front means drawn after us on our floor, and over any of the space our figure stands in (about a storey tall above our feet, a body wide).
    const front = wall.floor === floor && image.depth - floorDepthOffset(floor) > myDepth
      && me.x + FIGURE.halfWidth > box.left && me.x - FIGURE.halfWidth < box.right && meY > box.top && meY - FIGURE.height < box.bottom;
    image.setAlpha(front ? SEE_THROUGH : 1);
  }
}
