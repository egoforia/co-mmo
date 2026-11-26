// Auto-centre: the fit that puts where a picture meets the ground (measured
// by the server from its see-through edges, art-studio/auto-fit.ts) on the
// middle of its tiles' diamond, and trims its size when its foot is far
// wider or narrower than the diamond. One asset from the Offset panel (C),
// or a whole group from the Centre page, each proposal checked before it is
// saved. Free: no model is asked.

import { FIT_SCALE, isoSpan } from '@co-mmo/shared';
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
}

/** A foot this share of the diamond's width looks right; one far off it is trimmed. */
const FOOT_SHARE = 0.8;
/** How far off before the size is trimmed: narrower than this share of FOOT_SHARE, or wider than this many times it. */
const TRIM_BELOW = 0.6;
const TRIM_ABOVE = 1.15;

/** The fit that stands a measured picture's foot on the middle of its tiles. */
export function centreFit(m: BaseMeasure, floor: Floor, fitted: boolean, trim: boolean): FitState {
  const box = pictureBox(floor, { width: m.width, height: m.height }, fitted);
  const anchor = box.anchor;
  const foot = { x: box.x + m.base.x * box.scale, y: box.y + m.base.y * box.scale };
  const middle = PROJECTION.toScreen((floor.left + floor.right) / 2, (floor.top + floor.bottom) / 2);
  const wanted = isoSpan(floor.right - floor.left, floor.bottom - floor.top) * FOOT_SHARE;
  const ratio = (m.base.width * box.scale) / wanted;
  const scale = trim && (ratio < TRIM_BELOW || ratio > TRIM_ABOVE) ? Math.max(FIT_SCALE.least, Math.min(FIT_SCALE.most, 1 / ratio)) : 1;
  // Trimmed about its anchor, the foot moves towards it.
  const trimmed = { x: anchor.x + (foot.x - anchor.x) * scale, y: anchor.y + (foot.y - anchor.y) * scale };
  const per = box.scale * scale;
  return clampFit({ offset: [(middle.x - trimmed.x) / per, (middle.y - trimmed.y) / per], scale });
}
