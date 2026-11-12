import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside } from '../tiles.ts';
import { MAX_CLEAR_RADIUS } from '../types.ts';

/** Sends away every monster living near a spot. */
export const CLEAR: EditKind<'clear'> = {
  kind: 'clear',
  name: 'Clear',
  hint: 'Click to send away every monster living near that spot.',
  pointer: 'click',
  onFloors: true,
  inspects: { picks: ['monster'], title: 'Clear monsters around it', action: 'Send them away' },
  fields: [{ key: 'radius', label: 'Tiles around', type: 'number', min: 1, max: MAX_CLEAR_RADIUS, default: 6 }],
  shape: '{"kind":"clear","at":[x,y],"radius":6}',
  outline(_map, { at }, v) {
    const r = Number(v.radius) || 1;
    return [{ x: at[0] - r, y: at[1] - r, w: r * 2 + 1, h: r * 2 + 1, tone: 'warn' }];
  },
  make: (use, v) => ({ kind: 'clear', at: use.at, radius: Number(v.radius) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    return typeof edit.radius === 'number' && edit.radius > 0 && edit.radius <= MAX_CLEAR_RADIUS ? undefined : `Clear 1 to ${MAX_CLEAR_RADIUS} tiles around.`;
  },
  // An edit saved before floors were named clears every floor, as it always did.
  apply(map, edit) {
    const there = (c: { floor?: number }) => edit.level === undefined || (c.floor ?? 0) === edit.level;
    map.creatures = map.creatures.filter((c) => !there(c) || Math.hypot(c.x - edit.at[0] - 0.5, c.y - edit.at[1] - 0.5) > edit.radius);
    return true;
  },
  keep: (d) => ({ kind: 'clear', at: d.at, radius: d.radius }),
  words: (e) => `Cleared monsters within ${e.radius} of ${e.at.join(', ')}`,
};
