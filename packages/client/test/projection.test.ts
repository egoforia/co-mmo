import { describe, expect, it } from 'vitest';
import { ISO_WAY_STEPS, TILE_PIXELS, type IsoWay } from '@co-mmo/shared';
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
  // Each arrow key walks towards its side of the screen.
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]] as const) {
    const step = p.inputToWorld(dx, dy);
    const from = p.toScreen(5, 5);
    const to = p.toScreen(5 + step.dx, 5 + step.dy);
    if (dx) expect(Math.sign(to.x - from.x) === dx || (dy !== 0 && to.x === from.x)).toBe(true);
    if (dy) expect(Math.sign(to.y - from.y) === dy || (dx !== 0 && to.y === from.y)).toBe(true);
  }
  // Whatever stands on a tile is drawn on that tile, and sorts behind the tile south of it.
  const feet = p.stand(4, 6, 1, 1);
  expect(feet.x).toBeGreaterThanOrEqual(4);
  expect(feet.x).toBeLessThanOrEqual(5);
  expect(feet.y).toBeGreaterThan(6);
  expect(feet.y).toBeLessThanOrEqual(7);
  const south = p.stand(4, 7, 1, 1);
  expect(p.depth(south.x, south.y)).toBeGreaterThan(p.depth(feet.x, feet.y));
  // Walkers only ever face the camera's own ways, and keep facing that way when they stop.
  for (const before of p.ways) {
    expect(p.face(0, 0, before)).toBe(before);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [0.3, -0.9]] as const) expect(p.ways).toContain(p.face(dx, dy, before));
  }
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

  it('walks along the grid on each key, and straight across the screen on two', () => {
    // Down is south, down and to the left; Right is east, down and to the right.
    expect(ISOMETRIC.inputToWorld(0, 1)).toEqual({ dx: 0, dy: 1 });
    expect(ISOMETRIC.inputToWorld(1, 0)).toEqual({ dx: 1, dy: 0 });
    expect(ISOMETRIC.inputToWorld(0, -1)).toEqual({ dx: 0, dy: -1 });
    expect(ISOMETRIC.inputToWorld(-1, 0)).toEqual({ dx: -1, dy: 0 });
    // Down with Right: straight down the screen.
    const step = ISOMETRIC.inputToWorld(1, 1);
    expect(ISOMETRIC.toScreen(step.dx, step.dy).x).toBe(0);
    // Each key faces the way it walks.
    expect(ISOMETRIC.face(0, 1, 'back-right')).toBe('front-left');
    expect(ISOMETRIC.face(1, 0, 'back-right')).toBe('front-right');
    expect(ISOMETRIC.face(0, -1, 'front-left')).toBe('back-right');
    expect(ISOMETRIC.face(-1, 0, 'front-left')).toBe('back-left');
  });

  it('faces the top-down ways as the arrow keys point, as it always has', () => {
    expect(TOP_DOWN.ways).toEqual(['front', 'right', 'back', 'left']);
    expect(TOP_DOWN.face(1, 1, 'front')).toBe('right');
    expect(TOP_DOWN.face(0, -1, 'left')).toBe('back');
  });

  it('faces the four isometric ways along the grid, keeping the nearest one walking straight up, down or sideways', () => {
    // Along the grid: south, east, west and north.
    expect(ISOMETRIC.face(0, 1, 'back-left')).toBe('front-left');
    expect(ISOMETRIC.face(1, 0, 'back-left')).toBe('front-right');
    expect(ISOMETRIC.face(-1, 0, 'front-right')).toBe('back-left');
    expect(ISOMETRIC.face(0, -1, 'front-left')).toBe('back-right');
    // A wandering creature faces the grid line nearest its step.
    expect(ISOMETRIC.face(0.9, 0.3, 'back-left')).toBe('front-right');
    // Straight up the screen (Up with Left): the back way on the side they faced.
    const up = ISOMETRIC.inputToWorld(-1, -1);
    expect(ISOMETRIC.face(up.dx, up.dy, 'front-left')).toBe('back-left');
    expect(ISOMETRIC.face(up.dx, up.dy, 'front-right')).toBe('back-right');
    expect(ISOMETRIC.face(up.dx, up.dy, 'back-right')).toBe('back-right');
    // Straight down (Down with Right): the front way on that side.
    const down = ISOMETRIC.inputToWorld(1, 1);
    expect(ISOMETRIC.face(down.dx, down.dy, 'back-left')).toBe('front-left');
    expect(ISOMETRIC.face(down.dx, down.dy, 'front-right')).toBe('front-right');
    // Straight right (Up with Right): front or back as they faced.
    const right = ISOMETRIC.inputToWorld(1, -1);
    expect(ISOMETRIC.face(right.dx, right.dy, 'front-left')).toBe('front-right');
    expect(ISOMETRIC.face(right.dx, right.dy, 'back-left')).toBe('back-right');
    const left = ISOMETRIC.inputToWorld(-1, 1);
    expect(ISOMETRIC.face(left.dx, left.dy, 'back-right')).toBe('back-left');
    // A newcomer facing us turns to a front way.
    expect(ISOMETRIC.face(down.dx, down.dy, 'front')).toMatch(/^front-/);
    // Each way faces the grid step it is named after.
    for (const way of ISOMETRIC.ways) {
      const { dx, dy } = ISO_WAY_STEPS[way as IsoWay];
      expect(ISOMETRIC.face(dx, dy, 'front')).toBe(way);
    }
  });
});
