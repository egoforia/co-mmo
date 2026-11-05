import { PROJECTION } from '../projection.ts';

/**
 * Draw order in the isometric camera. Phaser draws lower depths first. An
 * upright thing sorts at `PROJECTION.depth(x, y) = (x + y) * 40` of its feet,
 * which goes below zero north-west of the world's origin (Frostpeak, the
 * Woods, Mushroom Hollow), so nothing here may assume depths are positive.
 */

/** Depth of name labels, health bars and other marks that always draw on top of the world. */
export const LABEL_DEPTH = 1_000_000;
/** Depth offset between stacked upper storeys so upper floors always draw in front of lower floors. */
export const FLOOR_DEPTH = 50_000;
/**
 * Depth of the ground terrain layer on floor 0, below all buildings and upright scenery.
 * Holds while `x + y > GROUND_DEPTH / 40` (about -12,500 tiles, some 48 regions out).
 */
export const GROUND_DEPTH = -500_000;

/** Vertical screen lift (in pixels) for an upper floor (`floor > 0`) in the isometric camera. */
export function floorLift(floor: number): number {
  const ground = PROJECTION.ground;
  if (ground.kind !== 'diamond' || floor <= 0) return 0;
  return Math.round(ground.height * 2.0) * floor;
}

/** Depth offset for an upper floor (`floor > 0`) so upper storeys sort cleanly above lower storeys. */
export function floorDepthOffset(floor: number): number {
  if (PROJECTION.ground.kind !== 'diamond' || floor <= 0) return 0;
  return floor * FLOOR_DEPTH;
}

/**
 * Depth of a flat layer whose top (north) corner is world tile (left, top) on
 * `floor`: just under anything standing on it, since every tile of a flat
 * layer has `x + y` at least `left + top`. `below` keeps a few flat layers at
 * one corner in order (bigger draws first).
 */
function flatDepth(left: number, top: number, floor: number, below: number): number {
  return floorDepthOffset(floor) + PROJECTION.depth(left, top) - below;
}

/** Depth of a building's or storey's floor tiles, under its wall caps and everything inside. */
export function roomFloorDepth(left: number, top: number, floor: number): number {
  return flatDepth(left, top, floor, 0.5);
}

/** Depth of the flat tops on a room's walls: `full` for tall far walls, else the low cut near walls. */
export function wallCapDepth(left: number, top: number, floor: number, full: boolean): number {
  return flatDepth(left, top, floor, full ? 0.3 : 0.4);
}
