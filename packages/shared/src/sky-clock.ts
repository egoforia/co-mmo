// The sky's clock: where the day stands and which spell of weather it is,
// counted from an anchor. Without one the day starts at the epoch, so the
// hour is the clock divided by the day's length as it always was. A change
// of length makes a new anchor at "now, this hour, this spell", so the hour
// and the weather carry on where they were instead of jumping.
//
// The night share warps the hours: night's game hours (20 to 5) pass faster
// or slower so that night takes the chosen share of a real day, while dawn,
// day and dusk keep their game hours. Everything that reads the hour (light,
// NPC routines, creatures, scripted rules, quests) follows with no change.

/** At server time `at` (epoch ms), the day stood at `phase` (0 to 1, game hours / 24) and `spell` spells of weather had passed. */
export interface SkyAnchor {
  at: number;
  phase: number;
  /** Spells of weather counted so far, with a fraction for how far into this one. */
  spell: number;
}

/** What the clock needs from a sky config. */
export interface SkyTiming {
  dayMinutes: number;
  weatherMinutes: number;
  /** Share of a real day that is night; unset keeps the game's own 9 of 24 hours. */
  nightShare?: number;
  anchor?: SkyAnchor;
}

/** The game's own night: hours 20 to 5. */
const NIGHT_FROM = 20;
const NIGHT_TO = 5;
const NIGHT_HOURS = 24 - NIGHT_FROM + NIGHT_TO;
/** Night's share of the day when nothing warps it. */
export const NATURAL_NIGHT_SHARE = NIGHT_HOURS / 24;
/** The night share may be set between these, so a day always has a dark and a light part. */
export const NIGHT_SHARE_LIMITS = { min: 0.15, max: 0.6 };
/** The anchor of a sky that was never retimed: the epoch, at midnight. */
export const START_ANCHOR: SkyAnchor = { at: 0, phase: 0, spell: 0 };

const frac = (n: number) => n - Math.floor(n);

/** Where the real day's share `u` (0 to 1) stands in game hours / 24, with night taking `share` of it. */
export function warpPhase(u: number, share: number): number {
  if (share === NATURAL_NIGHT_SHARE) return u;
  const early = (share * NIGHT_TO) / NIGHT_HOURS;
  const light = 1 - share;
  if (u < early) return ((u / early) * NIGHT_TO) / 24;
  if (u < early + light) return (NIGHT_TO + ((u - early) / light) * (NIGHT_FROM - NIGHT_TO)) / 24;
  const late = 1 - early - light;
  return (NIGHT_FROM + ((u - early - light) / late) * (24 - NIGHT_FROM)) / 24;
}

/** The real day's share at a game phase: the inverse of warpPhase. */
export function unwarpPhase(phase: number, share: number): number {
  if (share === NATURAL_NIGHT_SHARE) return phase;
  const h = phase * 24;
  const early = (share * NIGHT_TO) / NIGHT_HOURS;
  const light = 1 - share;
  if (h < NIGHT_TO) return (h / NIGHT_TO) * early;
  if (h < NIGHT_FROM) return early + ((h - NIGHT_TO) / (NIGHT_FROM - NIGHT_TO)) * light;
  return early + light + ((h - NIGHT_FROM) / (24 - NIGHT_FROM)) * (1 - early - light);
}

function shareOf(sky: SkyTiming): number {
  return sky.nightShare ?? NATURAL_NIGHT_SHARE;
}

/** Where the day is at `ms`, from 0 (midnight) to just under 1, in game hours / 24. */
export function dayPhase(ms: number, sky: SkyTiming): number {
  const a = sky.anchor ?? START_ANCHOR;
  const share = shareOf(sky);
  const u = frac(unwarpPhase(a.phase, share) + (ms - a.at) / (sky.dayMinutes * 60_000));
  return warpPhase(u, share);
}

/** Spells of weather passed at `ms`, with a fraction for how far into this one. */
export function spellCount(ms: number, sky: SkyTiming): number {
  const a = sky.anchor ?? START_ANCHOR;
  return a.spell + (ms - a.at) / (sky.weatherMinutes * 60_000);
}

/** When the spell of weather going on at `ms` ends. */
export function spellEnds(ms: number, sky: SkyTiming): number {
  const a = sky.anchor ?? START_ANCHOR;
  return a.at + (Math.floor(spellCount(ms, sky)) + 1 - a.spell) * sky.weatherMinutes * 60_000;
}

/** A sky with new lengths (or night share) that carries on from `old` at `now`: same hour, same spell. */
export function retimeSky<T extends SkyTiming>(old: SkyTiming, next: T, now: number): T {
  return { ...next, anchor: { at: now, phase: dayPhase(now, old), spell: spellCount(now, old) } };
}

/** The same sky, set to game hour `hour` (0 to 24) at `now`, its weather carrying on. */
export function skyAtHour<T extends SkyTiming>(sky: T, hour: number, now: number): T {
  return { ...sky, anchor: { at: now, phase: frac(hour / 24), spell: spellCount(now, sky) } };
}

/** The server time, at or after `from`, when the day next stands at game hour `hour`. */
export function nextHour(hour: number, from: number, sky: SkyTiming): number {
  const share = shareOf(sky);
  const day = sky.dayMinutes * 60_000;
  const now = unwarpPhase(dayPhase(from, sky), share);
  return from + frac(unwarpPhase(frac(hour / 24), share) - now) * day;
}
