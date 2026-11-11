// Pins the sky for a shot without touching the game's clock. The hour a land
// shows is the real clock divided by the day's length, and its weather is
// picked per spell of weather, so a day length and a spell length chosen for
// "now" give the hour and weather a shot asks for. Days are made long (about a
// real day) so the light barely moves while the picture is taken.

import { weatherAt, type BiomeId, type SkyConfig, type Weather } from '@co-mmo/shared';

const MINUTE = 60_000;
/** About a real day per game day: an hour of light moves in an hour. */
const LONG_DAY_MINUTES = 1400;
/** Spells this long or longer, so the weather can't turn mid-shot. */
const LONG_SPELL_MINUTES = 600;
/** How long a shot may take before its weather could turn. */
const SHOT_MINUTES = 20;

/** A sky that shows `hour` (0-24) and `weather` over this land at `now`, or why it can't. */
export function pinnedSky(regionId: string, biome: BiomeId, hour: number, weather: Weather, now = Date.now()): SkyConfig | string {
  const target = (((hour % 24) + 24) % 24) / 24;
  // Whole days so far at a long day's length, then the length that lands `now` on the hour.
  const days = Math.floor(now / (LONG_DAY_MINUTES * MINUTE));
  const dayMinutes = now / (days + target) / MINUTE;
  if (weather === 'clear') return { dayMinutes, weatherMinutes: LONG_SPELL_MINUTES, weather: false };
  // Try spell lengths until this land's spell at `now` has the weather, with time left in it.
  for (let tenths = LONG_SPELL_MINUTES * 10; tenths < LONG_SPELL_MINUTES * 30; tenths++) {
    const weatherMinutes = tenths / 10;
    const spell = weatherMinutes * MINUTE;
    if (spell - (now % spell) < SHOT_MINUTES * MINUTE) continue;
    const sky = { dayMinutes, weatherMinutes, weather: true };
    if (weatherAt(regionId, biome, now, sky) === weather) return sky;
  }
  return `The ${biome} land never has ${weather}.`;
}
