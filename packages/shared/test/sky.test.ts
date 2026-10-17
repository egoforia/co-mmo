import { describe, expect, it } from 'vitest';
import {
  BIOME_WEATHER,
  DEFAULT_SKY,
  awake,
  cleanSky,
  darkness,
  dayPart,
  dayPhase,
  noticeScale,
  routineOf,
  skyTint,
  skyWords,
  weatherAt,
  type BiomeId,
} from '../src/index.ts';

const DAY = DEFAULT_SKY.dayMinutes * 60_000;
/** The phase at a game hour. */
const at = (hour: number) => hour / 24;

describe('the sky', () => {
  it('turns through dawn, day, dusk and night over one game day', () => {
    expect(dayPhase(0, DEFAULT_SKY)).toBe(0);
    expect(dayPhase(DAY / 2, DEFAULT_SKY)).toBeCloseTo(0.5);
    expect(dayPhase(DAY * 3 + DAY / 4, DEFAULT_SKY)).toBeCloseTo(0.25);
    expect([3, 6, 12, 19, 22].map((h) => dayPart(at(h)))).toEqual(['night', 'dawn', 'day', 'dusk', 'night']);
    expect(darkness(at(12))).toBe(0);
    expect(darkness(at(1))).toBe(1);
    expect(darkness(at(6))).toBeGreaterThan(0);
    expect(darkness(at(6))).toBeLessThan(1);
  });

  it('keeps day and weather lengths within bounds', () => {
    expect(cleanSky({ dayMinutes: 0.01, weatherMinutes: 1e9 })).toEqual({ dayMinutes: 2, weatherMinutes: 1440, weather: true });
    expect(cleanSky({ dayMinutes: Number.NaN, weather: false })).toEqual({ ...DEFAULT_SKY, weather: false });
  });

  it('gives each land weather from its own odds, the same for everyone asking', () => {
    const seen = new Set<string>();
    for (let spell = 0; spell < 200; spell++) {
      const ms = spell * DEFAULT_SKY.weatherMinutes * 60_000;
      const w = weatherAt('desert', 'mirage-desert', ms, DEFAULT_SKY);
      expect(Object.keys(BIOME_WEATHER['mirage-desert'])).toContain(w);
      expect(weatherAt('desert', 'mirage-desert', ms + 1000, DEFAULT_SKY)).toBe(w);
      seen.add(w);
    }
    expect(seen.has('sandstorm')).toBe(true);
    expect(seen.has('snow')).toBe(false);
    for (const biome of Object.keys(BIOME_WEATHER) as BiomeId[]) expect(weatherAt('x', biome, 0, { ...DEFAULT_SKY, weather: false })).toBe('clear');
  });

  it('darkens and greys the light at night and in a storm', () => {
    const lum = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
    const noon = skyTint(0xffffff, at(12), 'clear');
    expect(noon).toBe(0xffffff);
    expect(lum(skyTint(0xffffff, at(1), 'clear'))).toBeLessThan(lum(noon) * 0.75);
    expect(lum(skyTint(0xffffff, at(12), 'storm'))).toBeLessThan(lum(noon));
    expect(skyWords(at(19), 'rain')).toBe('Dusk, rain');
  });

  it('lets creatures sleep out of their hours and see less in the dark unless you carry a light', () => {
    expect(awake('day', at(12))).toBe(true);
    expect(awake('day', at(1))).toBe(false);
    expect(awake('night', at(1))).toBe(true);
    expect(awake(undefined, at(1))).toBe(true);
    expect(noticeScale(undefined, at(12), 'clear', false)).toBe(1);
    expect(noticeScale(undefined, at(1), 'clear', false)).toBeLessThan(1);
    expect(noticeScale(undefined, at(1), 'clear', true)).toBe(1);
    expect(noticeScale('night', at(1), 'clear', false)).toBeGreaterThan(1);
    expect(noticeScale(undefined, at(12), 'fog', false)).toBeLessThan(noticeScale(undefined, at(12), 'fog', true));
  });

  it('gives people a day, with some keeping their own hours', () => {
    expect(routineOf('someone-wished').night).toEqual({ place: 'work', sleep: true });
    expect(routineOf('someone-wished').dusk.place).toBe('square');
    expect(routineOf('sister-amala').night.sleep).toBeUndefined();
  });
});
