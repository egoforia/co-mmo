import { describe, expect, it } from 'vitest';
import { isoSpan } from '@co-mmo/shared';
import { ISOMETRIC } from '../src/projection.ts';
import { standing, type Floor } from '../src/tile-stand.ts';

/** The depth a picture sorts at in the screen column of a walker at world (x, y). */
function depthUnder(plan: ReturnType<typeof standing>, x: number, y: number): number {
  const at = ISOMETRIC.toScreen(x, y).x;
  const strip = plan.strips.find((s) => {
    const left = plan.x + (s.x0 - plan.strips.reduce((w, t) => w + t.width, 0) / 2) * plan.scale;
    return at >= left && at < left + s.width * plan.scale;
  });
  return strip!.depth;
}

describe('standing on tiles', () => {
  // A bench four tiles long and one deep, its tiles from (10, 20) to (14, 21).
  const bench: Floor = { left: 10, top: 20, right: 14, bottom: 21 };
  const picture = { width: 400, height: 200 };

  it('cuts a thing wider than a tile into strips, so a walker beside either end is behind it or in front of it as they stand', () => {
    const plan = standing(bench, picture, true);
    expect(plan.strips.length).toBeGreaterThan(1);
    // Just behind the far end (north of its east tile): hidden by it.
    expect(ISOMETRIC.depth(13.5, 19.7)).toBeLessThan(depthUnder(plan, 13.5, 19.7));
    // Just in front of the near end (south of its west tile): in front of it.
    expect(ISOMETRIC.depth(10.5, 21.3)).toBeGreaterThan(depthUnder(plan, 10.5, 21.3));
    // Just past its east end: in front of it.
    expect(ISOMETRIC.depth(14.3, 20.5)).toBeGreaterThan(depthUnder(plan, 14.3, 20.5));
  });

  it('stands a picture painted for its tiles on their diamond, as wide as it, and an older one at its own size', () => {
    const fitted = standing(bench, picture, true);
    expect(fitted.scale * picture.width).toBeCloseTo(isoSpan(4, 1));
    expect(fitted.originY).toBe(1);
    // Its bottom is the diamond's front corner.
    expect(fitted.y).toBe(ISOMETRIC.toScreen(14, 21).y);
    const older = standing(bench, picture, false);
    expect(older.scale).toBe(1);
    expect(older.originY).toBe(0.92);
  });

  it('keeps one picture sorted by its middle on one tile', () => {
    const one = standing({ left: 3, top: 4, right: 4, bottom: 5 }, picture, true);
    expect(one.strips).toEqual([{ x0: 0, width: 400, depth: ISOMETRIC.depth(3.5, 4.5) }]);
  });
});
