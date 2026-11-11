import { MAX_FLOORS, addStairs } from '../../floors.ts';
import type { RegionMap } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside } from '../tiles.ts';
import type { DraftOf } from '../types.ts';

const HEADINGS = ['north', 'south', 'east', 'west'] as const;
/** Floors a flight may go up from: every floor with one above it. */
const FROM = Array.from({ length: MAX_FLOORS.up + MAX_FLOORS.down }, (_, i) => MAX_FLOORS.up - 1 - i);

/** Lays a flight; false when it has no open floor to step on or off. */
function lay(map: RegionMap, edit: DraftOf<'stairs'>): boolean {
  try {
    addStairs(map, { kind: edit.ladder ? 'ladder' : 'stairs', x: edit.at[0], y: edit.at[1], width: edit.size[0], height: edit.size[1], from: edit.from, climbs: edit.climbs ?? 'north' });
    return true;
  } catch {
    return false;
  }
}

/** A flight of stairs or a ladder between a floor and the one above it. */
export const STAIRS: EditKind<'stairs'> = {
  kind: 'stairs',
  name: 'Stairs',
  hint: 'Click where a flight of stairs or a ladder starts (its top-left tile). It needs open floor to step on below and off above.',
  pointer: 'click',
  fields: [
    { key: 'from', label: 'Up from floor', type: 'choice', choices: () => FROM.map((n) => ({ id: String(n), name: n === 0 ? 'the ground' : n > 0 ? `${n} up` : `${-n} down` })), default: () => '0' },
    { key: 'climbs', label: 'Climbing', type: 'choice', choices: () => HEADINGS.map((h) => ({ id: h, name: h })) },
    { key: 'width', label: 'Across', type: 'number', min: 1, max: 6, default: 2 },
    { key: 'height', label: 'Deep', type: 'number', min: 1, max: 6, default: 3 },
    { key: 'ladder', label: 'A ladder (monsters cannot climb it)', type: 'flag', default: false },
  ],
  shape: '{"kind":"stairs","at":[x,y],"size":[2,3],"from":0,"climbs":"north","ladder":false}',
  outline: (_map, { at }, v) => [{ x: at[0], y: at[1], w: Number(v.width) || 1, h: Number(v.height) || 1 }],
  make: (use, v) => ({ kind: 'stairs', at: use.at, size: [Number(v.width), Number(v.height)], from: Number(v.from), climbs: String(v.climbs) as DraftOf<'stairs'>['climbs'], ...(v.ladder ? { ladder: true } : {}) }),
  check(map, edit) {
    if (!FROM.includes(edit.from)) return `Stairs go up from a floor between ${MAX_FLOORS.down} below the ground and ${MAX_FLOORS.up - 1} above it.`;
    if (edit.climbs !== undefined && !HEADINGS.includes(edit.climbs)) return 'Stairs climb north, south, east or west.';
    const [w, h] = Array.isArray(edit.size) ? edit.size : [NaN, NaN];
    if (![w, h].every((n) => Number.isInteger(n) && n >= 1 && n <= 6)) return 'A flight is 1 to 6 tiles a side.';
    if (!inside(map, edit.at) || !inside(map, [edit.at[0] + w - 1, edit.at[1] + h - 1])) return OFF_EDGE;
    // Tried on a copy: it needs open floor at both ends.
    const { def, ...rest } = map;
    return lay({ ...structuredClone(rest), def }, edit) ? undefined : 'There is no open floor to step on below or off above. Lay the floors first, or move the stairs.';
  },
  apply: lay,
  keep: (d) => ({ kind: 'stairs', at: d.at, size: d.size, from: d.from, ...(d.climbs ? { climbs: d.climbs } : {}), ...(d.ladder ? { ladder: true } : {}) }),
  words: (e) => `${e.ladder ? 'A ladder' : 'Stairs'} up from ${e.from === 0 ? 'the ground' : e.from > 0 ? `floor ${e.from}` : `${-e.from} down`}, at ${e.at.join(', ')}`,
};
