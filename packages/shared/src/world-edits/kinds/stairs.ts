import { MAX_FLOORS, addStairs, type Heading } from '../../floors.ts';
import { RAMP_LENGTHS, addRamp, rampProblem, rampTiles } from '../../floors/ramps.ts';
import type { RegionMap } from '../../world.ts';
import type { EditKind, FieldValue, Outline } from '../kind.ts';
import { OFF_EDGE, inside } from '../tiles.ts';
import type { DraftOf } from '../types.ts';

const HEADINGS = ['north', 'south', 'east', 'west'] as const;
/** Floors a flight may go up from: every floor with one above it. */
const FROM = Array.from({ length: MAX_FLOORS.up + MAX_FLOORS.down }, (_, i) => MAX_FLOORS.up - 1 - i);
/** The ways up the Stairs tool lays. */
const WAYS = [
  { id: 'stairs', name: 'Stairs' },
  { id: 'ladder', name: 'A ladder (monsters cannot climb it)' },
  { id: 'ramp', name: 'A ramp (1 wide, on the floor below only)' },
];
/** The looks a ramp's picture is painted in. */
export const RAMP_LOOKS = [
  { id: 'stone', name: 'Stone' },
  { id: 'wood', name: 'Wood' },
  { id: 'earth', name: 'Earth' },
];
const STEP: Record<Heading, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

type StairsEdit = DraftOf<'stairs'>;

/** Which way up an edit lays: `way`, or an older edit's `ladder: true`. */
export function stairsWay(edit: Pick<StairsEdit, 'way' | 'ladder'>): 'stairs' | 'ladder' | 'ramp' {
  return edit.way ?? (edit.ladder ? 'ladder' : 'stairs');
}

/** A ramp edit's plan: its length is the long side of its size. */
function rampPlan(edit: StairsEdit) {
  return { x: edit.at[0], y: edit.at[1], length: Math.max(...edit.size), from: edit.from, climbs: edit.climbs ?? 'north', ...(edit.look ? { look: edit.look } : {}) };
}

/** A ramp's tiles across and deep, rising this way. */
const rampSize = (length: number, climbs: Heading): [number, number] => (climbs === 'east' || climbs === 'west' ? [length, 1] : [1, length]);

/** Lays a flight; false when it has no open floor to step on or off. */
function lay(map: RegionMap, edit: StairsEdit): boolean {
  try {
    if (stairsWay(edit) === 'ramp') addRamp(map, rampPlan(edit));
    else addStairs(map, { kind: stairsWay(edit) === 'ladder' ? 'ladder' : 'stairs', x: edit.at[0], y: edit.at[1], width: edit.size[0], height: edit.size[1], from: edit.from, climbs: edit.climbs ?? 'north' });
    return true;
  } catch {
    return false;
  }
}

/** The ghost of a ramp: its foot and body, the spot over its head, and both landings. */
function rampOutline(at: [number, number], v: Record<string, FieldValue>): Outline[] {
  const climbs = (HEADINGS.includes(v.climbs as Heading) ? v.climbs : 'north') as Heading;
  const length = Number(v.length) || 2;
  const tiles = rampTiles({ x: at[0], y: at[1], length, climbs });
  const [dx, dy] = STEP[climbs];
  const foot = tiles[0]!;
  const head = tiles.at(-1)!;
  return [
    ...tiles.map((t) => ({ x: t.x, y: t.y, w: 1, h: 1 })),
    { x: foot.x - dx, y: foot.y - dy, w: 1, h: 1, tone: 'held' as const },
    { x: head.x + dx, y: head.y + dy, w: 1, h: 1, tone: 'held' as const },
  ];
}

/** A flight of stairs, a ladder or a ramp between a floor and the one above it. */
export const STAIRS: EditKind<'stairs'> = {
  kind: 'stairs',
  name: 'Stairs',
  hint: 'Click where a flight of stairs, a ladder or a ramp starts (its top-left tile). R turns which way it climbs. It needs open floor to step on below and off above.',
  pointer: 'click',
  fields: [
    { key: 'way', label: 'What', type: 'choice', choices: () => WAYS, default: () => 'stairs' },
    { key: 'from', label: 'Up from floor', type: 'choice', choices: () => FROM.map((n) => ({ id: String(n), name: n === 0 ? 'the ground' : n > 0 ? `${n} up` : `${-n} down` })), default: () => '0' },
    { key: 'climbs', label: 'Climbing', type: 'choice', choices: () => HEADINGS.map((h) => ({ id: h, name: h })), turns: true },
    { key: 'width', label: 'Across', type: 'number', min: 1, max: 6, default: 2, when: (v) => v.way !== 'ramp' },
    { key: 'height', label: 'Deep', type: 'number', min: 1, max: 6, default: 3, when: (v) => v.way !== 'ramp' },
    { key: 'length', label: 'Long', type: 'number', min: RAMP_LENGTHS[0], max: RAMP_LENGTHS.at(-1)!, default: 3, when: (v) => v.way === 'ramp' },
    { key: 'look', label: 'Look', type: 'choice', choices: () => RAMP_LOOKS, default: () => 'stone', when: (v) => v.way === 'ramp' },
  ],
  shape: '{"kind":"stairs","at":[x,y],"size":[2,3],"from":0,"climbs":"north"} (add "way":"ladder", or "way":"ramp" with "size":[1,3] rising north or south, [3,1] east or west, and "look":"stone"|"wood"|"earth")',
  outline: (_map, { at }, v) => (v.way === 'ramp' ? rampOutline(at, v) : [{ x: at[0], y: at[1], w: Number(v.width) || 1, h: Number(v.height) || 1 }]),
  make(use, v) {
    const climbs = String(v.climbs) as Heading;
    const from = Number(v.from);
    if (v.way === 'ramp') return { kind: 'stairs', at: use.at, size: rampSize(Number(v.length), climbs), from, climbs, way: 'ramp', look: String(v.look || 'stone') };
    return { kind: 'stairs', at: use.at, size: [Number(v.width), Number(v.height)], from, climbs, ...(v.way === 'ladder' ? { way: 'ladder' as const } : {}) };
  },
  check(map, edit) {
    if (!FROM.includes(edit.from)) return `Stairs go up from a floor between ${MAX_FLOORS.down} below the ground and ${MAX_FLOORS.up - 1} above it.`;
    if (edit.climbs !== undefined && !HEADINGS.includes(edit.climbs)) return 'Stairs climb north, south, east or west.';
    if (edit.way !== undefined && !WAYS.some((w) => w.id === edit.way)) return 'Lay stairs, a ladder or a ramp.';
    const [w, h] = Array.isArray(edit.size) ? edit.size : [NaN, NaN];
    if (![w, h].every((n) => Number.isInteger(n) && n >= 1 && n <= 6)) return 'A flight is 1 to 6 tiles a side.';
    if (!inside(map, edit.at) || !inside(map, [edit.at[0] + w - 1, edit.at[1] + h - 1])) return OFF_EDGE;
    if (stairsWay(edit) === 'ramp') {
      if (edit.look !== undefined && !RAMP_LOOKS.some((l) => l.id === edit.look)) return 'A ramp is stone, wood or earth.';
      const [across] = rampSize(Math.max(w, h), edit.climbs ?? 'north');
      if (Math.min(w, h) !== 1 || across !== w) return 'A ramp is 1 tile wide, and long the way it climbs.';
      return rampProblem(map, rampPlan(edit));
    }
    // Tried on a copy: it needs open floor at both ends.
    const { def, ...rest } = map;
    return lay({ ...structuredClone(rest), def }, edit) ? undefined : 'There is no open floor to step on below or off above. Lay the floors first, or move the stairs.';
  },
  apply: lay,
  keep: (d) => {
    const way = stairsWay(d);
    return { kind: 'stairs', at: d.at, size: d.size, from: d.from, ...(d.climbs ? { climbs: d.climbs } : {}), ...(way !== 'stairs' ? { way } : {}), ...(way === 'ramp' && d.look ? { look: d.look } : {}) };
  },
  words: (e) => {
    const where = `up from ${e.from === 0 ? 'the ground' : e.from > 0 ? `floor ${e.from}` : `${-e.from} down`}, at ${e.at.join(', ')}`;
    const way = stairsWay(e);
    if (way === 'ramp') return `A ramp, ${Math.max(...e.size)} long, rising ${e.climbs ?? 'north'}, ${where}`;
    return `${way === 'ladder' ? 'A ladder' : 'Stairs'} ${where}`;
  },
};
