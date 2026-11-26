import { afterEach, describe, expect, it } from 'vitest';
import { FIT_OFFSET_MOST, applyFit, fitOf, fitWords, hitboxAssets, removeFit, validateFit } from '../src/asset-fit.ts';
import { Tile, block, blockedTiles, type RegionMap } from '../src/world.ts';

const ids: string[] = [];
const put = (id: string, at: number, asset: string, offset: [number, number], scale?: number) => {
  ids.push(id);
  applyFit(id, { at, fit: { asset, offset, ...(scale ? { scale } : {}) } });
};

afterEach(() => {
  for (const id of ids.splice(0)) removeFit(id);
});

describe('asset fits', () => {
  it('checks the asset, whole pixels within the limit and the size trim', () => {
    expect(validateFit({ asset: 'spot-sage', offset: [-6, 3] })).toMatchObject({ kind: 'fit', fit: { asset: 'spot-sage', offset: [-6, 3] } });
    expect(validateFit({ asset: 'wish1:tree', offset: [1, 0], scale: 0.9 })).toMatchObject({ fit: { scale: 0.9 } });
    expect(validateFit({ asset: '', offset: [0, 0] })).toBe('Choose a picture to fit.');
    expect(validateFit({ asset: 'x y', offset: [0, 0] })).toBe('Choose a picture to fit.');
    expect(typeof validateFit({ asset: 'a', offset: [0.5, 0] })).toBe('string');
    expect(typeof validateFit({ asset: 'a', offset: [FIT_OFFSET_MOST + 1, 0] })).toBe('string');
    expect(typeof validateFit({ asset: 'a', offset: [0, 0], scale: 1.5 })).toBe('string');
    expect(validateFit({ asset: 'a', offset: [0, 0], scale: 1 })).toMatchObject({ fit: { asset: 'a', offset: [0, 0] }, description: 'a back where it was painted.' });
  });

  it('says a fit in words', () => {
    expect(fitWords({ offset: [-6, 3] })).toBe('6 px left, 3 px down');
    expect(fitWords({ offset: [0, 0], scale: 0.95 })).toBe('at 95 %');
    expect(fitWords({ offset: [0, 0] })).toBe('where it was painted');
  });

  it('keeps the newest fit that stands, and none once put back', () => {
    put('f1', 1, 'spot-sage', [2, 0]);
    put('f2', 2, 'spot-sage', [-4, 1]);
    expect(fitOf('spot-sage')?.offset).toEqual([-4, 1]);
    removeFit('f2');
    expect(fitOf('spot-sage')?.offset).toEqual([2, 0]);
    put('f3', 3, 'spot-sage', [0, 0]);
    expect(fitOf('spot-sage')).toBeUndefined();
  });

  it('gives a spot\'s state pictures their Ready picture\'s fit until they have their own', () => {
    put('f1', 1, 'spot-sage', [5, 5]);
    expect(fitOf('spot-sage-picked')?.offset).toEqual([5, 5]);
    expect(fitOf('spot-sage-growing')?.offset).toEqual([5, 5]);
    put('f2', 2, 'spot-sage-picked', [1, 1]);
    expect(fitOf('spot-sage-picked')?.offset).toEqual([1, 1]);
    expect(fitOf('sanctum-rock')).toBeUndefined();
  });

  it('checks hitbox tiles: whole tiles inside 8 a side, each once, sorted', () => {
    expect(validateFit({ asset: 'a', offset: [0, 0], blocks: [[1, 0], [0, 0], [1, 0]] })).toMatchObject({ fit: { blocks: [[0, 0], [1, 0]] }, description: 'a fitted on its tiles: blocking 2 tiles.' });
    expect(typeof validateFit({ asset: 'a', offset: [0, 0], blocks: [[10, 0]] })).toBe('string');
    expect(typeof validateFit({ asset: 'a', offset: [0, 0], blocks: [[0.5, 0]] })).toBe('string');
    expect(typeof validateFit({ asset: 'a', offset: [0, 0], blocks: 'all' })).toBe('string');
    expect(validateFit({ asset: 'a', offset: [0, 0], blocks: [] })).toMatchObject({ fit: { asset: 'a', offset: [0, 0] } });
    expect((validateFit({ asset: 'a', offset: [0, 0], blocks: [] }) as { fit: object }).fit).not.toHaveProperty('blocks');
  });

  it('blocks only a hitbox\'s tiles, and every tile without one', () => {
    const box = { left: 10, top: 4, width: 3, height: 2 };
    expect(blockedTiles(box)).toHaveLength(6);
    ids.push('hb');
    applyFit('hb', { at: 1, fit: { asset: 'arch', offset: [0, 0], blocks: [[0, 1], [2, 1], [7, 7]] } });
    expect(blockedTiles(box, 'arch')).toEqual([[10, 5], [12, 5]]);
    expect(hitboxAssets()).toEqual(['arch']);
    // Tiles more than FIT_BLOCKS_REACH past a footprint made smaller are left out.
    expect(blockedTiles({ left: 0, top: 0, width: 1, height: 1 }, 'arch')).toEqual([[0, 1], [2, 1]]);
    applyFit('hb', { at: 1, fit: { asset: 'arch', offset: [0, 0], blocks: [[7, 7]] } });
    expect(blockedTiles({ left: 0, top: 0, width: 1, height: 1 }, 'arch')).toEqual([[0, 0]]);
    const map = { width: 30, height: 30, tiles: new Array(900).fill(Tile.Ground) } as unknown as RegionMap;
    const at = (x: number, y: number) => map.tiles[y * map.width + x];
    // Its hitbox's tiles are all out of reach of this 3 by 1 footprint, so it blocks every tile.
    block(map, 21.5, 21, 3, 1, 'arch');
    expect([at(20, 20), at(21, 20), at(22, 20)]).toEqual([Tile.Blocked, Tile.Blocked, Tile.Blocked]);
    map.tiles.fill(Tile.Ground);
    applyFit('hb', { at: 1, fit: { asset: 'arch', offset: [0, 0], blocks: [[0, 0], [2, 0]] } });
    block(map, 21.5, 21, 3, 1, 'arch');
    expect([at(20, 20), at(21, 20), at(22, 20)]).toEqual([Tile.Blocked, Tile.Ground, Tile.Blocked]);
  });

  it('lets a hitbox reach two tiles past its footprint, for a picture painted wider', () => {
    expect(validateFit({ asset: 'a', offset: [0, 0], blocks: [[-2, 0], [0, -1], [9, 0]] })).toMatchObject({ fit: { blocks: [[0, -1], [-2, 0], [9, 0]] } });
    expect(typeof validateFit({ asset: 'a', offset: [0, 0], blocks: [[-3, 0]] })).toBe('string');
    expect(typeof validateFit({ asset: 'a', offset: [0, 0], blocks: [[10, 0]] })).toBe('string');
    ids.push('wide');
    applyFit('wide', { at: 1, fit: { asset: 'basin', offset: [0, 0], blocks: [[-1, -1], [0, 0], [1, 0], [2, 0], [-3, 0]] } });
    // A fountain on 2 by 1 tiles blocks the basin around it; a tile 3 out is too far.
    expect(blockedTiles({ left: 10, top: 4, width: 2, height: 1 }, 'basin')).toEqual([[9, 3], [10, 4], [11, 4], [12, 4]]);
  });
});
