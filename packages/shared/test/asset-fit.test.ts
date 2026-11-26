import { afterEach, describe, expect, it } from 'vitest';
import { FIT_OFFSET_MOST, applyFit, fitOf, fitWords, removeFit, validateFit } from '../src/asset-fit.ts';

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
});
