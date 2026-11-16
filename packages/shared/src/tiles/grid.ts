import type { CreatureSizeTier } from '../walk.ts';

// The tile grid everything that moves stands on (docs/combat.md, Moving on
// tiles): a body stands on a square of tiles, `width` wide, named by its
// north-west tile (its anchor), and moves one tile at a time in one of eight
// ways. Positions stay numbers in tiles; a body standing still is at the
// middle of its square.

/** A tile on the grid, by its column and row. */
export interface TileSpot {
  tx: number;
  ty: number;
}

/** One step: each part -1, 0 or 1, never both 0. */
export interface StepWay {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

/** The eight ways a body can step, straight ones first. */
export const STEP_WAYS: readonly StepWay[] = [
  { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
  { dx: 1, dy: -1 }, { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
];

/** A diagonal step takes this many times as long as a straight one. */
export const DIAGONAL_COST = 1.4;

/** How many tiles wide a body of each size stands: big monsters can't follow through a one-tile door. */
export const SIZE_TILES: Record<CreatureSizeTier, number> = { tiny: 1, small: 1, medium: 1, high: 2, colossal: 3 };

/** True when a step goes corner to corner. */
export function isDiagonal(way: StepWay): boolean {
  return way.dx !== 0 && way.dy !== 0;
}

/** The tile a point lies in. */
export function tileUnder(x: number, y: number): TileSpot {
  return { tx: Math.floor(x), ty: Math.floor(y) };
}

/** The middle of a body's square, `width` tiles wide, whose north-west tile is `anchor`. */
export function spotMiddle(anchor: TileSpot, width = 1): { x: number; y: number } {
  return { x: anchor.tx + width / 2, y: anchor.ty + width / 2 };
}

/** The anchor of a `width`-wide square whose middle is nearest a point: where a body standing there is put. */
export function anchorNear(x: number, y: number, width = 1): TileSpot {
  return { tx: Math.round(x - width / 2), ty: Math.round(y - width / 2) };
}

/** Every tile of a `width`-wide square, row by row. */
export function squareTiles(anchor: TileSpot, width = 1): TileSpot[] {
  const out: TileSpot[] = [];
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) out.push({ tx: anchor.tx + x, ty: anchor.ty + y });
  return out;
}

/** The anchor one step on. */
export function stepped(anchor: TileSpot, way: StepWay): TileSpot {
  return { tx: anchor.tx + way.dx, ty: anchor.ty + way.dy };
}

/** The way an input (any numbers) points, rounded to one of the eight; undefined for no input. */
export function wayOf(dx: number, dy: number): StepWay | undefined {
  const len = Math.hypot(dx, dy);
  if (len === 0) return undefined;
  // Round the angle to the nearest eighth of a turn, so a slightly crooked stick still walks straight.
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const sx = Math.round(Math.cos(a));
  const sy = Math.round(Math.sin(a));
  return { dx: (sx || 0) as StepWay['dx'], dy: (sy || 0) as StepWay['dy'] };
}

/**
 * Tiles between two squares, counting a diagonal as one (Chebyshev): 1 means
 * they touch, side or corner. 0 when they overlap.
 */
export function tilesApart(a: TileSpot, aWidth: number, b: TileSpot, bWidth: number): number {
  const gapX = Math.max(b.tx - (a.tx + aWidth - 1), a.tx - (b.tx + bWidth - 1), 0);
  const gapY = Math.max(b.ty - (a.ty + aWidth - 1), a.ty - (b.ty + bWidth - 1), 0);
  return Math.max(gapX, gapY);
}
