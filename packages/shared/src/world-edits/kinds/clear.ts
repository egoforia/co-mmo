import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside } from '../tiles.ts';
import { MAX_CLEAR_RADIUS } from '../types.ts';

/** Sends away every monster living near a spot. */
export const CLEAR: EditKind<'clear'> = {
  kind: 'clear',
  name: 'Clear',
  hint: 'Click to send away every monster living near that spot.',
  pointer: 'click',
  fields: [{ key: 'radius', label: 'Tiles around', type: 'number', min: 1, max: MAX_CLEAR_RADIUS, default: 6 }],
  shape: '{"kind":"clear","at":[x,y],"radius":6}',
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    return typeof edit.radius === 'number' && edit.radius > 0 && edit.radius <= MAX_CLEAR_RADIUS ? undefined : `Clear 1 to ${MAX_CLEAR_RADIUS} tiles around.`;
  },
  apply(map, edit) {
    map.creatures = map.creatures.filter((c) => Math.hypot(c.x - edit.at[0] - 0.5, c.y - edit.at[1] - 0.5) > edit.radius);
  },
  keep: (d) => ({ kind: 'clear', at: d.at, radius: d.radius }),
  words: (e) => `Cleared monsters within ${e.radius} of ${e.at.join(', ')}`,
};
