import { ISO_TILE, ISO_WAYS, TILE_PIXELS, WALK_DIRECTIONS, facingSide, isWalkDirection, walkDirection, type Facing, type IsoWay } from '@co-mmo/shared';

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
  /** The world step for the arrow keys held (each -1, 0 or 1): each key walks towards its side of the screen. */
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
  /** The ways walkers are painted facing for this camera. */
  readonly ways: readonly Facing[];
  /** Which of its ways someone stepping (dx, dy) along the grid faces; standing still keeps `before`. */
  face(dx: number, dy: number, before: Facing): Facing;
}

/** The launch camera, retired on 2026-10-20: looking straight down at the ground, with sprites painted in three-quarter view. Kept only for the Owner's comparisons until the lands are repainted. */
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
  ways: WALK_DIRECTIONS,
  face: (dx, dy, before) => walkDirection(dx, dy, isWalkDirection(before) ? before : 'front'),
};

/** Half a ground diamond across and down: each tile is drawn 160 by 80 pixels (ISO_TILE). */
const HALF_W = ISO_TILE.width / 2;
const HALF_H = ISO_TILE.height / 2;

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
  // Each key walks along the grid, as the tiles' edges run: Down is south
  // (down and to the left), Right east, Up north, Left west. Two keys
  // together walk straight across the screen.
  inputToWorld: (dx, dy) => ({ dx, dy }),
  ground: { kind: 'diamond', width: HALF_W * 2, height: HALF_H * 2 },
  // Seen from a corner, a thing stands on the middle of the tiles it covers.
  stand: (left, top, width, height) => ({ x: left + width / 2, y: top + height / 2 }),
  ways: ISO_WAYS,
  face: isoFace,
};

/**
 * Which isometric way someone stepping (dx, dy) on the grid faces: the way
 * along the grid line nearest their step. A step halfway between two ways,
 * straight up, down, left or right on screen, keeps whichever of the two
 * they faced; turning from another way, it keeps their side going up or
 * down (back-left becomes front-left) and their front or back going left
 * or right (front-left becomes front-right).
 */
function isoFace(dx: number, dy: number, before: Facing): Facing {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return before;
  // Eighths of a turn from east, clockwise (y runs south): even ones lie along the grid.
  const eighth = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  const along: Record<number, IsoWay> = { 0: 'front-right', 2: 'front-left', 4: 'back-left', 6: 'back-right' };
  if (along[eighth]) return along[eighth]!;
  const [a, b] = [along[(eighth + 7) % 8]!, along[(eighth + 1) % 8]!];
  if (before === a || before === b) return before;
  // Straight down (south-east) or up (north-west) on screen: keep the side. Right (north-east) or left (south-west): keep front or back.
  const vertical = eighth === 1 || eighth === 5;
  const keep = (w: IsoWay) => (vertical ? facingSide(w) === facingSide(before) : w.startsWith(before.startsWith('back') ? 'back' : 'front'));
  return keep(a) ? a : keep(b) ? b : a;
}

/** Every camera, by id. */
export const PROJECTIONS: Record<string, Projection> = { [TOP_DOWN.id]: TOP_DOWN, [ISOMETRIC.id]: ISOMETRIC };

/**
 * The camera the game is drawn with: isometric for everyone. The Owner may
 * still look through the old top-down camera until its code is taken out.
 */
export let PROJECTION: Projection = ISOMETRIC;

/** Chooses the camera before the world is drawn; the scene reads it as it draws. */
export function setProjection(p: Projection): void {
  PROJECTION = p;
}
