import { describe, expect, it } from 'vitest';
import { TILE_PIXELS } from '@co-mmo/shared';
import { PROJECTION, TOP_DOWN, type Projection } from '../src/projection.ts';

/** What every projection must keep true, whatever the camera. */
function contract(p: Projection): void {
  // Standing further south (down the map) always draws in front.
  expect(p.depth(3, 5)).toBeGreaterThan(p.depth(3, 4));
  // The camera's bounds cover exactly the corners' screen positions.
  const b = p.bounds(2, 3, 10, 12);
  const corners = [p.toScreen(2, 3), p.toScreen(10, 3), p.toScreen(2, 12), p.toScreen(10, 12)];
  expect(b.x).toBe(Math.min(...corners.map((c) => c.x)));
  expect(b.y).toBe(Math.min(...corners.map((c) => c.y)));
  expect(b.x + b.width).toBe(Math.max(...corners.map((c) => c.x)));
  expect(b.y + b.height).toBe(Math.max(...corners.map((c) => c.y)));
  // No keys held is no step.
  expect(p.inputToWorld(0, 0)).toEqual({ dx: 0, dy: 0 });
}

describe('the camera projection', () => {
  it('keeps the projection contract', () => contract(PROJECTION));

  it('draws top-down one tile per TILE_PIXELS, with keys walking the way they point', () => {
    expect(TOP_DOWN.toScreen(1.5, 2)).toEqual({ x: 1.5 * TILE_PIXELS, y: 2 * TILE_PIXELS });
    expect(TOP_DOWN.inputToWorld(1, -1)).toEqual({ dx: 1, dy: -1 });
  });
});
