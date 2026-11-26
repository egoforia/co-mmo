import { describe, expect, it } from 'vitest';
import { Tile, WORLD_REGIONS, generateRegion, isBlocking, pieceBox, piecePicture, tileAt } from '../src/index.ts';

// Every set piece's picture stands on the tiles it blocks. 108 built-in pieces
// once stood up to half a tile off them (a picture drawn at x - width / 2,
// the tiles blocked from floor(x - width / 2)), so players walked into what
// looked like open ground and could not walk where the picture had moved off.

describe('pieces stand on the tiles they block', () => {
  for (const def of WORLD_REGIONS) {
    it(def.id, () => {
      const map = generateRegion(def);
      const off: string[] = [];
      for (const l of map.landmarks) {
        const tiles = pieceBox(l);
        const pic = piecePicture(l);
        const mid = (b: { left: number; width: number }) => b.left + b.width / 2;
        if (Math.abs(mid(pic) - mid(tiles)) > 1e-9 || pic.top !== tiles.top || pic.height !== tiles.height) off.push(`${l.asset} at ${l.x}, ${l.y}`);
        // The tiles under it are blocked, or part of a building's own walls (it stands inside).
        if (l.floor) continue;
        for (let y = tiles.top; y < tiles.top + tiles.height; y++) {
          for (let x = tiles.left; x < tiles.left + tiles.width; x++) {
            const t = tileAt(map, x, y);
            if (!isBlocking(t) && t !== Tile.Blocked) off.push(`${l.asset} at ${l.x}, ${l.y} leaves ${x}, ${y} open`);
          }
        }
      }
      expect(off).toEqual([]);
    });
  }

  it('keeps a piece of a width like 1.5 its painted width, centred on the 2 tiles it blocks', () => {
    const l = { x: 5, y: 3, footprint: { width: 1.5, height: 1 } };
    expect(pieceBox(l)).toEqual({ left: 4, top: 2, width: 2, height: 1 });
    expect(piecePicture(l)).toEqual({ left: 4.25, top: 2, width: 1.5, height: 1 });
  });

  it('moves a piece half a tile off onto its tiles', () => {
    const l = { x: 5.5, y: 3, footprint: { width: 2, height: 2 } };
    expect(pieceBox(l)).toEqual({ left: 4, top: 1, width: 2, height: 2 });
    expect(piecePicture(l).left).toBe(4);
  });
});
