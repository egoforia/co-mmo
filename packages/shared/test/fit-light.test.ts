import { afterEach, describe, expect, it } from 'vitest';
import { applyFit, fitOf, removeFit, validateFit } from '../src/asset-fit.ts';
import { FLAME_LIGHT, lightStrength } from '../src/light.ts';
import { LAMP_LIGHT, glowFor, glowWith } from '../src/lighting.ts';

afterEach(() => removeFit('lt'));

describe("a picture's own light (Art Studio)", () => {
  it('checks a light and says it in words', () => {
    const ok = validateFit({ asset: 'sanctum-brazier', offset: [0, 0], light: { at: [4, -10], color: '#FF8800', strength: 1.5, radius: 3.5, flicker: false } });
    expect(ok).toMatchObject({ fit: { light: { at: [4, -10], color: '#ff8800', strength: 1.5, radius: 3.5, flicker: false } } });
    expect(typeof ok !== 'string' && ok.description).toBe('sanctum-brazier fitted on its tiles: its light 4 px right, 10 px up, #ff8800, at 150 %, reaching 3.5 tiles, steady.');
    expect(validateFit({ asset: 'a', offset: [0, 0], light: { strength: 0 } })).toMatchObject({ description: 'a fitted on its tiles: no light.' });
    for (const light of [{ at: [0.5, 0] }, { at: [999, 0] }, { color: 'red' }, { strength: 3 }, { radius: 9 }, { flicker: 'yes' }, 'bright']) {
      expect(typeof validateFit({ asset: 'a', offset: [0, 0], light })).toBe('string');
    }
    // A light that changes nothing is left out.
    expect(validateFit({ asset: 'a', offset: [0, 0], light: { at: [0, 0], strength: 1 } })).toMatchObject({ fit: { asset: 'a', offset: [0, 0] }, description: 'a back where it was painted.' });
  });

  it("changes a kind's light, gives a lantern's to a piece without, or puts it out", () => {
    expect(glowFor('sanctum-brazier')).toEqual({ light: FLAME_LIGHT, at: [0, 0] });
    expect(glowFor('sanctum-bench')).toBeUndefined();
    applyFit('lt', { at: 1, fit: { asset: 'sanctum-brazier', offset: [0, 0], light: { at: [2, -6], color: '#88ccff', strength: 0.5, flicker: false } } });
    expect(fitOf('sanctum-brazier')?.light).toBeDefined();
    expect(glowFor('sanctum-brazier')).toEqual({ light: { color: '#88ccff', radius: FLAME_LIGHT.radius, strength: 0.5 }, at: [2, -6] });
    expect(glowWith(undefined, { color: '#00ff00' })).toEqual({ light: { ...LAMP_LIGHT, color: '#00ff00' }, at: [0, 0] });
    expect(glowWith(FLAME_LIGHT, { strength: 0 })).toBeUndefined();
  });

  it('burns as bright as its strength says', () => {
    expect(lightStrength({ color: '#ffffff', radius: 2, strength: 0.5 }, 0)).toBe(0.5);
    expect(lightStrength({ color: '#ffffff', radius: 2 }, 0)).toBe(1);
  });
});
