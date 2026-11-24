import { describe, expect, it } from 'vitest';
import { faceAfterTick, facesSquare, tilesAhead } from '../src/tiles.ts';

// Facing on tiles (tiles/facing.ts): a walker turns as a step begins and not
// again until it is done, and a melee blow lands only straight ahead.

describe('facing on tiles', () => {
  const east = { dx: 1, dy: 0 };

  it('turns to a step as it begins, and keeps that way until it is done', () => {
    // Standing at 5,5, a step east begins.
    expect(faceAfterTick(undefined, { tx: 5, ty: 5 }, undefined, { tx: 6, ty: 5 }, 1, 0)).toEqual(east);
    // Halfway, pressing south changes nothing.
    expect(faceAfterTick(east, { tx: 6, ty: 5 }, { tx: 6, ty: 5 }, { tx: 6, ty: 5 }, 0, 1)).toEqual(east);
    // The step done, the next begins south from the tile it reached.
    expect(faceAfterTick(east, { tx: 6, ty: 5 }, { tx: 6, ty: 5 }, { tx: 6, ty: 6 }, 0, 1)).toEqual({ dx: 0, dy: 1 });
  });

  it('turns where it stands when nothing is stepped onto, and keeps its way with no input', () => {
    const turned = faceAfterTick(east, { tx: 5, ty: 5 }, undefined, undefined, -1, -1)!;
    expect(turned.dx).toBeCloseTo(-Math.SQRT1_2);
    expect(turned.dy).toBeCloseTo(-Math.SQRT1_2);
    expect(faceAfterTick(east, { tx: 5, ty: 5 }, undefined, undefined, 0, 0)).toEqual(east);
  });

  it('finds the tiles straight ahead, and big squares on them', () => {
    expect(tilesAhead({ tx: 0, ty: 0 }, { dx: 1, dy: 1 }, 2)).toEqual([{ tx: 1, ty: 1 }, { tx: 2, ty: 2 }]);
    expect(facesSquare({ tx: 0, ty: 0 }, east, { tx: 1, ty: -1 }, 2)).toBe(true);
    expect(facesSquare({ tx: 0, ty: 0 }, east, { tx: 0, ty: 1 })).toBe(false);
    // No way yet: east.
    expect(facesSquare({ tx: 0, ty: 0 }, undefined, { tx: 1, ty: 0 })).toBe(true);
  });
});
