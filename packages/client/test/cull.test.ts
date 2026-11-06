import { describe, expect, it } from 'vitest';
import { apart, grownView, pictureBox } from '../src/world-scene/cull.ts';

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
});
