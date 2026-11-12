import { MAX_LIGHT_RADIUS, MIN_LIGHT_RADIUS, cleanLight } from '../../light.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, floorOf, inside } from '../tiles.ts';

// A light on its own: a glow on a tile of any floor with no piece to give it
// off (a lamp the art does not show, moonlight through a gap, a magic glow).
// Light is a rule, not a picture (light.ts); the game lights what is near.

/** The colours the editor offers, by name. */
const COLOURS: Record<string, { name: string; color: string }> = {
  flame: { name: 'Firelight', color: '#ffb35c' },
  lamp: { name: 'Lamplight', color: '#ffd27a' },
  holy: { name: 'Soft gold', color: '#ffe9b0' },
  moon: { name: 'Moonlight', color: '#b8d0ff' },
  sea: { name: 'Sea green', color: '#7fffd4' },
  arcane: { name: 'Arcane violet', color: '#c49bff' },
  ember: { name: 'Ember red', color: '#ff6a4d' },
};

/** A light of a colour and reach, standing on a tile of a floor. */
export const LIGHT: EditKind<'light'> = {
  kind: 'light',
  name: 'Light',
  hint: 'Choose a colour and how far it reaches, then click where it shines. It lights what is near, brighter after dark; to take it away, Select it.',
  pointer: 'click',
  onFloors: true,
  fields: [
    { key: 'color', label: 'Colour', type: 'choice', choices: () => Object.entries(COLOURS).map(([id, c]) => ({ id, name: c.name })) },
    { key: 'radius', label: 'Reach in tiles', type: 'number', min: MIN_LIGHT_RADIUS, max: MAX_LIGHT_RADIUS, default: 3 },
    { key: 'flicker', label: 'Flickers like a flame', type: 'flag', default: false },
  ],
  shape: '{"kind":"light","at":[x,y],"color":"#ffb35c","radius":3,"flicker":true}',
  make: (use, v) => ({ kind: 'light', at: use.at, color: COLOURS[String(v.color)]?.color ?? COLOURS.lamp!.color, radius: Number(v.radius), ...(v.flicker ? { flicker: true } : {}) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    if (typeof edit.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(edit.color)) return 'Pick a colour for the light.';
    if (!Number.isFinite(edit.radius) || edit.radius < MIN_LIGHT_RADIUS || edit.radius > MAX_LIGHT_RADIUS) return `A light reaches ${MIN_LIGHT_RADIUS} to ${MAX_LIGHT_RADIUS} tiles.`;
    return map.lights?.some((l) => l.floor === floorOf(edit) && Math.floor(l.x) === edit.at[0] && Math.floor(l.y) === edit.at[1]) ? 'A light already shines there.' : undefined;
  },
  apply(map, edit) {
    const light = cleanLight({ color: edit.color, radius: edit.radius, flicker: edit.flicker });
    if (!light) return false;
    (map.lights ??= []).push({ id: edit.id, x: edit.at[0] + 0.5, y: edit.at[1] + 0.5, floor: floorOf(edit), light });
    return true;
  },
  keep: (d) => ({ kind: 'light', at: d.at, color: d.color.toLowerCase(), radius: d.radius, ...(d.flicker ? { flicker: true } : {}) }),
  words: (e) => `A light reaching ${e.radius} tiles at ${e.at.join(', ')}`,
};
