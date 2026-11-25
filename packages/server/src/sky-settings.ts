import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BIOME_WEATHER,
  DEFAULT_SKY,
  NATURAL_NIGHT_SHARE,
  WEATHERS,
  cleanSky,
  forceWeather,
  retimeSky,
  skyAtHour,
  weatherAt,
  type SkyConfig,
  type Weather,
} from '@co-mmo/shared';
import type { Account, Store } from './store.ts';
import type { World } from './world.ts';

// How the sky turns, from what the Owner saved (God's View, Sky tab) and
// what `.env` says. The saved sky wins; `.env` is the first default. Only
// WEATHER=off still beats a saved sky, since tests and shots rely on it to
// keep every land clear. The Sky tab's routes live here too: the Owner sets
// lengths and odds, and the Owner and Stewards set the hour or a land's
// weather now, for events. Every change goes in the journal.

/** The sky the world runs: the saved one over `.env`'s, with WEATHER=off forcing clear skies. */
export function effectiveSky(env: SkyConfig = DEFAULT_SKY, saved?: SkyConfig): SkyConfig {
  if (!saved) return env;
  const sky = cleanSky({ ...env, ...saved });
  return env.weather ? sky : { ...sky, weather: false };
}

/** What the Sky tab's routes need. */
export interface SkyContext {
  store: Store;
  world: World;
  /** The sky `.env` asked for. */
  env: SkyConfig;
  now(): number;
  json(res: ServerResponse, status: number, body: unknown): void;
  readJson(req: IncomingMessage): Promise<Record<string, unknown> | null>;
}

/** What the Owner saved, or `.env`'s sky with the world's clock, as the base for a change. */
function savedOrEnv(ctx: SkyContext): SkyConfig {
  return ctx.store.settings.sky ?? { ...ctx.world.sky, weather: true };
}

/** Saves a sky and runs it everywhere. */
function apply(ctx: SkyContext, saved: SkyConfig): void {
  ctx.store.updateSettings({ ...ctx.store.settings, sky: saved });
  ctx.world.setSky(effectiveSky(ctx.env, saved));
}

const minutesWords = (m: number) => (m >= 120 && m % 60 === 0 ? `${m / 60} hours` : m === 60 ? 'an hour' : `${Math.round(m)} minutes`);

/** Handles /api/admin/sky and /api/admin/sky/now; false when the route is not one of them. */
export async function handleSky(req: IncomingMessage, res: ServerResponse, route: string, account: Account, ctx: SkyContext): Promise<boolean> {
  if (route !== 'sky' && route !== 'sky/now') return false;
  const method = req.method ?? 'GET';
  const owner = account.role === 'owner';
  const { world, store, json } = ctx;

  if (route === 'sky' && method === 'GET') {
    const lands = world.defs().filter((d) => !d.workshop).map((d) => ({
      id: d.id,
      name: d.name,
      biome: d.biome,
      weather: world.skyOver(d).weather,
      ...(world.region(d.id)?.map.weather ? { fixed: true } : {}),
    }));
    return json(res, 200, {
      sky: world.sky,
      saved: savedOrEnv(ctx),
      envWeatherOff: !ctx.env.weather,
      now: ctx.now(),
      gameOdds: BIOME_WEATHER,
      naturalNightShare: NATURAL_NIGHT_SHARE,
      lands,
    }), true;
  }

  if (route === 'sky' && method === 'PUT') {
    if (!owner) return json(res, 403, { error: 'forbidden', message: 'Only the Owner can change how the sky turns.' }), true;
    const body = (await ctx.readJson(req)) ?? {};
    const base = savedOrEnv(ctx);
    const pick = <K extends keyof SkyConfig>(k: K) => (body[k] === undefined ? base[k] : body[k]) as SkyConfig[K];
    const next = cleanSky({
      ...base,
      dayMinutes: pick('dayMinutes'),
      nightShare: pick('nightShare'),
      weatherMinutes: pick('weatherMinutes'),
      fadeSeconds: pick('fadeSeconds'),
      weather: pick('weather'),
      odds: body.odds === null ? undefined : pick('odds'),
    });
    const now = ctx.now();
    // A new length carries on from the hour and spell the world is at, so nothing jumps.
    let saved = retimeSky(world.sky, { ...next, ...(base.forced ? { forced: base.forced } : {}) }, now);
    // "Follow the real day": the game's hour is the Owner's clock hour from now on.
    if (typeof body.hourNow === 'number' && Number.isFinite(body.hourNow)) saved = skyAtHour(saved, body.hourNow, now);
    apply(ctx, saved);
    store.addJournal(`${account.name} set the sky: a ${minutesWords(saved.dayMinutes)} day, ${Math.round((saved.nightShare ?? NATURAL_NIGHT_SHARE) * 100)}% of it night, weather that turns every ${minutesWords(saved.weatherMinutes)}.`, account.id);
    return json(res, 200, { ok: true, sky: world.sky }), true;
  }

  if (route === 'sky/now' && method === 'POST') {
    const body = (await ctx.readJson(req)) ?? {};
    const now = ctx.now();
    const base = savedOrEnv(ctx);
    if (typeof body.hour === 'number') {
      if (!Number.isFinite(body.hour) || body.hour < 0 || body.hour >= 24) return json(res, 400, { error: 'bad_hour', message: 'Choose an hour from 0 to 23.' }), true;
      // Lengths stay; only where the day stands moves. The world's clock is the one players see.
      apply(ctx, skyAtHour(retimeSky(world.sky, base, now), body.hour, now));
      store.addJournal(`${account.name} set the hour to ${String(Math.floor(body.hour)).padStart(2, '0')}:00 in every land.`, account.id);
      return json(res, 200, { ok: true, sky: world.sky }), true;
    }
    const land = typeof body.region === 'string' ? world.defs().find((d) => d.id === body.region) : undefined;
    const weather = body.weather as Weather;
    if (!land || !WEATHERS.includes(weather)) return json(res, 400, { error: 'bad_weather', message: 'Choose a land and a weather.' }), true;
    if (world.region(land.id)?.map.weather) return json(res, 400, { error: 'fixed', message: `${land.name} has its own weather from the world editor. Change it there.` }), true;
    if (!world.sky.weather) return json(res, 400, { error: 'weather_off', message: 'Weather is switched off, so every land stays clear.' }), true;
    apply(ctx, forceWeather(retimeSky(world.sky, base, now), land.id, weather, now));
    store.addJournal(`${account.name} called ${weather} over ${land.name} for one spell of weather.`, account.id);
    return json(res, 200, { ok: true, weather: weatherAt(land.id, land.biome, now, world.sky) }), true;
  }

  return false;
}
