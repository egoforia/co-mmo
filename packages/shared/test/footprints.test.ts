import { describe, expect, it } from 'vitest';
import { ISO_TILE, artFootprint, isoSpan } from '../src/index.ts';

describe('the tiles a picture stands on', () => {
  it('knows set pieces, landmarks, furniture and the sea cave props from where the world lays them', () => {
    expect(artFootprint('sanctum-standing-stones')).toEqual({ width: 4, height: 2 });
    expect(artFootprint('sanctum-shrine')).toEqual({ width: 2, height: 1 });
    expect(artFootprint('bramble-cottage-furniture-bed')).toEqual({ width: 2, height: 2 });
    expect(artFootprint('sea-cave-boulder')).toEqual({ width: 2, height: 1 });
  });

  it('has nothing for pictures that stand on no tiles', () => {
    expect(artFootprint('player-mara')).toBeUndefined();
    expect(artFootprint('woods-oak')).toBeUndefined();
  });

  it('measures a footprint across the isometric camera', () => {
    expect(isoSpan(1, 1)).toBe(ISO_TILE.width);
    expect(isoSpan(4, 2)).toBe(3 * ISO_TILE.width);
  });
});
