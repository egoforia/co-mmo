// Point lighting: an item that burns or glows, held in a hand, casts a soft
// pool of light around its holder that pushes back the biome's shade. The
// light is a rule, not a picture: its colour, reach and whether it flickers
// like a flame are data on the item, checked here so a wish cannot light the
// whole world.

import { engineModId } from './mods.ts';

/** The light an item casts while held. */
export interface Light {
  /** Its colour as #rrggbb. */
  color: string;
  /** How far it reaches, in tiles. */
  radius: number;
  /** Flames flicker; glowing things shine steadily. */
  flicker?: boolean;
}

/** The farthest any light reaches, in tiles, so no wish lights a whole region. */
export const MAX_LIGHT_RADIUS = 4;
export const MIN_LIGHT_RADIUS = 1;

/** The Dynamic Point Lighting wish (issue #59): its lights shine only while this mod is on. */
export const LIGHT_MOD = engineModId(59);

/** The warm light of a flame, for a fire whose colour was not said. */
export const FLAME_LIGHT: Light = { color: '#ffb35c', radius: 3, flicker: true };

/** Checks a wished light: a colour, a reach within bounds; anything else is no light. */
export function cleanLight(raw: unknown): Light | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const l = raw as Record<string, unknown>;
  const color = typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color.toLowerCase() : FLAME_LIGHT.color;
  const radius = Math.min(MAX_LIGHT_RADIUS, Math.max(MIN_LIGHT_RADIUS, Number(l.radius) || FLAME_LIGHT.radius));
  return { color, radius: Math.round(radius * 2) / 2, ...(l.flicker === true ? { flicker: true } : {}) };
}

/**
 * How bright a light is at `ms`, from 0.75 to 1: steady lights always 1,
 * flames waver by a few overlapping waves so no two seeds burn in step.
 */
export function lightStrength(light: Light, ms: number, seed = 0): number {
  if (!light.flicker) return 1;
  const t = ms / 1000 + seed * 7.31;
  const wave = Math.sin(t * 9.1) * 0.5 + Math.sin(t * 15.7 + 1.3) * 0.3 + Math.sin(t * 23.3 + 2.9) * 0.2;
  return 0.875 + wave * 0.125;
}

/** How much light a lamp adds at its centre by day, on top of the sky's (1 is full daylight). */
const DAY_GLOW = 0.3;
/** How much it adds at night, when it is all that lights the ground. */
const NIGHT_GLOW = 1.4;

/**
 * How much light a lamp adds at its centre, from day (`dark` 0) to night
 * (1). Things near it show in their own painted colours, a little brighter
 * at the very centre; the light lights them, it is not painted over them.
 */
export function lightGlow(dark: number): number {
  const d = Math.min(1, Math.max(0, dark));
  return DAY_GLOW + (NIGHT_GLOW - DAY_GLOW) * d;
}
