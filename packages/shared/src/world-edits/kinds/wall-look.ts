import { BUILDING_STYLES, buildingArt } from '../../buildings.ts';
import { WALL_HEIGHTS, WALL_SIDES, wallOn, type EdgeWall, type WallHeight, type WallSide } from '../../edge-walls.ts';
import type { RegionMap } from '../../world.ts';
import { isKitHouse, setWallLook, wallTileOwner } from '../../wall-looks.ts';
import type { EditKind, FieldValue } from '../kind.ts';
import { floorOf } from '../tiles.ts';
import type { DraftOf } from '../types.ts';
import { sideOutline } from './wall.ts';

// One Wall-tool wall picked with Select gets another look or height, or the
// whole run it was stood with does. Or one wall tile of a walled building or
// storey gets a look of its own (wall-looks.ts); kit houses refuse, since
// their walls change together. The wall is named by its tile, side and
// floor, so the change finds it again after other edits, goes through drafts
// and Publish, and undoes like any edit.

/** Whether the change is for the wall picked or every wall stood with it. */
const WHICH = { one: 'This wall only', run: 'The whole run it was stood with' };

const sideOf = (v: Record<string, FieldValue>): WallSide => (WALL_SIDES.includes(v.side as WallSide) ? (v.side as WallSide) : 'north');
/** The hidden side setting's value for a whole wall tile of a building or storey. */
const TILE = 'tile';
const isTile = (v: Record<string, FieldValue>) => v.side === TILE;

/** Why a wall tile's look cannot change, or undefined when it can. */
function tileProblem(map: RegionMap, edit: DraftOf<'wall-look'>): string | undefined {
  const owner = wallTileOwner(map, edit.at[0], edit.at[1], floorOf(edit));
  if (!owner) return 'That tile is not a wall of a building or storey.';
  if (isKitHouse(map, owner)) return 'This is a kit house: its walls change together. Change its look in Look and size.';
  return undefined;
}

/** The walls an edit changes: the one on its side of its tile, and with `run` every wall stood in the same go. */
function wallsFor(map: RegionMap, edit: DraftOf<'wall-look'>): EdgeWall[] {
  if (edit.side === undefined) return [];
  const wall = wallOn(map, edit.at[0], edit.at[1], edit.side, floorOf(edit));
  if (!wall) return [];
  return edit.run ? (map.edgeWalls ?? []).filter((w) => w.id === wall.id && w.floor === wall.floor) : [wall];
}

/** Another look or height for one Wall-tool wall, or its whole run. */
export const WALL_LOOK: EditKind<'wall-look'> = {
  kind: 'wall-look',
  name: 'Change wall',
  hint: 'Select a wall (point near its side of the tile) to change its look or height, or those of the whole run it was stood with.',
  pointer: 'click',
  onFloors: true,
  inspects: {
    picks: ['wall'],
    title: 'Look and height',
    action: 'Change it',
    current: (_map, p): Record<string, FieldValue> | undefined => {
      if (!p.wall) return undefined;
      return 'side' in p.wall ? { side: p.wall.side, style: p.wall.style, height: p.wall.height, which: 'one' } : { side: TILE, style: p.wall.style };
    },
  },
  fields: [
    // Comes from the wall picked; the inspector never shows it.
    { key: 'side', label: 'Side', type: 'choice', when: () => false, choices: () => [...WALL_SIDES, TILE].map((id) => ({ id, name: id })) },
    { key: 'style', label: 'Look', type: 'choice', choices: () => Object.values(BUILDING_STYLES).map((s) => ({ id: s.id, name: s.name, art: buildingArt(s.id, 'wall') })) },
    { key: 'height', label: 'Height', type: 'choice', when: (v) => !isTile(v), choices: () => (Object.keys(WALL_HEIGHTS) as WallHeight[]).map((id) => ({ id, name: WALL_HEIGHTS[id] })) },
    { key: 'which', label: 'Change', type: 'choice', when: (v) => !isTile(v), choices: () => Object.entries(WHICH).map(([id, name]) => ({ id, name })) },
  ],
  shape: '{"kind":"wall-look","at":[x,y],"side":"north"|"east"|"south"|"west"(left out: the building or storey wall tile at x,y),"style":"<styleId>","height":"full"|"half"|"low","run":false}',
  outline: (_map, { at }, v) => [isTile(v) ? { x: at[0], y: at[1], w: 1, h: 1 } : sideOutline(at, sideOf(v))],
  make: (use, v) => isTile(v) ? { kind: 'wall-look', at: use.at, style: String(v.style) } : ({
    kind: 'wall-look',
    at: use.at,
    side: sideOf(v),
    style: String(v.style),
    height: (Object.hasOwn(WALL_HEIGHTS, String(v.height)) ? v.height : 'full') as WallHeight,
    ...(v.which === 'run' ? { run: true } : {}),
  }),
  check(map, edit) {
    if (!Array.isArray(edit.at) || !edit.at.every(Number.isInteger)) return 'Pick a wall to change.';
    if (!BUILDING_STYLES[edit.style]) return 'There is no look of that name.';
    if (edit.side === undefined) return tileProblem(map, edit);
    if (!WALL_SIDES.includes(edit.side)) return 'Pick a side of the tile for the wall.';
    if (!Object.hasOwn(WALL_HEIGHTS, edit.height)) return 'Pick how tall the wall stands.';
    if (!wallsFor(map, edit).length) return 'There is no wall on that side here. Select one near its side of the tile.';
    return undefined;
  },
  apply(map, edit) {
    if (edit.side === undefined) {
      if (tileProblem(map, edit) || !BUILDING_STYLES[edit.style]) return false;
      setWallLook(wallTileOwner(map, edit.at[0], edit.at[1], floorOf(edit))!, edit.at[0], edit.at[1], edit.style);
      return true;
    }
    const walls = wallsFor(map, edit);
    for (const w of walls) {
      w.style = edit.style;
      w.height = edit.height;
    }
    return walls.length > 0;
  },
  keep: (d) => d.side === undefined
    ? { kind: 'wall-look', at: [d.at[0], d.at[1]], style: d.style }
    : { kind: 'wall-look', at: [d.at[0], d.at[1]], side: d.side, style: d.style, height: d.height, ...(d.run ? { run: true } : {}) },
  words: (e) => e.side === undefined ? `The wall tile at ${e.at.join(', ')} made ${BUILDING_STYLES[e.style]?.name ?? e.style}` : `${e.run ? 'A run of walls' : 'A wall'} on the ${e.side} side of ${e.at.join(', ')} made ${BUILDING_STYLES[e.style]?.name ?? e.style}, ${WALL_HEIGHTS[e.height]?.toLowerCase() ?? e.height}`,
};
