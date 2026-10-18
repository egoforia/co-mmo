import { describe, expect, it } from 'vitest';
import { TILE_PIXELS } from '@co-mmo/shared';
import { ISOMETRIC, PROJECTION, PROJECTIONS, TOP_DOWN, type Projection } from '../src/projection.ts';

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
  // Each arrow key walks the way it points on screen.
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]] as const) {
    const step = p.inputToWorld(dx, dy);
    const from = p.toScreen(5, 5);
    const to = p.toScreen(5 + step.dx, 5 + step.dy);
    if (dx) expect(Math.sign(to.x - from.x)).toBe(dx);
    if (dy) expect(Math.sign(to.y - from.y)).toBe(dy);
  }
  // Whatever stands on a tile is drawn on that tile, and sorts behind the tile south of it.
  const feet = p.stand(4, 6, 1, 1);
  expect(feet.x).toBeGreaterThanOrEqual(4);
  expect(feet.x).toBeLessThanOrEqual(5);
  expect(feet.y).toBeGreaterThan(6);
  expect(feet.y).toBeLessThanOrEqual(7);
  const south = p.stand(4, 7, 1, 1);
  expect(p.depth(south.x, south.y)).toBeGreaterThan(p.depth(feet.x, feet.y));
}

describe('the camera projection', () => {
  it('keeps the projection contract', () => contract(PROJECTION));
  for (const p of Object.values(PROJECTIONS)) it(`keeps the contract for the ${p.id} camera`, () => contract(p));

  it('draws top-down one tile per TILE_PIXELS, with keys walking the way they point', () => {
    expect(TOP_DOWN.toScreen(1.5, 2)).toEqual({ x: 1.5 * TILE_PIXELS, y: 2 * TILE_PIXELS });
    expect(TOP_DOWN.inputToWorld(1, -1)).toEqual({ dx: 1, dy: -1 });
    // Trees and set pieces stand on the south edge of their tiles, as they always have.
    expect(TOP_DOWN.stand(3, 4, 1, 1)).toEqual({ x: 3.5, y: 5 });
  });

  it('is top-down for everyone unless the preview is switched on', () => {
    expect(PROJECTION).toBe(TOP_DOWN);
  });

  it('draws isometric tiles as 160 by 80 diamonds, the south-east corner nearest', () => {
    // A tile's corners: north-west at the top, north-east right, south-east at the bottom, south-west left.
    expect(ISOMETRIC.toScreen(0, 0)).toEqual({ x: 0, y: 0 });
    expect(ISOMETRIC.toScreen(1, 0)).toEqual({ x: 80, y: 40 });
    expect(ISOMETRIC.toScreen(1, 1)).toEqual({ x: 0, y: 80 });
    expect(ISOMETRIC.toScreen(0, 1)).toEqual({ x: -80, y: 40 });
    expect(ISOMETRIC.ground).toEqual({ kind: 'diamond', width: 160, height: 80 });
    // Things stand on the middle of their tiles.
    expect(ISOMETRIC.stand(3, 4, 1, 1)).toEqual({ x: 3.5, y: 4.5 });
    expect(ISOMETRIC.stand(2, 4, 2, 1)).toEqual({ x: 3, y: 4.5 });
  });

  it('walks up the screen on W, which is north-west on the grid, and due north on W with D', () => {
    expect(ISOMETRIC.inputToWorld(0, -1)).toEqual({ dx: -1, dy: -1 });
    expect(ISOMETRIC.inputToWorld(1, -1)).toEqual({ dx: 0, dy: -1 });
    expect(ISOMETRIC.inputToWorld(1, 0)).toEqual({ dx: 1, dy: -1 });
    expect(ISOMETRIC.inputToWorld(1, 1)).toEqual({ dx: 1, dy: 0 });
    expect(ISOMETRIC.inputToWorld(0, 1)).toEqual({ dx: 1, dy: 1 });
    // Straight up the screen: the step's screen x stays put.
    const step = ISOMETRIC.inputToWorld(0, -1);
    expect(ISOMETRIC.toScreen(step.dx, step.dy).x).toBe(0);
  });
});
