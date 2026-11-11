import { BUILDING_STYLES } from '../../buildings.ts';
import { building } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { footprint, inside, overlaps } from '../tiles.ts';
import { HOUSE_FLOOR, KIT_HOUSE_FLOORS } from '../types.ts';

/** A walled house of any building style. */
export const HOUSE: EditKind<'house'> = {
  kind: 'house',
  name: 'House',
  hint: 'Click the doorstep: the house stands just north of it, its doorway on that spot.',
  pointer: 'click',
  fields: [
    { key: 'style', label: 'Look', type: 'choice', choices: () => Object.values(BUILDING_STYLES).map((s) => ({ id: s.id, name: s.name })) },
    { key: 'size', label: 'Size', type: 'choice', choices: () => KIT_HOUSE_FLOORS.map((f, i) => ({ id: String(i), name: `${f.name} (${f.floor[0]} × ${f.floor[1]})` })) },
  ],
  shape: '{"kind":"house","at":[x,y],"floor":[6,6],"style":"<styleId>"}',
  check(map, edit) {
    const style = BUILDING_STYLES[edit.style];
    if (!style) return 'There is no house of that look.';
    const [w, h] = Array.isArray(edit.floor) ? edit.floor : [NaN, NaN];
    if (![w, h].every((n) => Number.isInteger(n) && n >= HOUSE_FLOOR.min && n <= HOUSE_FLOOR.max)) return `A house's floor is ${HOUSE_FLOOR.min} to ${HOUSE_FLOOR.max} tiles a side.`;
    if (!inside(map, edit.at) || !inside(map, [edit.at[0] + w + 2, edit.at[1] + h + 2])) return 'The house would stand off the edge of this land.';
    const rect = { x: edit.at[0] - 1, y: edit.at[1] - 1, width: w + 4, height: h + 4 };
    if (map.buildings.some((b) => overlaps(rect, b))) return 'Another building stands there. Leave a tile of room around it.';
    return undefined;
  },
  apply(map, { at, floor, style }) {
    if (!BUILDING_STYLES[style]) return;
    const rect = { x: at[0] - 1, y: at[1] - 1, width: floor[0] + 4, height: floor[1] + 4 };
    if (map.buildings.some((b) => overlaps(rect, b))) return;
    // Set pieces under the new walls and the clearing around them make way.
    map.landmarks = map.landmarks.filter((l) => {
      const f = footprint(l);
      return !overlaps(rect, { x: f.left, y: f.top, width: f.width, height: f.height });
    });
    map.buildings.push(building(map, at[0], at[1], floor[0], floor[1], style));
  },
  keep: (d) => ({ kind: 'house', at: d.at, floor: d.floor, style: d.style }),
  words: (e) => `${BUILDING_STYLES[e.style]?.name ?? 'A house'}, ${e.floor[0]} × ${e.floor[1]}`,
};
