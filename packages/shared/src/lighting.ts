import { gameHour, type Weather } from './sky.ts';
import { FLAME_LIGHT, type Light } from './light.ts';

// How the world is lit, as numbers both the game's lighting and God's View's
// previews use. Pictures are painted light-neutral; the light comes from
// here: the sky's colour all round, a sun that rises low and warm on the
// left, stands overhead at midday and sets low and orange on the right, a
// dim cool moon overhead at night, and lamps (light.ts). Characters get a
// faint rim light so they stay readable under any of it. No shadows yet.
//
// Directions are as a picture's normal map has them: x to the right, y up
// the screen, z out of the screen towards the viewer.

/** A light from far away: which way it shines from, and its colour times its strength. */
export interface Sun {
  /** Unit vector from a surface towards the sun or moon. */
  dir: [number, number, number];
  /** Colour times strength, 0 to about 1 a channel. */
  color: [number, number, number];
}

/** The light everything gets from the sky whatever way it faces, as a share of the sky's colour. */
export const SKY_FILL = 0.55;
/** The faint light on a character's outline, so they stand out at any hour. */
export const RIM_LIGHT: [number, number, number] = [0.32, 0.34, 0.4];

/** The sun or moon at set hours of the game day, eased between. */
const KEYS: { hour: number; dir: [number, number, number]; color: [number, number, number] }[] = [
  { hour: 0, dir: [0, 0.25, 1], color: [0.3, 0.36, 0.55] }, // the moon, overhead, dim and cool
  { hour: 4.5, dir: [0, 0.25, 1], color: [0.3, 0.36, 0.55] },
  { hour: 6, dir: [-0.85, 0.2, 0.5], color: [0.62, 0.42, 0.26] }, // dawn, low on the left, warm
  { hour: 9, dir: [-0.5, 0.25, 0.85], color: [0.5, 0.46, 0.4] },
  { hour: 12.5, dir: [0, 0.25, 1], color: [0.45, 0.45, 0.45] }, // midday, overhead, neutral
  { hour: 16, dir: [0.5, 0.25, 0.85], color: [0.5, 0.45, 0.38] },
  { hour: 19, dir: [0.85, 0.2, 0.5], color: [0.66, 0.36, 0.18] }, // dusk, low on the right, orange
  { hour: 20.5, dir: [0, 0.25, 1], color: [0.3, 0.36, 0.55] },
  { hour: 24, dir: [0, 0.25, 1], color: [0.3, 0.36, 0.55] },
];

/** How much of the sun gets through each weather; the rest is spread into the sky's light. */
const THROUGH: Record<Weather, number> = { clear: 1, cloudy: 0.45, rain: 0.3, storm: 0.2, fog: 0.25, snow: 0.45, sandstorm: 0.35 };

const unit = (v: [number, number, number]): [number, number, number] => {
  const len = Math.hypot(...v) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i]! - x) * t) as [number, number, number];

/** The sun or moon at `phase` of the day (0 midnight) in `weather`. */
export function sunAt(phase: number, weather: Weather = 'clear'): Sun {
  const h = gameHour(phase);
  const i = Math.max(0, KEYS.findIndex((k) => k.hour > h) - 1);
  const a = KEYS[i]!;
  const b = KEYS[i + 1] ?? a;
  const t = b.hour > a.hour ? (h - a.hour) / (b.hour - a.hour) : 0;
  const eased = (1 - Math.cos(Math.PI * t)) / 2;
  const through = THROUGH[weather] ?? 1;
  return { dir: unit(mix(a.dir, b.dir, eased)), color: mix(a.color, b.color, eased).map((c) => c * through) as [number, number, number] };
}

/** How much the sky lights everything all round at `weather`: more when clouds spread the sun. */
export function skyFill(weather: Weather = 'clear'): number {
  return SKY_FILL + (1 - (THROUGH[weather] ?? 1)) * 0.35;
}

/**
 * The light reaching a surface facing `normal`, as a colour: the sky's
 * colour all round plus the sun or moon on the side facing it, plus the rim
 * light when `rim` (characters). The game's shader does the same sum.
 */
export function lightOn(normal: [number, number, number], sky: [number, number, number], sun: Sun, fill: number, rim = false): [number, number, number] {
  const facing = Math.max(0, normal[0] * sun.dir[0] + normal[1] * sun.dir[1] + normal[2] * sun.dir[2]);
  const edge = rim ? (1 - Math.min(1, Math.max(0, normal[2]))) ** 2 : 0;
  return [0, 1, 2].map((c) => sky[c]! * (fill + sun.color[c]! * facing) + RIM_LIGHT[c]! * edge) as [number, number, number];
}

/** A lantern's or candle's steady warm light. */
const LAMP_LIGHT: Light = { color: '#ffd27a', radius: 2.5, flicker: true };
/** A shrine's or altar's soft gold, steady. */
const HOLY_LIGHT: Light = { color: '#ffe9b0', radius: 3 };
/** The warm light from a building's windows after dark. */
export const WINDOW_LIGHT: Light = { color: '#ffc477', radius: 2.5 };

/**
 * The light a set piece or piece of furniture gives off, from its art id:
 * fires, lanterns and shrines glow; everything else is lit, not lighting.
 */
export function glowOf(asset: string): Light | undefined {
  if (/moth|firebolt|item-|scroll-/.test(asset)) return undefined;
  if (/brazier|hearth|campfire|bonfire|torch|forge|fire-?pit|fireplace/.test(asset)) return FLAME_LIGHT;
  if (/lantern|lamp|candle/.test(asset)) return LAMP_LIGHT;
  if (/shrine|altar/.test(asset)) return HOLY_LIGHT;
  return undefined;
}

/**
 * The light a lamp adds to a surface facing `normal`, `dx` and `dy` from it
 * towards the lamp (y up the screen) in the same units as `radius`: it fades
 * to nothing at its reach and lights the side facing it, as the game's
 * shader does.
 */
export function lampOn(normal: [number, number, number], dx: number, dy: number, radius: number, color: [number, number, number], intensity: number): [number, number, number] {
  const len = Math.hypot(dx, dy, 0.1 * radius) || 1;
  const facing = Math.max(0, (normal[0] * dx + normal[1] * dy + normal[2] * 0.1 * radius) / len);
  const reach = Math.max(0, 1 - (dx * dx + dy * dy) / (radius * radius));
  return color.map((c) => c * facing * reach * intensity) as [number, number, number];
}

/** The hours God's View previews a picture's light at. */
export const PREVIEW_HOURS: { label: string; hour: number }[] = [
  { label: 'Dawn', hour: 6 },
  { label: 'Midday', hour: 12.5 },
  { label: 'Dusk', hour: 19 },
  { label: 'Night', hour: 23 },
];
