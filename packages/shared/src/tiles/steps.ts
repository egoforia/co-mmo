import { wallOn, type WallSide } from '../edge-walls.ts';
import { isBlocking, tileAt, type RegionMap } from '../world.ts';
import { DIAGONAL_COST, isDiagonal, squareTiles, stepped, type StepWay, type TileSpot } from './grid.ts';

// Whether a body may take a step, and how long it takes. The land decides
// (blocking tiles, walls on tile sides); who else stands where is the claims'
// business (claims.ts).

/**
 * True when a body can stand on this tile of a floor: nothing solid fills it,
 * or it is a ramp's head (floors/ramps.ts), stepped onto from the floor above
 * with no floor under it, and left at once down the ramp.
 */
export function openTile(map: RegionMap, tx: number, ty: number, floor = 0): boolean {
  return !isBlocking(tileAt(map, tx + 0.5, ty + 0.5, floor)) || rampHead(map, tx, ty, floor);
}

/** True when a ramp's head is on this tile of a floor. */
function rampHead(map: RegionMap, tx: number, ty: number, floor: number): boolean {
  for (const s of map.stairways ?? []) if (s.ramp && s.upper === floor && s.ramp.head.x === tx && s.ramp.head.y === ty) return true;
  return false;
}

/** True when every tile of a `width`-wide square is open. */
export function openSquare(map: RegionMap, anchor: TileSpot, width = 1, floor = 0): boolean {
  return squareTiles(anchor, width).every((t) => openTile(map, t.tx, t.ty, floor));
}

/** True when a straight step leaves the square through a wall on one of its leading tiles' sides. */
function wallAhead(map: RegionMap, anchor: TileSpot, way: StepWay, width: number, floor: number): boolean {
  if (!map.edgeWalls?.length) return false;
  const side: WallSide = way.dx > 0 ? 'east' : way.dx < 0 ? 'west' : way.dy > 0 ? 'south' : 'north';
  for (let i = 0; i < width; i++) {
    const tx = way.dx > 0 ? anchor.tx + width - 1 : way.dx < 0 ? anchor.tx : anchor.tx + i;
    const ty = way.dy > 0 ? anchor.ty + width - 1 : way.dy < 0 ? anchor.ty : anchor.ty + i;
    if (wallOn(map, tx, ty, side, floor)) return true;
  }
  return false;
}

function straightStep(map: RegionMap, anchor: TileSpot, way: StepWay, width: number, floor: number): boolean {
  return !wallAhead(map, anchor, way, width, floor) && openSquare(map, stepped(anchor, way), width, floor);
}

/**
 * True when a `width`-wide body at `anchor` may step `way` on the land. A
 * diagonal step needs both straight ways round the corner open, so nobody
 * slips between two trees touching at a corner or past the end of a wall.
 */
export function canStep(map: RegionMap, anchor: TileSpot, way: StepWay, width = 1, floor = 0): boolean {
  if (!isDiagonal(way)) return straightStep(map, anchor, way, width, floor);
  const across = { dx: way.dx, dy: 0 } as const;
  const down = { dx: 0, dy: way.dy } as const;
  return (
    straightStep(map, anchor, across, width, floor) &&
    straightStep(map, stepped(anchor, across), down, width, floor) &&
    straightStep(map, anchor, down, width, floor) &&
    straightStep(map, stepped(anchor, down), across, width, floor)
  );
}

/** Seconds one step takes at `speed` tiles a second (as fast as statuses allow: `pace`); Infinity when held still. */
export function stepSeconds(speed: number, way: StepWay, pace = 1): number {
  if (speed <= 0 || pace <= 0) return Infinity;
  return (isDiagonal(way) ? DIAGONAL_COST : 1) / (speed * pace);
}
