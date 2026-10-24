import { isoSpan } from '@co-mmo/shared';
import { PROJECTION } from './projection.ts';

// How a picture stands on the tiles under it in the isometric camera, worked
// out without Phaser: where it goes, how big, and the depth each upright
// strip of it sorts at, so a walker passes behind it or in front of it as
// they stand. Kit houses (kit-house-view.ts), set pieces and furniture all
// stand this way.

/** Tiles in the world a thing stands on, edges in tiles. */
export interface Floor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How wide each upright strip of a picture is, in its own pixels. */
export const STRIP = 32;

/**
 * Where along a run of world points the screen x `x` falls, and the depth
 * there: whatever stands on that spot sorts against the picture as it would
 * against that point of its edges. Past the ends, the end's depth.
 */
export function depthAt(x: number, run: [number, number][]): number {
  const pts = run.map(([wx, wy]) => ({ s: PROJECTION.toScreen(wx, wy).x, wx, wy }));
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (x <= first.s) return PROJECTION.depth(first.wx, first.wy);
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    if (x > b.s) continue;
    const t = (x - a.s) / (b.s - a.s || 1);
    return PROJECTION.depth(a.wx + (b.wx - a.wx) * t, a.wy + (b.wy - a.wy) * t);
  }
  return PROJECTION.depth(last.wx, last.wy);
}

/** Where a picture standing on tiles goes: its bottom-middle anchor, scale, and strips. */
export interface StandingPlan {
  x: number;
  y: number;
  /** How far down the picture its anchor is, 0 to 1. */
  originY: number;
  scale: number;
  /** Columns of the picture, in its own pixels, each with the depth it sorts at; one for the whole picture when it is not cut. */
  strips: { x0: number; width: number; depth: number }[];
}

/**
 * How a picture `size` pixels big stands on `floor`. One painted for the
 * isometric camera (`fitted`) is as wide as the tiles' diamond, its bottom on
 * the diamond's front corner; an older one keeps its own size, centred on the
 * tiles. On one tile it is one picture sorted by its middle; on more, in the
 * isometric camera, upright strips sorted by the near edges (south and east).
 */
export function standing(floor: Floor, size: { width: number; height: number }, fitted: boolean): StandingPlan {
  const { left: L, top: T, right: R, bottom: B } = floor;
  const feet = PROJECTION.stand(L, T, R - L, B - T);
  const middle = PROJECTION.toScreen(feet.x, feet.y);
  const iso = PROJECTION.ground.kind === 'diamond';
  const plan: StandingPlan = fitted && iso
    ? { x: middle.x, y: PROJECTION.toScreen(R, B).y, originY: 1, scale: isoSpan(R - L, B - T) / size.width, strips: [] }
    : { x: middle.x, y: middle.y, originY: 0.92, scale: 1, strips: [] };
  if ((R - L) * (B - T) <= 1 || !iso) {
    plan.strips.push({ x0: 0, width: size.width, depth: PROJECTION.depth(feet.x, feet.y) });
    return plan;
  }
  const run: [number, number][] = [[L, B], [R, B], [R, T]];
  for (let x0 = 0; x0 < size.width; x0 += STRIP) {
    const width = Math.min(STRIP, size.width - x0);
    const at = plan.x + (x0 + width / 2 - size.width / 2) * plan.scale;
    plan.strips.push({ x0, width, depth: depthAt(at, run) });
  }
  return plan;
}
