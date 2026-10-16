import { describe, expect, it } from 'vitest';
import { FLAME_LIGHT, MAX_LIGHT_RADIUS, cleanLight, itemFromWish, lightStrength, validateDefinition, type ItemWish } from '../src/index.ts';

const look = { hook: 'a blade wreathed in flame', body: 'a long sword', color: '#d0402a', mood: 'fierce' };

describe('cleanLight', () => {
  it('keeps a wished light within bounds', () => {
    expect(cleanLight({ color: '#66CCFF', radius: 2.3 })).toEqual({ color: '#66ccff', radius: 2.5 });
    expect(cleanLight({ color: 'red', radius: 99, flicker: true })).toEqual({ color: FLAME_LIGHT.color, radius: MAX_LIGHT_RADIUS, flicker: true });
    expect(cleanLight({ radius: -3 })?.radius).toBe(1);
  });

  it('is no light when none is given', () => {
    expect(cleanLight(undefined)).toBeUndefined();
    expect(cleanLight('bright')).toBeUndefined();
  });
});

describe('lightStrength', () => {
  it('holds steady lights at full strength', () => {
    expect(lightStrength({ color: '#ffffff', radius: 2 }, 1234)).toBe(1);
  });

  it('makes flames waver between three quarters and full', () => {
    const seen = Array.from({ length: 200 }, (_, i) => lightStrength(FLAME_LIGHT, i * 37, 3));
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0.75);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.1);
  });
});

describe('wished lights', () => {
  it('gives gear that burns a light it casts while held', () => {
    const def = validateDefinition({ kind: 'item', name: 'Ember Sword', description: 'It burns.', itemKind: 'weapon', light: { color: '#ff8800', radius: 9, flicker: true }, look }) as ItemWish;
    expect(def.light).toEqual({ color: '#ff8800', radius: MAX_LIGHT_RADIUS, flicker: true });
    expect(itemFromWish('w1', def).light).toEqual(def.light);
  });

  it('casts no light from things that are not held', () => {
    const def = validateDefinition({ kind: 'item', name: 'Glow Berry', description: 'Sweet.', itemKind: 'consumable', light: { radius: 2 }, look }) as ItemWish;
    expect(def.light).toBeUndefined();
    const plain = validateDefinition({ kind: 'item', name: 'Iron Sword', description: 'Sharp.', itemKind: 'weapon', look }) as ItemWish;
    expect(plain.light).toBeUndefined();
    expect(itemFromWish('w2', plain).light).toBeUndefined();
  });
});
