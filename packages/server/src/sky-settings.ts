import { DEFAULT_SKY, cleanSky, type SkyConfig } from '@co-mmo/shared';

// How the sky turns, from what the Owner saved (God's View, Sky tab) and
// what `.env` says. The saved sky wins; `.env` is the first default. Only
// WEATHER=off still beats a saved sky, since tests and shots rely on it to
// keep every land clear.

/** The sky the world runs: the saved one over `.env`'s, with WEATHER=off forcing clear skies. */
export function effectiveSky(env: SkyConfig = DEFAULT_SKY, saved?: SkyConfig): SkyConfig {
  if (!saved) return env;
  const sky = cleanSky({ ...env, ...saved });
  return env.weather ? sky : { ...sky, weather: false };
}
