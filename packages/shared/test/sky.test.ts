import { describe, expect, it } from 'vitest';
import {
  BIOME_WEATHER,
  DEFAULT_SKY,
  awake,
  cleanSky,
  darkness,
  dayPart,
  dayPhase,
  NATURAL_NIGHT_SHARE,
  nextHour,
  nextWeather,
  noticeScale,
  retimeSky,
  routineOf,
  skyAtHour,
  spellEnds,
  unwarpPhase,
  warpPhase,
  skyTint,
  skyWords,
  weatherAt,
  type BiomeId,
  type SkyConfig,
} from '../src/index.ts';

const DAY = DEFAULT_SKY.dayMinutes * 60_000;
/** Today's sky before the clock had an anchor or a night share: an hour a day, twenty-minute spells. */
const OLD: SkyConfig = { dayMinutes: 60, weatherMinutes: 20, weather: true };
/** The phase at a game hour. */
const at = (hour: number) => hour / 24;

describe('the sky', () => {
  it('turns through dawn, day, dusk and night over one game day', () => {
    expect(dayPhase(0, DEFAULT_SKY)).toBe(0);
    expect(dayPhase(0, OLD)).toBe(0);
    expect(dayPhase(30 * 60_000, OLD)).toBeCloseTo(0.5);
    expect(dayPhase(3 * 3_600_000 + 15 * 60_000, OLD)).toBeCloseTo(0.25);
    expect(dayPhase(nextHour(12, DAY * 3, DEFAULT_SKY), DEFAULT_SKY)).toBeCloseTo(0.5);
    expect([3, 6, 12, 19, 22].map((h) => dayPart(at(h)))).toEqual(['night', 'dawn', 'day', 'dusk', 'night']);
    expect(darkness(at(12))).toBe(0);
    expect(darkness(at(1))).toBe(1);
    expect(darkness(at(6))).toBeGreaterThan(0);
    expect(darkness(at(6))).toBeLessThan(1);
  });

  it('keeps day and weather lengths within bounds', () => {
    expect(cleanSky({ dayMinutes: 0.01, weatherMinutes: 1e9 })).toEqual({ ...DEFAULT_SKY, dayMinutes: 10, weatherMinutes: 1440 });
    expect(cleanSky({ dayMinutes: 1e9, nightShare: 0.9, fadeSeconds: -3 })).toMatchObject({ dayMinutes: 7 * 24 * 60, nightShare: 0.6, fadeSeconds: 60 });
    expect(cleanSky({ dayMinutes: Number.NaN, weather: false })).toEqual({ ...DEFAULT_SKY, weather: false });
    expect(cleanSky({ odds: { 'mirage-desert': { sandstorm: 40, rain: -1 }, nowhere: { clear: 1 } } as never }).odds).toEqual({ 'mirage-desert': { sandstorm: 10 } });
  });

  it('keeps the old hours and weather when no anchor or night share is set', () => {
    for (const ms of [0, 1_234_567_890, 1_790_000_000_000]) {
      expect(dayPhase(ms, OLD)).toBeCloseTo((ms % 3_600_000) / 3_600_000, 9);
      expect(Math.floor(spellEnds(ms, OLD) / 1_200_000)).toBe(Math.floor(ms / 1_200_000) + 1);
    }
  });

  it('carries the hour and the weather on when the lengths change', () => {
    const now = 1_790_000_123_456;
    const longer = retimeSky(OLD, { ...DEFAULT_SKY, dayMinutes: 6 * 60, weatherMinutes: 90 }, now);
    expect(dayPhase(now, longer)).toBeCloseTo(dayPhase(now, OLD), 9);
    for (const id of ['desert', 'shore', 'woods']) expect(weatherAt(id, 'mirage-desert', now, longer)).toBe(weatherAt(id, 'mirage-desert', now, OLD));
    // An hour later the longer day has moved a sixth as far.
    const later = dayPhase(now + 3_600_000, longer);
    expect(later).not.toBeCloseTo(dayPhase(now + 3_600_000, OLD), 2);
    // Changing it again keeps the hour once more, night share and all.
    const again = retimeSky(longer, { ...longer, nightShare: 0.2, dayMinutes: 30 }, now + 60_000);
    expect(dayPhase(now + 60_000, again)).toBeCloseTo(dayPhase(now + 60_000, longer), 9);
    expect(weatherAt('desert', 'mirage-desert', now + 60_000, again)).toBe(weatherAt('desert', 'mirage-desert', now + 60_000, longer));
  });

  it('sets the hour now without touching the weather', () => {
    const now = 1_790_000_123_456;
    const dusk = skyAtHour(DEFAULT_SKY, 18.5, now);
    expect(dayPart(dayPhase(now, dusk))).toBe('dusk');
    expect(dayPhase(now, dusk) * 24).toBeCloseTo(18.5, 6);
    expect(weatherAt('shore', 'sunlit-shore', now, dusk)).toBe(weatherAt('shore', 'sunlit-shore', now, DEFAULT_SKY));
  });

  it('lets night take its chosen share of the day, keeping dawn at 5 and dusk at 18', () => {
    for (const share of [0.15, 1 / 3, NATURAL_NIGHT_SHARE, 0.6]) {
      const sky = { ...DEFAULT_SKY, nightShare: share };
      // Sample the real day finely: darkness never runs backwards between dusk and dawn, and night takes its share.
      let night = 0;
      let last = -1;
      const steps = 24_000;
      for (let i = 0; i < steps; i++) {
        const phase = dayPhase((i / steps) * DAY, sky);
        expect(phase).toBeGreaterThan(last);
        last = phase;
        if (dayPart(phase) === 'night') night++;
      }
      expect(night / steps).toBeCloseTo(share, 3);
      expect(warpPhase(unwarpPhase(5 / 24, share), share) * 24).toBeCloseTo(5, 9);
      expect(warpPhase(unwarpPhase(18 / 24, share), share) * 24).toBeCloseTo(18, 9);
    }
    expect(warpPhase(0.4, NATURAL_NIGHT_SHARE)).toBe(0.4);
  });

  it('knows the weather to come and when, for the heads-up', () => {
    const ms = 1_790_000_123_456;
    const next = nextWeather('desert', 'mirage-desert', ms, DEFAULT_SKY);
    expect(next.at).toBeGreaterThan(ms);
    expect(next.at - ms).toBeLessThanOrEqual(DEFAULT_SKY.weatherMinutes * 60_000);
    expect(weatherAt('desert', 'mirage-desert', next.at, DEFAULT_SKY)).toBe(next.weather);
    expect(weatherAt('desert', 'mirage-desert', next.at - 1, DEFAULT_SKY)).toBe(weatherAt('desert', 'mirage-desert', ms, DEFAULT_SKY));
  });

  it("follows the Owner's weather odds for a land", () => {
    const sky = { ...DEFAULT_SKY, odds: { 'mirage-desert': { snow: 1 } } };
    for (let i = 0; i < 20; i++) expect(weatherAt('desert', 'mirage-desert', i * 2_700_000, sky)).toBe('snow');
    expect(weatherAt('desert', 'sunlit-shore', 0, sky)).not.toBe('snow');
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
