import { wayOf, type StepWay, type TileSpot } from './grid.ts';

// Which way a walker faces on tiles (egoforia, 2026-11-24): it turns as a
// step begins, to the way of that step, and keeps facing it until the step
// is done, whatever is pressed meanwhile, so nobody turns halfway between
// two tiles. Standing on a tile, pressing a way turns it that way (towards a
// taken tile that is all it does). A melee blow lands only on whoever
// stands on the tiles straight ahead of that way.

/** A unit step the way an input points, rounded to one of the eight; undefined for no input. */
function unit(dx: number, dy: number): { dx: number; dy: number } | undefined {
  const way = wayOf(dx, dy);
  if (!way) return undefined;
  const len = Math.hypot(way.dx, way.dy);
  return { dx: way.dx / len, dy: way.dy / len };
}

/**
 * The way a walker faces after a tick of input (`dx`, `dy`): `from` is the
 * tile it stood on or was stepping onto before the tick, `before` the tile
 * it was stepping onto then and `after` the one it steps onto now. A step
 * begun this tick sets it; one still under way keeps it; standing, the
 * input does.
 */
export function faceAfterTick(
  facing: { dx: number; dy: number } | undefined,
  from: TileSpot,
  before: TileSpot | undefined,
  after: TileSpot | undefined,
  dx: number,
  dy: number,
): { dx: number; dy: number } | undefined {
  if (after) {
    const begun = !before || before.tx !== after.tx || before.ty !== after.ty;
    // A step begun this tick starts from where it stood, or from the tile the last step reached.
    if (begun) return unit(after.tx - from.tx, after.ty - from.ty) ?? facing;
    return facing;
  }
  return unit(dx, dy) ?? facing;
}

/** The one of the eight ways a facing points along the grid (east when it faces nowhere yet). */
export function facedWay(facing: { dx: number; dy: number } | undefined): StepWay {
  return (facing && wayOf(facing.dx, facing.dy)) || { dx: 1, dy: 0 };
}

/** The tiles straight ahead of one, the way it faces, `reach` of them, nearest first. */
export function tilesAhead(from: TileSpot, facing: { dx: number; dy: number } | undefined, reach = 1): TileSpot[] {
  const way = facedWay(facing);
  return Array.from({ length: Math.max(1, reach) }, (_, i) => ({ tx: from.tx + way.dx * (i + 1), ty: from.ty + way.dy * (i + 1) }));
}

/** True when a `width`-wide square stands on one of the `reach` tiles straight ahead of `from`, the way it faces. */
export function facesSquare(from: TileSpot, facing: { dx: number; dy: number } | undefined, anchor: TileSpot, width = 1, reach = 1): boolean {
  return tilesAhead(from, facing, reach).some((t) => t.tx >= anchor.tx && t.tx < anchor.tx + width && t.ty >= anchor.ty && t.ty < anchor.ty + width);
}
