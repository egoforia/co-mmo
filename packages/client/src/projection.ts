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
 * camera is a new Projection plus art painted for it (the view words in the
 * server's style profile), not a rewrite of the scene.
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
  /**
   * How the ground's tiles are laid: the painted square tiles as they are,
   * or turned 45 degrees and squashed into diamonds `width` by `height`.
   */
  readonly ground: { kind: 'square' | 'diamond'; width: number; height: number };
  /**
   * Where a tree, rock or set piece standing on the tiles from (left, top),
   * `width` by `height`, has its feet: the world point it is drawn at and
   * sorted by.
   */
  stand(left: number, top: number, width: number, height: number): { x: number; y: number };
}

/** The launch camera: looking straight down at the ground, with sprites painted in three-quarter view. */
export const TOP_DOWN: Projection = {
  id: 'top-down',
  tile: TILE_PIXELS,
  toScreen: (x, y) => ({ x: x * TILE_PIXELS, y: y * TILE_PIXELS }),
  depth: (_x, y) => y * TILE_PIXELS,
  bounds: (left, top, right, bottom) => ({ x: left * TILE_PIXELS, y: top * TILE_PIXELS, width: (right - left) * TILE_PIXELS, height: (bottom - top) * TILE_PIXELS }),
  inputToWorld: (dx, dy) => ({ dx, dy }),
  ground: { kind: 'square', width: TILE_PIXELS, height: TILE_PIXELS },
  // Seen from above, a thing's feet are on the south edge of the tiles it stands on.
  stand: (left, top, width, height) => ({ x: left + width / 2, y: top + height }),
};

/** Half a ground diamond across and down: each tile is drawn 160 by 80 pixels. */
const HALF_W = 80;
const HALF_H = 40;

/**
 * The isometric camera (the camera plan of 2026-10-18): turned 45 degrees
 * and looking down 30, like the building kit, with the world's south-east
 * nearest. North runs up and to the right, east down and to the right.
 * Underneath, the world is the same square grid.
 */
export const ISOMETRIC: Projection = {
  id: 'isometric',
  tile: HALF_W * 2,
  toScreen: (x, y) => ({ x: (x - y) * HALF_W, y: (x + y) * HALF_H }),
  depth: (x, y) => (x + y) * HALF_H,
  bounds: (left, top, right, bottom) => {
    // The corners of the square of tiles are the diamond's left, top, right and bottom.
    const x = (left - bottom) * HALF_W;
    const y = (left + top) * HALF_H;
    return { x, y, width: (right - top) * HALF_W - x, height: (right + bottom) * HALF_H - y };
  },
  // Up on screen is north-west on the grid; up with right is due north.
  inputToWorld: (dx, dy) => ({ dx: Math.sign(dx + dy), dy: Math.sign(dy - dx) }),
  ground: { kind: 'diamond', width: HALF_W * 2, height: HALF_H * 2 },
  // Seen from a corner, a thing stands on the middle of the tiles it covers.
  stand: (left, top, width, height) => ({ x: left + width / 2, y: top + height / 2 }),
};

/** Every camera, by id. */
export const PROJECTIONS: Record<string, Projection> = { [TOP_DOWN.id]: TOP_DOWN, [ISOMETRIC.id]: ISOMETRIC };

/**
 * The camera the game is drawn with: top-down for everyone, until the
 * isometric one is switched on (only the Owner can, as a preview).
 */
export let PROJECTION: Projection = TOP_DOWN;

/** Chooses the camera before the world is drawn; the scene reads it as it draws. */
export function setProjection(p: Projection): void {
  PROJECTION = p;
}
