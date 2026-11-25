import { describe, expect, it } from 'vitest';
import { DEFAULT_SKY, dayPart, dayPhase, weatherAt } from '@co-mmo/shared';
import { effectiveSky } from '../src/sky-settings.ts';
import { account, api, app, start, stop } from './helpers.ts';

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

describe("God's View Sky tab", () => {
  it('lets only the Owner change lengths, keeps the hour, and keeps the saved sky after a restart', async () => {
    const { store, base } = await start({ sky: { ...DEFAULT_SKY, dayMinutes: 60 } });
    const owner = account(store, 'egoforia', 'owner');
    const steward = account(store, 'Mara', 'steward');
    const before = (await api(base, '/api/admin/sky', steward.token)).body;
    expect(before.sky.dayMinutes).toBe(60);
    expect((await api(base, '/api/admin/sky', steward.token, 'PUT', { dayMinutes: 240 })).status).toBe(403);
    const put = await api(base, '/api/admin/sky', owner.token, 'PUT', { dayMinutes: 240, nightShare: 0.25, odds: { 'mirage-desert': { sandstorm: 10 } } });
    expect(put.status).toBe(200);
    expect(store.settings.sky).toMatchObject({ dayMinutes: 240, nightShare: 0.25, odds: { 'mirage-desert': { sandstorm: 10 } } });
    const at = Date.now();
    expect(dayPhase(at, store.settings.sky!)).toBeCloseTo(dayPhase(at, before.sky), 2);
    expect(store.journalSince(0).at(-1)!.text).toContain('a 4 hours day');
    // A restart on the same store runs the saved sky, not .env's.
    await stop();
    const again = await start({ store, sky: { ...DEFAULT_SKY, dayMinutes: 60 } });
    expect((await api(again.base, '/api/admin/sky', owner.token)).body.sky.dayMinutes).toBe(240);
  });

  it('lets Stewards set the hour and a land’s weather now, for one spell', async () => {
    const { store, base } = await start();
    const steward = account(store, 'Mara', 'steward');
    expect((await api(base, '/api/admin/sky/now', steward.token, 'POST', { hour: 19 })).status).toBe(200);
    expect(dayPart(dayPhase(Date.now(), app!.world.sky))).toBe('dusk');
    const fog = await api(base, '/api/admin/sky/now', steward.token, 'POST', { region: 'desert', weather: 'snow' });
    expect(fog.body.weather).toBe('snow');
    const later = Date.now() + DEFAULT_SKY.weatherMinutes * 60_000 + 1000;
    expect(weatherAt('desert', 'mirage-desert', Date.now(), app!.world.sky)).toBe('snow');
    expect(weatherAt('desert', 'mirage-desert', later, app!.world.sky)).not.toBe('snow');
    expect((await api(base, '/api/admin/sky/now', steward.token, 'POST', { region: 'nowhere', weather: 'snow' })).status).toBe(400);
  });
});
