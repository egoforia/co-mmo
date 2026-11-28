// Auto-centre: the fit that puts where a picture meets the ground (measured
// by the server from its see-through edges, art-studio/auto-fit.ts) on the
// middle of its tiles' diamond, and trims its size when its foot is far
// wider or narrower than the diamond. One asset from the Offset panel (C),
// or a whole group from the Centre page, each proposal checked before it is
// saved. Free: no model is asked. When the server found its feet (both base
// edges straight enough to read, assets/feet.ts), they are stood on the
// tiles' left, front and right corners instead.

import { FIT_AUTO_SCALE, isoSpan } from '@co-mmo/shared';
import { PROJECTION } from '../projection.ts';
import type { Floor } from '../tile-stand.ts';
import { pictureBox } from './canvas.ts';
import { clampFit, type FitState } from './fit-tool.ts';

/** Where a picture meets the ground, as the server measured it. */
export interface BaseMeasure {
  width: number;
  height: number;
  base: { x: number; y: number; width: number };
  bottom: number;
  sure: 'high' | 'low';
  /** Where its feet are, in its own pixels; an edge is `judged` when straight and long enough to read. */
  feet?: { front: Point; left: MeasuredEdge; right: MeasuredEdge };
  /** For a picture with a footprint: whether its base runs at the tiles' angle and way, in words. */
  verdict?: { ok?: boolean; words: string };
}

/** A point in a picture's own pixels. */
export interface Point {
  x: number;
  y: number;
}

/** One base edge as measured: its outer foot, its slope in degrees, and whether it could be read. */
export interface MeasuredEdge {
  foot: Point;
  degrees: number;
  judged: boolean;
}

/** A foot this share of the diamond's width looks right; one far off it is trimmed. */
const FOOT_SHARE = 0.8;
/** How far off before the size is trimmed: narrower than this share of FOOT_SHARE, or wider than this many times it. */
const TRIM_BELOW = 0.6;
const TRIM_ABOVE = 1.15;

/** The fit that stands a measured picture's foot on the middle of its tiles, or its feet on their corners. */
export function centreFit(m: BaseMeasure, floor: Floor, fitted: boolean, trim: boolean): FitState {
  if (m.feet?.left.judged && m.feet.right.judged) return feetFit(m, m.feet, floor, fitted, trim);
  const box = pictureBox(floor, { width: m.width, height: m.height }, fitted);
  const anchor = box.anchor;
  const foot = { x: box.x + m.base.x * box.scale, y: box.y + m.base.y * box.scale };
  const middle = PROJECTION.toScreen((floor.left + floor.right) / 2, (floor.top + floor.bottom) / 2);
  const wanted = isoSpan(floor.right - floor.left, floor.bottom - floor.top) * FOOT_SHARE;
  const ratio = (m.base.width * box.scale) / wanted;
  const scale = trim && (ratio < TRIM_BELOW || ratio > TRIM_ABOVE) ? Math.max(FIT_AUTO_SCALE.least, Math.min(FIT_AUTO_SCALE.most, 1 / ratio)) : 1;
  // Trimmed about its anchor, the foot moves towards it.
  const trimmed = { x: anchor.x + (foot.x - anchor.x) * scale, y: anchor.y + (foot.y - anchor.y) * scale };
  const per = box.scale * scale;
  return clampFit({ offset: [(middle.x - trimmed.x) / per, (middle.y - trimmed.y) / per], scale });
}

/**
 * The fit that stands a picture's three feet on its tiles' left, front and
 * right corners as nearly as one size and one move can (least squares).
 * The size is only changed for groups that may be trimmed, within
 * FIT_AUTO_SCALE; a picture that needs more keeps its feet as near as it can.
 */
export function feetFit(m: BaseMeasure, feet: NonNullable<BaseMeasure['feet']>, floor: Floor, fitted: boolean, trim: boolean): FitState {
  const box = pictureBox(floor, { width: m.width, height: m.height }, fitted);
  const anchor = box.anchor;
  // Each foot on screen, from the anchor the size is trimmed about.
  const from = [feet.left.foot, feet.front, feet.right.foot].map((p) => ({ x: box.x + p.x * box.scale - anchor.x, y: box.y + p.y * box.scale - anchor.y }));
  const to = [PROJECTION.toScreen(floor.left, floor.bottom), PROJECTION.toScreen(floor.right, floor.bottom), PROJECTION.toScreen(floor.right, floor.top)].map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y }));
  const mean = (ps: Point[]) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length });
  const [mf, mt] = [mean(from), mean(to)];
  let num = 0, den = 0;
  for (let i = 0; i < from.length; i++) {
    const [u, v] = [{ x: from[i]!.x - mf.x, y: from[i]!.y - mf.y }, { x: to[i]!.x - mt.x, y: to[i]!.y - mt.y }];
    num += u.x * v.x + u.y * v.y;
    den += u.x * u.x + u.y * u.y;
  }
  const best = den > 0 ? num / den : 1;
  const scale = trim ? Math.max(FIT_AUTO_SCALE.least, Math.min(FIT_AUTO_SCALE.most, best)) : 1;
  // Trimmed by `scale` about the anchor, then moved: the move that puts the feet's middle on the corners' middle.
  const per = box.scale * scale;
  return clampFit({ offset: [(mt.x - mf.x * scale) / per, (mt.y - mf.y * scale) / per], scale });
}
