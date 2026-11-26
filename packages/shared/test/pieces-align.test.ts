import { describe, expect, it } from 'vitest';
import { Tile, WORLD_REGIONS, generateRegion, isBlocking, pieceBox, piecePicture, tileAt } from '../src/index.ts';

// Every set piece blocks every tile its picture covers. 108 built-in pieces
// once blocked tiles half a tile off their pictures (the tiles rounded down
// from x - width / 2), so players walked into a picture or bumped into open
// floor. Moving the pictures onto those tiles instead slid whole rooms half a
// tile (egoforia 2026-11-26), so pictures stay where their rooms put them.

describe('pieces stand on the tiles they block', () => {
  for (const def of WORLD_REGIONS) {
    it(def.id, () => {
      const map = generateRegion(def);
      const off: string[] = [];
      for (const l of map.landmarks) {
        const tiles = pieceBox(l);
        const pic = piecePicture(l);
        const inside = pic.left >= tiles.left && pic.top >= tiles.top && pic.left + pic.width <= tiles.left + tiles.width && pic.top + pic.height <= tiles.top + tiles.height;
        const snug = tiles.width - pic.width < 2 && tiles.height - pic.height < 2;
        if (!inside || !snug) off.push(`${l.asset} at ${l.x}, ${l.y}`);
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

  it('keeps a piece of a width like 1.5 where it was put, blocking the 2 tiles it covers', () => {
    const l = { x: 5, y: 3, footprint: { width: 1.5, height: 1 } };
    expect(piecePicture(l)).toEqual({ left: 4.25, top: 2, width: 1.5, height: 1 });
    expect(pieceBox(l)).toEqual({ left: 4, top: 2, width: 2, height: 1 });
  });

  it('keeps a piece put between tiles there, blocking the part tiles at its sides', () => {
    const l = { x: 142, y: 117, footprint: { width: 3, height: 1 } };
    expect(piecePicture(l)).toEqual({ left: 140.5, top: 116, width: 3, height: 1 });
    expect(pieceBox(l)).toEqual({ left: 140, top: 116, width: 4, height: 1 });
    expect(pieceBox({ x: 105.5, y: 119.5, footprint: { width: 2, height: 1 } })).toEqual({ left: 104, top: 118, width: 3, height: 2 });
  });
});
