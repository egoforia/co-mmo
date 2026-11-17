import { MAX_SAFE_RADIUS, safeAreas } from '../../safe-areas.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside } from '../tiles.ts';

/** Lays a safe area round a spot, or takes away those over it (radius 0). */
export const SAFE: EditKind<'safe'> = {
  kind: 'safe',
  name: 'Safe area',
  hint: 'Click the middle of a place where no player may hurt another and monsters stop chasing. Set the reach to 0 and click inside one to take it away.',
  pointer: 'click',
  fields: [{ key: 'radius', label: 'Tiles around', type: 'number', min: 0, max: MAX_SAFE_RADIUS, default: 8 }],
  shape: '{"kind":"safe","at":[x,y],"radius":8}',
  outline(map, { at }, v) {
    const r = Number(v.radius) || 0;
    const shown = r > 0 ? [{ x: at[0] + 0.5, y: at[1] + 0.5, radius: r }] : safeAreas(map);
    return shown.map((a) => ({ x: Math.floor(a.x - a.radius), y: Math.floor(a.y - a.radius), w: Math.ceil(a.radius * 2) + 1, h: Math.ceil(a.radius * 2) + 1, tone: r > 0 ? 'aim' as const : 'warn' as const }));
  },
  make: (use, v) => ({ kind: 'safe', at: use.at, radius: Number(v.radius) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    return typeof edit.radius === 'number' && edit.radius >= 0 && edit.radius <= MAX_SAFE_RADIUS ? undefined : `A safe area reaches 0 to ${MAX_SAFE_RADIUS} tiles.`;
  },
  apply(map, edit) {
    const x = edit.at[0] + 0.5;
    const y = edit.at[1] + 0.5;
    const areas = safeAreas(map);
    map.safe = edit.radius > 0 ? [...areas, { x, y, radius: edit.radius }] : areas.filter((a) => Math.hypot(x - a.x, y - a.y) > a.radius);
    return true;
  },
  keep: (d) => ({ kind: 'safe', at: d.at, radius: d.radius }),
  words: (e) => (e.radius > 0 ? `Safe area of ${e.radius} tiles round ${e.at.join(', ')}` : `Safe areas over ${e.at.join(', ')} taken away`),
};
