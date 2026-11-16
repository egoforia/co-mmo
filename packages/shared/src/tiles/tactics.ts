import { tilesApart, type TileSpot } from './grid.ts';

// Where you stand in a fight (docs/combat.md, Rules): two who stand on
// opposite sides of a monster flank it, and a step away from a monster
// that is fighting you gives it a free swing.

/** A monster struck while flanked takes this much more (a share of the blow). */
export const FLANK_BONUS = 0.15;

/** Which side of a `width`-wide square a tile lies on, along each axis: -1 before it, 1 after it, 0 alongside. */
function sideOf(anchor: TileSpot, width: number, t: TileSpot): { x: number; y: number } {
  const along = (v: number, lo: number) => (v < lo ? -1 : v > lo + width - 1 ? 1 : 0);
  return { x: along(t.tx, anchor.tx), y: along(t.ty, anchor.ty) };
}

/**
 * True when two tiles touch a square on opposite sides: straight across
 * (west and east, north and south) or corner to corner. Each side one of
 * them stands past, the other stands past the other way; alongside, both are.
 */
export function flanks(anchor: TileSpot, width: number, a: TileSpot, b: TileSpot): boolean {
  if (tilesApart(anchor, width, a, 1) !== 1 || tilesApart(anchor, width, b, 1) !== 1) return false;
  const sa = sideOf(anchor, width, a);
  const sb = sideOf(anchor, width, b);
  return sa.x === -sb.x && sa.y === -sb.y;
}
