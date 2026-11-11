import { BUILDING_STYLES } from '../../buildings.ts';
import { MAX_FLOORS, addStorey } from '../../floors.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside } from '../tiles.ts';

/** Floors a storey may stand on: every floor but the ground. */
const STOREYS = Array.from({ length: MAX_FLOORS.up + MAX_FLOORS.down + 1 }, (_, i) => MAX_FLOORS.up - i).filter((n) => n !== 0);

/** A floor above or below the ground over a rectangle: a walled room, or an open terrace. */
export const STOREY: EditKind<'storey'> = {
  kind: 'storey',
  name: 'Storey',
  hint: 'Click one corner, then the opposite corner, to lay a floor above or below the ground there, at least 3 × 3. An open terrace has low walls and no roof.',
  pointer: 'two-clicks',
  fields: [
    { key: 'storey', label: 'Floor', type: 'choice', choices: () => STOREYS.map((n) => ({ id: String(n), name: n > 0 ? `${n} up` : `${-n} down` })), default: () => '1' },
    { key: 'style', label: 'Look', type: 'choice', choices: () => Object.values(BUILDING_STYLES).map((s) => ({ id: s.id, name: s.name })) },
    { key: 'open', label: 'Open terrace', type: 'flag', default: false },
  ],
  shape: '{"kind":"storey","at":[x,y],"size":[w,h],"storey":1,"style":"<styleId>","open":true}',
  outline(_map, { at, from }) {
    if (!from) return [{ x: at[0], y: at[1], w: 1, h: 1 }];
    return [{ x: Math.min(from[0], at[0]), y: Math.min(from[1], at[1]), w: Math.abs(at[0] - from[0]) + 1, h: Math.abs(at[1] - from[1]) + 1, tone: 'held' }];
  },
  make(use, v) {
    const from = use.from ?? use.at;
    const at: [number, number] = [Math.min(from[0], use.at[0]), Math.min(from[1], use.at[1])];
    const size: [number, number] = [Math.abs(use.at[0] - from[0]) + 1, Math.abs(use.at[1] - from[1]) + 1];
    return { kind: 'storey', at, size, storey: Number(v.storey), style: String(v.style), ...(v.open ? { open: true } : {}) };
  },
  check(map, edit) {
    if (!STOREYS.includes(edit.storey)) return `A storey stands on a floor from ${MAX_FLOORS.down} below the ground to ${MAX_FLOORS.up} above it, not on the ground.`;
    if (!BUILDING_STYLES[edit.style]) return 'There is no look of that name.';
    const [w, h] = Array.isArray(edit.size) ? edit.size : [NaN, NaN];
    if (![w, h].every((n) => Number.isInteger(n) && n >= 3)) return 'A storey is at least 3 tiles a side.';
    return inside(map, edit.at) && inside(map, [edit.at[0] + w - 1, edit.at[1] + h - 1]) ? undefined : OFF_EDGE;
  },
  apply(map, edit) {
    if (!BUILDING_STYLES[edit.style]) return false;
    try {
      addStorey(map, { x: edit.at[0], y: edit.at[1], width: edit.size[0], height: edit.size[1] }, edit.storey, edit.style, undefined, edit.open);
      return true;
    } catch {
      return false;
    }
  },
  keep: (d) => ({ kind: 'storey', at: d.at, size: d.size, storey: d.storey, style: d.style, ...(d.open ? { open: true } : {}) }),
  words: (e) => `${e.open ? 'A terrace' : 'A storey'} ${e.storey > 0 ? `${e.storey} up` : `${-e.storey} down`}, ${e.size[0]} × ${e.size[1]}, at ${e.at.join(', ')}`,
};
