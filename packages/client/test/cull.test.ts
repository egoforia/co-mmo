import { describe, expect, it } from 'vitest';
import { CULL_SLICES, apart, cullAll, cullSlice, grownView, pictureBox } from '../src/world-scene/cull.ts';

describe('culling pictures off screen', () => {
  const view = grownView({ x: 0, y: 0, width: 1000, height: 800 });

  it('grows the view by a quarter on each side', () => {
    expect(view).toEqual({ left: -250, top: -200, right: 1250, bottom: 1000 });
  });

  it('places a picture by its origin', () => {
    expect(pictureBox(100, 200, 40, 60, 0.5, 1)).toEqual({ left: 80, top: 140, right: 120, bottom: 200 });
  });

  it('keeps pictures on screen or in the margin, and skips those beyond it', () => {
    expect(apart(pictureBox(500, 400, 100, 100, 0.5, 0.5), view)).toBe(false);
    // A tall wall whose foot is below the view but whose top reaches into the margin.
    expect(apart(pictureBox(500, 1100, 100, 200, 0.5, 1), view)).toBe(false);
    expect(apart(pictureBox(2000, 400, 100, 100, 0.5, 0.5), view)).toBe(true);
    expect(apart(pictureBox(500, -600, 100, 100, 0, 0), view)).toBe(true);
  });

  it('judges every picture at once only after a jump, a zoom or on the first frame', () => {
    const last = { x: 0, y: 0, width: 1000, height: 800 };
    expect(cullAll(undefined, last)).toBe(true);
    // A sweep's worth of walking: well inside the margin.
    expect(cullAll(last, { x: 60, y: -40, width: 1000, height: 800 })).toBe(false);
    // Half of the 250 px margin across.
    expect(cullAll(last, { x: 126, y: 0, width: 1000, height: 800 })).toBe(true);
    expect(cullAll(last, { x: 0, y: 0, width: 2000, height: 1600 })).toBe(true);
  });

  it('judges a slice a frame and goes round the whole list', () => {
    const count = 100;
    const seen = new Set<number>();
    let next = 0;
    for (let frame = 0; frame < CULL_SLICES; frame++) {
      const { from, to } = cullSlice(next, count);
      for (let i = from; i < to; i++) seen.add(i);
      next = to;
    }
    expect(seen.size).toBe(count);
    // Then it starts again, and a list that shrank starts over.
    expect(cullSlice(next, count).from).toBe(0);
    expect(cullSlice(90, 50)).toEqual({ from: 0, to: Math.ceil(50 / CULL_SLICES) });
  });
});
