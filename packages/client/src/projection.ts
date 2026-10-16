import { TILE_PIXELS } from '@co-mmo/shared';

/** A point or step on screen, in game pixels before the camera's zoom. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * How the world is seen. The server and shared rules only know tiles (x to
 * the east, y to the south); this is the one place that turns a tile
 * position into a place on screen and an order to draw in. Swapping the
 * camera, say to isometric, is a new Projection plus art painted for it
 * (the view words in the server's style profile), not a rewrite of the scene.
 * An isometric one would also draw the ground layers as isometric tilemaps
 * (WorldScene.drawRegion) from diamond tiles.
 */
export interface Projection {
  readonly id: string;
  /** Pixels across one tile's art, for sizing sprites and effects. */
  readonly tile: number;
  /** Where world tile position (x, y) falls on screen. */
  toScreen(x: number, y: number): ScreenPoint;
  /** Draw order for something standing at world (x, y): whatever stands lower on screen is drawn in front. */
  depth(x: number, y: number): number;
  /** The screen rectangle covering tiles from (left, top) to (right, bottom), for the camera's bounds. */
  bounds(left: number, top: number, right: number, bottom: number): { x: number; y: number; width: number; height: number };
  /** The world step for the arrow keys held (each -1, 0 or 1), so up on screen walks up on screen. */
  inputToWorld(dx: number, dy: number): { dx: number; dy: number };
}

/** The launch camera: looking straight down at the ground, with sprites painted in three-quarter view. */
export const TOP_DOWN: Projection = {
  id: 'top-down',
  tile: TILE_PIXELS,
  toScreen: (x, y) => ({ x: x * TILE_PIXELS, y: y * TILE_PIXELS }),
  depth: (_x, y) => y * TILE_PIXELS,
  bounds: (left, top, right, bottom) => ({ x: left * TILE_PIXELS, y: top * TILE_PIXELS, width: (right - left) * TILE_PIXELS, height: (bottom - top) * TILE_PIXELS }),
  inputToWorld: (dx, dy) => ({ dx, dy }),
};

/** The camera the game is drawn with. */
export const PROJECTION: Projection = TOP_DOWN;
