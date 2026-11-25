import { describe, expect, it } from 'vitest';
import { DEFAULT_SKY } from '@co-mmo/shared';
import { effectiveSky } from '../src/sky-settings.ts';

describe('the sky the world runs', () => {
  it("is .env's until the Owner saves one, and then the saved one", () => {
    const env = { ...DEFAULT_SKY, dayMinutes: 60 };
    expect(effectiveSky(env)).toBe(env);
    const saved = { ...DEFAULT_SKY, dayMinutes: 180, anchor: { at: 5, phase: 0.25, spell: 3 } };
    expect(effectiveSky(env, saved)).toMatchObject({ dayMinutes: 180, anchor: { at: 5, phase: 0.25, spell: 3 } });
  });

  it('still keeps skies clear with WEATHER=off', () => {
    expect(effectiveSky({ ...DEFAULT_SKY, weather: false }, { ...DEFAULT_SKY, weather: true }).weather).toBe(false);
    expect(effectiveSky(DEFAULT_SKY, { ...DEFAULT_SKY, weather: false }).weather).toBe(false);
  });
});
