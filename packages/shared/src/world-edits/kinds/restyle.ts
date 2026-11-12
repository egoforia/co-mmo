import { BUILDING_STYLES } from '../../buildings.ts';
import { building } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { buildingFor, inside, overlaps } from '../tiles.ts';
import { HOUSE_FLOOR } from '../types.ts';
import { takeBuilding } from './remove.ts';

// A building changed where it stands: another look, or another size from the
// same north-west corner. A new size lays the building again, so what was
// inside it (its floors above and below, stairs and furniture) goes, as when
// it is taken away.

/** Gives the building clicked another look, and another size when one is chosen. */
export const RESTYLE: EditKind<'restyle'> = {
  kind: 'restyle',
  name: 'Change building',
  hint: 'Choose a look, and a floor size if it should change (0 keeps it), then click a building. A new size lays it again from the same corner, empty inside.',
  pointer: 'click',
  targets: 'building',
  fields: [
    { key: 'style', label: 'Look', type: 'choice', choices: () => Object.values(BUILDING_STYLES).map((s) => ({ id: s.id, name: `${s.name}${s.kit ? ' (kit house)' : ''}` })) },
    { key: 'width', label: 'Floor across (0 keeps it)', type: 'number', min: 0, max: HOUSE_FLOOR.max, default: 0 },
    { key: 'depth', label: 'Floor deep (0 keeps it)', type: 'number', min: 0, max: HOUSE_FLOOR.max, default: 0 },
  ],
  shape: '{"kind":"restyle","at":[x,y],"target":"<building name>","style":"<styleId>","floor":[8,6]}',
  outline(map, { at }) {
    const b = map.buildings.find((t) => at[0] >= t.x && at[1] >= t.y && at[0] < t.x + t.width && at[1] < t.y + t.height);
    return b ? [{ x: b.x, y: b.y, w: b.width, h: b.height }] : [{ x: at[0], y: at[1], w: 1, h: 1 }];
  },
  make: (use, v) => ({
    kind: 'restyle',
    at: use.at,
    ...(use.target ? { target: use.target } : {}),
    style: String(v.style),
    ...(Number(v.width) && Number(v.depth) ? { floor: [Number(v.width), Number(v.depth)] as [number, number] } : {}),
  }),
  check(map, edit) {
    if (!inside(map, edit.at)) return 'That spot is off the edge of this land.';
    const b = buildingFor(map, edit);
    if (!b) return 'Click a building to change it.';
    if (!BUILDING_STYLES[edit.style]) return 'There is no building of that look.';
    if (!edit.floor) return undefined;
    const [w, h] = edit.floor;
    if (![w, h].every((n) => Number.isInteger(n) && n >= HOUSE_FLOOR.min && n <= HOUSE_FLOOR.max)) return `A building's floor is ${HOUSE_FLOOR.min} to ${HOUSE_FLOOR.max} tiles a side.`;
    if (!inside(map, [b.x + w + 2, b.y + h + 2])) return 'It would reach off the edge of this land.';
    const rect = { x: b.x - 1, y: b.y - 1, width: w + 4, height: h + 4 };
    return map.buildings.some((o) => o !== b && overlaps(rect, o)) ? 'It would reach another building. Leave a tile of room around it.' : undefined;
  },
  apply(map, edit) {
    const b = buildingFor(map, edit);
    if (!b || !BUILDING_STYLES[edit.style]) return false;
    const [w, h] = edit.floor ?? [b.width - 2, b.height - 2];
    if (w === b.width - 2 && h === b.height - 2) {
      b.style = edit.style;
      // A kit design only fits a look the kit builds.
      if (b.kit && !BUILDING_STYLES[edit.style]!.kit) delete b.kit;
      return true;
    }
    const rect = { x: b.x - 1, y: b.y - 1, width: w + 4, height: h + 4 };
    if (map.buildings.some((o) => o !== b && overlaps(rect, o))) return false;
    takeBuilding(map, b);
    const again = building(map, b.x, b.y, w, h, edit.style);
    // Keep its name, so later edits that point at it still find it.
    if (b.id) again.id = b.id;
    map.buildings.push(again);
    return true;
  },
  keep: (d) => ({ kind: 'restyle', at: d.at, style: d.style, ...(d.floor ? { floor: [d.floor[0], d.floor[1]] as [number, number] } : {}) }),
  words: (e) => `Changed the building at ${e.at.join(', ')} to ${BUILDING_STYLES[e.style]?.name ?? e.style}${e.floor ? `, ${e.floor[0]} × ${e.floor[1]}` : ''}`,
};
