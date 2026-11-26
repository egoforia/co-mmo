// Where a picture meets the ground, read from its see-through edges, for the
// Studio's auto-centre (art-studio/fit-tool.ts in the browser turns it into
// an offset, since the browser knows how the game stands a picture). Free:
// no model is asked. The ground contact is the lowest band of solid pixels,
// ignoring specks narrower than 3 % of the widest row (a stray leaf, a
// shadow's edge), and its middle is what goes on the middle of the tiles.

import sharp from 'sharp';

/** How solid a pixel must be to count, of 255. */
const SOLID = 32;
/** A run of solid pixels narrower than this share of the widest row is a speck. */
const SPECK = 0.03;
/** The ground band: this share of the solid height, from the lowest solid row up. */
const BAND = 0.12;

/** Where a picture meets the ground, in its own pixels. */
export interface BaseMeasure {
  width: number;
  height: number;
  /** The middle of the ground band, and its width. */
  base: { x: number; y: number; width: number };
  /** The lowest solid row. */
  bottom: number;
  /** How sure the reading is: low when the band is broken into several pieces. */
  sure: 'high' | 'low';
}

/** Solid runs in each row of an alpha channel, specks left out. */
function rows(alpha: Uint8Array, width: number, height: number): [number, number][][] {
  const all: [number, number][][] = [];
  let widest = 0;
  for (let y = 0; y < height; y++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const solid = x < width && alpha[y * width + x]! >= SOLID;
      if (solid && start < 0) start = x;
      if (!solid && start >= 0) {
        runs.push([start, x]);
        start = -1;
      }
    }
    if (runs.length) widest = Math.max(widest, runs[runs.length - 1]![1] - runs[0]![0]);
    all.push(runs);
  }
  const least = Math.max(1, widest * SPECK);
  return all.map((runs) => runs.filter(([a, b]) => b - a >= least));
}

/**
 * Where a picture's alpha channel meets the ground; undefined when it has
 * no see-through edges to read (a full-bleed picture), or nothing solid.
 */
export function measureAlpha(alpha: Uint8Array, width: number, height: number): BaseMeasure | undefined {
  // A picture with solid corners has no edges to read.
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  if (corners.every((i) => alpha[i]! >= SOLID)) return undefined;
  const solid = rows(alpha, width, height);
  const filled = solid.map((r, y) => (r.length ? y : -1)).filter((y) => y >= 0);
  if (!filled.length) return undefined;
  const top = filled[0]!;
  const bottom = filled[filled.length - 1]!;
  const bandTop = Math.max(top, Math.round(bottom - (bottom - top + 1) * BAND));
  let left = Infinity, right = -Infinity, pieces = 0, counted = 0;
  for (let y = bandTop; y <= bottom; y++) {
    const runs = solid[y]!;
    if (!runs.length) continue;
    counted++;
    pieces = Math.max(pieces, runs.length);
    left = Math.min(left, runs[0]![0]);
    right = Math.max(right, runs[runs.length - 1]![1]);
  }
  if (!counted) return undefined;
  return {
    width,
    height,
    base: { x: (left + right) / 2, y: (bandTop + bottom + 1) / 2, width: right - left },
    bottom: bottom + 1,
    sure: pieces > 2 ? 'low' : 'high',
  };
}

/** Where a PNG picture meets the ground. */
export async function measureBase(png: Buffer): Promise<BaseMeasure | undefined> {
  const { data, info } = await sharp(png).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  return measureAlpha(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height);
}
