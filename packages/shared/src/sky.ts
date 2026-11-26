import type { BiomeId } from './biomes.ts';
import { hash2 } from './random.ts';
import { NIGHT_SHARE_LIMITS, spellCount, spellEnds, type SkyTiming } from './sky-clock.ts';

// The sky over the world: a day that turns into night and weather that comes
// and goes, land by land. Both follow from the time and the region alone, so
// every server (the gateway, each region server, each cell of a split
// region) and every player's screen agree without telling each other.
// Colours here are a light grade multiplied over the scene, like a biome's
// light tint: nothing is drawn.

/** How the sky turns: saved from God's View's Sky tab, first from `.env` (DAY_MINUTES, WEATHER_MINUTES, WEATHER). */
export interface SkyConfig extends SkyTiming {
  /** Real minutes in one game day, dawn to dawn. */
  dayMinutes: number;
  /** Real minutes a spell of weather lasts before the next one. */
  weatherMinutes: number;
  /** False keeps every land clear. */
  weather: boolean;
  /** Seconds a new weather takes to roll in on screen; unset, about a second. */
  fadeSeconds?: number;
  /** The Owner's weather odds for some lands, in place of the game's own (BIOME_WEATHER). */
  odds?: Partial<Record<BiomeId, Partial<Record<Weather, number>>>>;
  /** Weather set now over some lands (God's View, Sky tab), by region id, until a server time; then their usual odds return. */
  forced?: Record<string, { weather: Weather; until: number }>;
}

/** A two-hour day with a third of it night, weather spells of 45 minutes that roll in over a minute. */
export const DEFAULT_SKY: SkyConfig = { dayMinutes: 120, weatherMinutes: 45, weather: true, nightShare: 1 / 3, fadeSeconds: 60 };

/** Shortest and longest days and weather spells, so a typo cannot strobe the sky or stop it. */
export const SKY_LIMITS = { minDayMinutes: 10, maxDayMinutes: 7 * 24 * 60, minMinutes: 2, maxMinutes: 24 * 60, maxFadeSeconds: 600, maxOdds: 10 };

/** The same sky with `weather` over one land from `now` for one spell, then its usual odds again. */
export function forceWeather(sky: SkyConfig, regionId: string, weather: Weather, now: number): SkyConfig {
  const forced = Object.fromEntries(Object.entries(sky.forced ?? {}).filter(([, f]) => f.until > now));
  forced[regionId] = { weather, until: now + sky.weatherMinutes * 60_000 };
  return { ...sky, forced };
}

/** A sky config with every number within bounds. */
export function cleanSky(raw: Partial<SkyConfig> = {}): SkyConfig {
  const within = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Number(v);
    return v !== undefined && v !== null && Number.isFinite(n) && n >= 0 ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  const sky: SkyConfig = {
    dayMinutes: Number(raw.dayMinutes) > 0 ? within(raw.dayMinutes, SKY_LIMITS.minDayMinutes, SKY_LIMITS.maxDayMinutes, DEFAULT_SKY.dayMinutes) : DEFAULT_SKY.dayMinutes,
    weatherMinutes: Number(raw.weatherMinutes) > 0 ? within(raw.weatherMinutes, SKY_LIMITS.minMinutes, SKY_LIMITS.maxMinutes, DEFAULT_SKY.weatherMinutes) : DEFAULT_SKY.weatherMinutes,
    weather: raw.weather !== false,
    nightShare: within(raw.nightShare, NIGHT_SHARE_LIMITS.min, NIGHT_SHARE_LIMITS.max, DEFAULT_SKY.nightShare!),
    fadeSeconds: within(raw.fadeSeconds, 0, SKY_LIMITS.maxFadeSeconds, DEFAULT_SKY.fadeSeconds!),
  };
  const odds = cleanOdds(raw.odds);
  if (odds) sky.odds = odds;
  const forced = Object.entries(raw.forced ?? {}).filter(([, f]) => f && WEATHERS.includes(f.weather) && Number.isFinite(f.until));
  if (forced.length) sky.forced = Object.fromEntries(forced.map(([id, f]) => [id, { weather: f.weather, until: f.until }]));
  const a = raw.anchor;
  if (a && [a.at, a.phase, a.spell].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    sky.anchor = { at: a.at, phase: a.phase - Math.floor(a.phase), spell: a.spell };
  }
  return sky;
}

/** The Owner's odds with only known lands and weathers, each 0 to 10; none left is none at all. */
function cleanOdds(raw: SkyConfig['odds']): SkyConfig['odds'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: NonNullable<SkyConfig['odds']> = {};
  for (const biome of Object.keys(BIOME_WEATHER) as BiomeId[]) {
    const given = raw[biome];
    if (!given || typeof given !== 'object') continue;
    const odds: Partial<Record<Weather, number>> = {};
    for (const w of WEATHERS) {
      const n = Number(given[w]);
      if (given[w] !== undefined && Number.isFinite(n) && n > 0) odds[w] = Math.min(SKY_LIMITS.maxOdds, n);
    }
    if (Object.keys(odds).length) out[biome] = odds;
  }
  return Object.keys(out).length ? out : undefined;
}

// --- Day and night -------------------------------------------------------------

export type DayPart = 'dawn' | 'day' | 'dusk' | 'night';

/** Hours of the game day where each part begins. */
const DAWN = 5;
const DAY = 7;
const DUSK = 18;
const NIGHT = 20;

/** The game's hour, 0 to just under 24. */
export function gameHour(phase: number): number {
  return phase * 24;
}

export function dayPart(phase: number): DayPart {
  const h = gameHour(phase);
  if (h >= DAWN && h < DAY) return 'dawn';
  if (h >= DAY && h < DUSK) return 'day';
  if (h >= DUSK && h < NIGHT) return 'dusk';
  return 'night';
}

/** How dark it is, 0 (full day) to 1 (deep night), easing through dawn and dusk. */
export function darkness(phase: number): number {
  const h = gameHour(phase);
  const ease = (t: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t)))) / 2;
  if (h < DAWN || h >= NIGHT) return 1;
  if (h < DAY) return 1 - ease((h - DAWN) / (DAY - DAWN));
  if (h < DUSK) return 0;
  return ease((h - DUSK) / (NIGHT - DUSK));
}

/** How much of dawn's or dusk's warm glow is in the sky, 0 to 1, strongest halfway through. */
function glow(phase: number): number {
  const h = gameHour(phase);
  const peak = (from: number, to: number) => (h >= from && h < to ? Math.sin(Math.PI * ((h - from) / (to - from))) : 0);
  return Math.max(peak(DAWN, DAY), peak(DUSK, NIGHT));
}

// --- Weather -------------------------------------------------------------------

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'sandstorm';

/** Every kind of weather, in the order God's View lists them. */
export const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'sandstorm'];

/** How likely each weather is in each land; a land's character shows in its sky. */
export const BIOME_WEATHER: Record<BiomeId, Partial<Record<Weather, number>>> = {
  sanctum: { clear: 6, cloudy: 2, rain: 1 },
  'verdant-meadows': { clear: 5, cloudy: 3, rain: 2, storm: 1 },
  'whispering-woods': { clear: 3, cloudy: 2, rain: 3, fog: 3, storm: 1 },
  'mushroom-hollow': { clear: 2, cloudy: 2, rain: 2, fog: 4 },
  'sunlit-shore': { clear: 5, cloudy: 2, rain: 2, storm: 2, fog: 1 },
  frostpeak: { clear: 2, cloudy: 2, snow: 5, fog: 1, storm: 1 },
  'ember-wastes': { clear: 3, cloudy: 3, storm: 1 },
  'mirage-desert': { clear: 6, cloudy: 1, sandstorm: 2 },
  'murkmire-swamp': { cloudy: 2, rain: 3, fog: 4, storm: 1 },
  'sky-ruins': { clear: 4, cloudy: 3, storm: 2, fog: 1 },
};

/** A seed from a region's id, so lands side by side have their own weather. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h | 0;
}

/** How likely each weather is over a land: the Owner's odds where set, else the game's own. */
export function weatherOdds(biome: BiomeId, sky: Pick<SkyConfig, 'odds'>): Partial<Record<Weather, number>> {
  return sky.odds?.[biome] ?? BIOME_WEATHER[biome] ?? { clear: 1 };
}

/** The weather a land has in spell number `spell`: the same answer on every server and screen. */
function weatherOfSpell(regionId: string, biome: BiomeId, spell: number, sky: SkyConfig): Weather {
  const odds = Object.entries(weatherOdds(biome, sky)) as [Weather, number][];
  const total = odds.reduce((s, [, w]) => s + w, 0);
  let r = (hash2(spell, 7, seedOf(regionId)) / 4294967296) * total;
  for (const [weather, w] of odds) if ((r -= w) < 0) return weather;
  return 'clear';
}

/** The weather over a region at `ms`: the same answer on every server and screen. */
export function weatherAt(regionId: string, biome: BiomeId, ms: number, sky: SkyConfig): Weather {
  if (!sky.weather) return 'clear';
  const forced = sky.forced?.[regionId];
  if (forced && ms < forced.until) return forced.weather;
  return weatherOfSpell(regionId, biome, Math.floor(spellCount(ms, sky)), sky);
}

/** The weather that comes next over a region, and when it starts. */
export function nextWeather(regionId: string, biome: BiomeId, ms: number, sky: SkyConfig): { weather: Weather; at: number } {
  const forced = sky.forced?.[regionId];
  if (sky.weather && forced && ms < forced.until) return { weather: weatherAt(regionId, biome, forced.until, sky), at: forced.until };
  const at = spellEnds(ms, sky);
  return { weather: sky.weather ? weatherOfSpell(regionId, biome, Math.floor(spellCount(ms, sky)) + 1, sky) : 'clear', at };
}

/** How each weather greys or warms the light, multiplied over the scene. */
const WEATHER_TINT: Record<Weather, number> = {
  clear: 0xffffff,
  cloudy: 0xdcdde6,
  rain: 0xb9c3d2,
  storm: 0x8f99ae,
  fog: 0xd4d9de,
  snow: 0xe2e9f5,
  sandstorm: 0xe6c690,
};

/** Deep night's blue, and dawn and dusk's warm glow. */
const NIGHT_TINT = 0x5866a8;
const GLOW_TINT = 0xffbf96;

/** The sky's colour over a land: its biome light, the hour and the weather, multiplied together. */
export function skyTint(biomeTint: number, phase: number, weather: Weather): number {
  const hour = mix(mix(0xffffff, GLOW_TINT, glow(phase) * 0.6), NIGHT_TINT, darkness(phase));
  return multiply(multiply(biomeTint, hour), WEATHER_TINT[weather]);
}

/** The time of day and weather in a few plain words, as players read them. */
export function skyWords(phase: number, weather: Weather): string {
  const part = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' }[dayPart(phase)];
  const sky = { clear: 'clear skies', cloudy: 'cloudy', rain: 'rain', storm: 'a storm', fog: 'fog', snow: 'snow', sandstorm: 'a sandstorm' }[weather];
  return `${part}, ${sky}`;
}

/** How long before the weather turns players are told it is coming. */
export const WEATHER_SOON_MS = 2 * 60_000;

/** What players hear a little before the weather turns. */
export const WEATHER_SOON: Record<Weather, string> = {
  clear: 'The clouds are thinning. Clear skies are on the way.',
  cloudy: 'Clouds are gathering on the horizon.',
  rain: 'The air smells of rain.',
  storm: 'Dark clouds gather. A storm is coming.',
  fog: 'A mist is rising. Fog will soon roll in.',
  snow: 'The air turns bitter cold. Snow is on the way.',
  sandstorm: 'The wind is picking up sand. A sandstorm is coming.',
};

/** What players hear when the weather turns. */
export const WEATHER_NEWS: Record<Weather, string> = {
  clear: 'The sky clears.',
  cloudy: 'Clouds roll in.',
  rain: 'It starts to rain.',
  storm: 'A storm breaks overhead.',
  fog: 'A fog creeps in. Creatures will not see you coming from far away.',
  snow: 'Snow begins to fall.',
  sandstorm: 'A sandstorm blows in. Creatures will not see you coming from far away.',
};

// --- What the sky means for living things --------------------------------------------

/** When a creature is up and about: by day, by night, or always. */
export type Active = 'day' | 'night' | 'always';

/** True when a creature is awake: day creatures sleep through the night, night creatures through the day. */
export function awake(active: Active | undefined, phase: number): boolean {
  if (!active || active === 'always') return true;
  const dark = darkness(phase) >= 0.5;
  return active === 'night' ? dark : !dark;
}

/**
 * How far a creature sees, as a share of its usual notice range. Darkness
 * hides players from day creatures and fog or blowing sand from everyone,
 * but anyone carrying a light is easy to spot; night creatures see best in
 * the dark.
 */
export function noticeScale(active: Active | undefined, phase: number, weather: Weather, preyLit: boolean): number {
  const dark = darkness(phase);
  let scale = active === 'night' ? 1 + 0.3 * dark : 1 - (preyLit ? 0 : 0.4 * dark);
  if (weather === 'fog' || weather === 'sandstorm') scale *= preyLit ? 0.85 : 0.6;
  else if (weather === 'storm') scale *= 0.85;
  return scale;
}

// --- Colours -------------------------------------------------------------------

function channels(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

function join([r, g, b]: number[]): number {
  return (Math.round(r!) << 16) | (Math.round(g!) << 8) | Math.round(b!);
}

/** Two colours blended, `t` of the way from a to b. */
export function mix(a: number, b: number, t: number): number {
  const ca = channels(a);
  const cb = channels(b);
  return join(ca.map((v, i) => v + (cb[i]! - v) * t));
}

function multiply(a: number, b: number): number {
  const ca = channels(a);
  const cb = channels(b);
  return join(ca.map((v, i) => (v * cb[i]!) / 255));
}
