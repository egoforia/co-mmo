import { MAX_FLOORS, buildFloors } from '../../floors.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, buildingAt, buildingFor, inside } from '../tiles.ts';

/** Floors above and below a building, joined by stairs or ladders. */
export const FLOORS: EditKind<'floors'> = {
  kind: 'floors',
  name: 'Floors',
  hint: 'Click a building to give it floors above and below the ground, joined by stairs or ladders. 0 and 0 takes them off.',
  pointer: 'click',
  targets: 'building',
  inspects: {
    picks: ['building'],
    title: 'Floors above and below',
    action: 'Set the floors',
    current: (map, p) => {
      // The floors it has now: the storeys standing over its box.
      const over = map.storeys.filter((s) => s.x < p.box.x + p.box.w && s.x + s.width > p.box.x && s.y < p.box.y + p.box.h && s.y + s.height > p.box.y).map((s) => s.floor);
      const ladders = map.stairways.some((s) => s.kind === 'ladder' && s.x >= p.box.x && s.y >= p.box.y && s.x < p.box.x + p.box.w && s.y < p.box.y + p.box.h);
      return { up: Math.max(0, ...over), down: Math.max(0, ...over.map((f) => -f)), ladders };
    },
  },
  fields: [
    { key: 'up', label: 'Floors up', type: 'number', min: 0, max: MAX_FLOORS.up, default: 1 },
    { key: 'down', label: 'Floors down', type: 'number', min: 0, max: MAX_FLOORS.down, default: 0 },
    { key: 'ladders', label: 'Ladders (monsters cannot climb them)', type: 'flag', default: false },
  ],
  shape: '{"kind":"floors","at":[x,y],"up":1,"down":0,"ladders":false}',
  outline(map, { at }) {
    const b = buildingAt(map, at);
    return [b ? { x: b.x, y: b.y, w: b.width, h: b.height } : { x: at[0], y: at[1], w: 1, h: 1, tone: 'warn' }];
  },
  make: (use, v) => ({ kind: 'floors', at: use.at, up: Number(v.up), down: Number(v.down), ...(v.ladders ? { ladders: true } : {}), ...(use.target ? { target: use.target } : {}) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    const b = buildingFor(map, edit);
    if (!b) return edit.target ? 'That building is not there any more.' : 'Click a building to give it floors.';
    const counts = [edit.up, edit.down];
    if (!counts.every((n) => Number.isInteger(n) && n >= 0) || edit.up > MAX_FLOORS.up || edit.down > MAX_FLOORS.down) {
      return `A building has up to ${MAX_FLOORS.up} floors above the ground and ${MAX_FLOORS.down} below.`;
    }
    // Tried on a copy: the stairs need room on every floor they join.
    const copy = { ...map, storeys: [...map.storeys], stairways: [...map.stairways] };
    return buildFloors(copy, b, edit.up, edit.down, edit.ladders ? 'ladder' : 'stairs') ? undefined : 'There is no room for the stairs in this building. Move some furniture, or try a bigger one.';
  },
  apply(map, edit) {
    const b = buildingFor(map, edit);
    return !!b && buildFloors(map, b, edit.up, edit.down, edit.ladders ? 'ladder' : 'stairs');
  },
  keep: (d) => ({ kind: 'floors', at: d.at, up: d.up, down: d.down, ...(d.ladders ? { ladders: true } : {}) }),
  words: (e) => (e.up || e.down ? `${e.up} floor${e.up === 1 ? '' : 's'} up and ${e.down} down by ${e.ladders ? 'ladders' : 'stairs'}, at ${e.at.join(', ')}` : `Took the floors off the building at ${e.at.join(', ')}`),
};
