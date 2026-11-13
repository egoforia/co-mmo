import { BUILDING_STYLES, buildingArt } from '../../buildings.ts';
import { WALL_HEIGHTS, WALL_SIDES, standWall, takeDownWall, wallOn, type WallHeight, type WallSide } from '../../edge-walls.ts';
import { storeyAt } from '../../world.ts';
import type { EditKind, FieldValue, Outline } from '../kind.ts';
import { OFF_EDGE, floorOf, inside } from '../tiles.ts';
import { MAX_STROKE, type TilePoint } from '../types.ts';

// The Wall tool: an upright wall on one side of each tile dragged over,
// painted in a building look's wall texture (edge-walls.ts). The tiles stay
// open; only the line between them is closed. R turns the side.

/** Each side in the editor's words, with where it lies on the isometric screen. */
const SIDE_NAMES: Record<WallSide, string> = {
  north: 'North (upper right)',
  east: 'East (lower right)',
  south: 'South (lower left)',
  west: 'West (upper left)',
};

/** How the tool lays its tiles: where it is dragged, or a straight line. */
const SHAPES = { free: 'Where I drag', line: 'Line' };

/** The look a wall starts in: Mossgate Castle's grey stone. */
const FIRST_LOOK = 'woods-castle';

/** How thick a wall's outline is drawn, in tiles. */
const MARK = 0.2;

/** The outline of one side of a tile: a thin box along it. */
export function sideOutline([x, y]: TilePoint, side: WallSide, tone?: Outline['tone']): Outline {
  const box = side === 'north' ? { x, y, w: 1, h: MARK }
    : side === 'south' ? { x, y: y + 1 - MARK, w: 1, h: MARK }
      : side === 'west' ? { x, y, w: MARK, h: 1 }
        : { x: x + 1 - MARK, y, w: MARK, h: 1 };
  return tone ? { ...box, tone } : box;
}

const sideOf = (v: Record<string, FieldValue>): WallSide => (WALL_SIDES.includes(v.side as WallSide) ? (v.side as WallSide) : 'north');

/** Walls on one side of tiles, or those walls taken down. */
export const WALL: EditKind<'wall'> = {
  kind: 'wall',
  name: 'Wall',
  hint: 'Drag along tiles to stand a wall on one side of each. R turns the side (Shift R turns it back). The tiles stay open; only the line between them is closed.',
  pointer: 'drag',
  onFloors: true,
  fields: [
    { key: 'side', label: 'Side', type: 'choice', turns: true, choices: () => WALL_SIDES.map((id) => ({ id, name: SIDE_NAMES[id] })) },
    { key: 'style', label: 'Look', type: 'choice', choices: () => Object.values(BUILDING_STYLES).map((s) => ({ id: s.id, name: s.name, art: buildingArt(s.id, 'wall') })), default: () => FIRST_LOOK },
    { key: 'height', label: 'Height', type: 'choice', choices: () => (Object.keys(WALL_HEIGHTS) as WallHeight[]).map((id) => ({ id, name: WALL_HEIGHTS[id] })) },
    { key: 'shape', label: 'Shape', type: 'choice', choices: () => Object.entries(SHAPES).map(([id, name]) => ({ id, name })) },
    { key: 'down', label: 'Take walls down instead', type: 'flag', default: false },
  ],
  shape: '{"kind":"wall","side":"north"|"east"|"south"|"west","tiles":[[x,y],...],"style":"<styleId>","height":"full"|"half"}',
  outline: (_map, { at }, v) => [sideOutline(at, sideOf(v), v.down ? 'warn' : undefined)],
  mark: (at, v) => sideOutline(at, sideOf(v), v.down ? 'warn' : 'held'),
  make: (use, v) => ({
    kind: 'wall',
    side: sideOf(v),
    tiles: use.tiles ?? [use.at],
    style: String(v.style),
    height: (Object.hasOwn(WALL_HEIGHTS, String(v.height)) ? v.height : 'full') as WallHeight,
    ...(v.down ? { down: true } : {}),
  }),
  check(map, edit) {
    if (!WALL_SIDES.includes(edit.side)) return 'Pick a side of the tile for the wall.';
    if (!BUILDING_STYLES[edit.style]) return 'There is no look of that name.';
    if (!Object.hasOwn(WALL_HEIGHTS, edit.height)) return 'Pick how tall the wall stands.';
    if (!Array.isArray(edit.tiles) || !edit.tiles.length) return 'Drag over at least one tile.';
    if (edit.tiles.length > MAX_STROKE) return `Wall at most ${MAX_STROKE} tiles at a time.`;
    if (!edit.tiles.every((t) => inside(map, t))) return OFF_EDGE;
    const floor = floorOf(edit);
    if (floor && !edit.tiles.every(([x, y]) => storeyAt(map, x, y, floor))) return 'A wall off the ground stands on a storey: keep it on the floor shown.';
    if (edit.down && !edit.tiles.some(([x, y]) => wallOn(map, x, y, edit.side, floor))) return 'There is no wall on that side here to take down.';
    return undefined;
  },
  apply(map, edit) {
    const floor = floorOf(edit);
    for (const [x, y] of edit.tiles) {
      if (edit.down) takeDownWall(map, x, y, edit.side, floor);
      else standWall(map, { id: edit.id, floor, style: edit.style, height: edit.height }, x, y, edit.side);
    }
    return true;
  },
  keep: (d) => ({ kind: 'wall', side: d.side, tiles: d.tiles.map(([x, y]) => [x, y]), style: d.style, height: d.height, ...(d.down ? { down: true } : {}) }),
  words: (e) => `${e.down ? 'Walls taken down from' : 'A wall on'} the ${e.side} side of ${e.tiles.length} tile${e.tiles.length === 1 ? '' : 's'}`,
};
