import { describe, expect, it } from 'vitest';
import { guideTiles } from '@co-mmo/shared';
import { guideTilesHtml, tilesPicked } from '../src/art-ui/guide-tiles.ts';

describe('the paint review tile picker', () => {
  it('shows a piece’s own footprint, and says when other tiles are picked', () => {
    expect(guideTilesHtml({})).toBe('');
    const own = guideTilesHtml({ tiles: { shown: { width: 2, height: 1 }, footprint: { width: 2, height: 1 } } });
    expect(own).toContain('2 × 1 tiles, its own footprint');
    expect(own).not.toContain('data-own-tiles');
    const other = guideTilesHtml({ tiles: { shown: { width: 3, height: 1 }, footprint: { width: 2, height: 1 } } });
    expect(other).toContain('3 × 1 tiles, not its own 2 × 1 tiles');
    expect(other).toContain('data-own-tiles');
  });

  it('reads the picked tiles, leaving them out when they are its own footprint', () => {
    expect(tilesPicked('2', '1', { width: 2, height: 1 })).toBeUndefined();
    expect(tilesPicked('1', '4', { width: 2, height: 1 })).toEqual({ width: 1, height: 4 });
    expect(tilesPicked('', '4', { width: 2, height: 1 })).toBeUndefined();
  });

  it('keeps tiles within reach', () => {
    expect(guideTiles({ width: 3, height: 2 })).toEqual({ width: 3, height: 2 });
    expect(guideTiles({ width: '2.5', height: 1 })).toEqual({ width: 2.5, height: 1 });
    expect(guideTiles({ width: 0, height: 1 })).toBeUndefined();
    expect(guideTiles({ width: 7, height: 1 })).toBeUndefined();
    expect(guideTiles(undefined)).toBeUndefined();
  });
});
