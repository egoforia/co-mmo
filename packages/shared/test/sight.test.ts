import { describe, expect, it } from 'vitest';
import { Tile, clearLine, combatRules, flanks, inLine, nearestOf, tilesBetween, tilesFor, type EdgeWall, type RegionMap } from '../src/index.ts';

// Reach and sight on tiles (docs/combat.md): how far a reach goes in
// tiles, straight lines for long blades, and clear lines past trees and walls.

function land(width = 10, height = 10, tiles: [number, number, Tile][] = [], edgeWalls: Partial<EdgeWall>[] = []): RegionMap {
  const grid = new Uint8Array(width * height).fill(Tile.Ground);
  for (const [x, y, t] of tiles) grid[y * width + x] = t;
  return { width, height, tiles: grid, def: { exits: {} }, storeys: [], edgeWalls: edgeWalls.map((w) => ({ floor: 0, style: 'x', height: 'full', id: 'w', ...w })) } as unknown as RegionMap;
}

const at = (tx: number, ty: number) => ({ tx, ty });

describe('reach and sight on tiles', () => {
  it('counts a reach in tiles: touching under two, whole tiles past that', () => {
    expect([0, 1, 1.6, 2, 2.2, 2.5, 5.5, 6].map(tilesFor)).toEqual([0, 1, 1, 2, 2, 2, 5, 6]);
  });

  it('knows a straight line from a crooked one, for any tile of a big square', () => {
    expect(inLine(at(0, 0), at(0, 2))).toBe(true);
    expect(inLine(at(0, 0), at(2, 2))).toBe(true);
    expect(inLine(at(0, 0), at(2, 1))).toBe(false);
    expect(inLine(at(0, 0), at(2, 1), 2)).toBe(true);
    expect(nearestOf(at(5, 5), 2, at(0, 9))).toEqual(at(5, 6));
  });

  it('passes through the tiles between two tiles, corners as pairs', () => {
    expect(tilesBetween(at(0, 0), at(3, 0))).toEqual([at(1, 0), at(2, 0)]);
    expect(tilesBetween(at(0, 0), at(2, 2))).toEqual([[at(1, 0), at(0, 1)], at(1, 1), [at(2, 1), at(1, 2)]]);
  });

  it('is stopped by trees, rocks and walls, but shoots over water', () => {
    expect(clearLine(land(), at(1, 1), at(6, 1))).toBe(true);
    expect(clearLine(land(10, 10, [[3, 1, Tile.Tree]]), at(1, 1), at(6, 1))).toBe(false);
    expect(clearLine(land(10, 10, [[3, 1, Tile.Water]]), at(1, 1), at(6, 1))).toBe(true);
    // A wall standing on the line between tiles 3 and 4 of the row.
    const walled = land(10, 10, [], [{ x: 4, y: 1, along: 'v' }]);
    expect(clearLine(walled, at(1, 1), at(6, 1))).toBe(false);
    expect(clearLine(walled, at(3, 1), at(4, 1))).toBe(false);
    expect(clearLine(walled, at(1, 3), at(6, 3))).toBe(true);
  });

  it('sees past a corner with one open side, not between two trees touching at a corner', () => {
    expect(clearLine(land(10, 10, [[2, 1, Tile.Tree]]), at(1, 1), at(3, 3))).toBe(true);
    expect(clearLine(land(10, 10, [[2, 1, Tile.Tree], [1, 2, Tile.Tree]]), at(1, 1), at(3, 3))).toBe(false);
  });

  it('is stopped by bodies only when asked', () => {
    const map = land();
    expect(clearLine(map, at(1, 1), at(6, 1), 0, (t) => t.tx === 3 && t.ty === 1)).toBe(false);
    expect(clearLine(map, at(1, 1), at(2, 1), 0, (t) => t.tx === 2 && t.ty === 1)).toBe(true);
  });

  it('fills in rules an older save lacks', () => {
    expect(combatRules(undefined)).toEqual({ bodiesBlockShots: false });
    expect(combatRules({ bodiesBlockShots: true })).toEqual({ bodiesBlockShots: true });
  });
});

describe('flanking on tiles', () => {
  it('flanks across a square, side to side or corner to corner', () => {
    const c = { tx: 5, ty: 5 };
    expect(flanks(c, 1, { tx: 4, ty: 5 }, { tx: 6, ty: 5 })).toBe(true);
    expect(flanks(c, 1, { tx: 4, ty: 4 }, { tx: 6, ty: 6 })).toBe(true);
    expect(flanks(c, 1, { tx: 4, ty: 5 }, { tx: 6, ty: 4 })).toBe(false);
    expect(flanks(c, 1, { tx: 4, ty: 5 }, { tx: 7, ty: 5 })).toBe(false);
    // A big one, two tiles wide: across it from any tile of one side to any of the other.
    expect(flanks(c, 2, { tx: 4, ty: 5 }, { tx: 7, ty: 6 })).toBe(true);
    expect(flanks(c, 2, { tx: 5, ty: 4 }, { tx: 6, ty: 7 })).toBe(true);
  });
});
