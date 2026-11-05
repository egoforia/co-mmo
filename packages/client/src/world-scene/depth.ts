import { PROJECTION } from '../projection.ts';

export const LABEL_DEPTH = 1_000_000;
/** Depth offset between stacked upper storeys so upper floors always draw in front of lower floors. */
export const FLOOR_DEPTH = 50_000;
/** Depth of the ground terrain layer on floor 0, below all buildings and upright scenery. */
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
