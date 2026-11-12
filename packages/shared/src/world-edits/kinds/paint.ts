import { Tile, set, type RegionMap } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, built, inside, tileOf } from '../tiles.ts';
import { MAX_STROKE, PAINT_NAMES, PAINT_TILES, type PaintTile, type TilePoint } from '../types.ts';

/** The tile a brush kind lays. */
function paintTile(kind: PaintTile): Tile {
  return { ground: Tile.Ground, path: Tile.Path, water: Tile.Water, tree: Tile.Tree, rock: Tile.Rock, wall: Tile.Wall }[kind];
}

function paint(map: RegionMap, kind: PaintTile, tiles: TilePoint[]): void {
  const tile = paintTile(kind);
  for (const [x, y] of tiles) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    const here = tileOf(map, [x, y]);
    if (here === Tile.Door) continue;
    // When painting wall, lay a wall; when painting ground, clear walls or blocked tiles.
    // Other brush kinds leave existing buildings/blocked tiles alone.
    if (kind !== 'wall' && !(kind === 'ground' && (here === Tile.Wall || here === Tile.Blocked)) && built(here)) continue;
    set(map, x, y, tile === Tile.Path && (here === Tile.Water || here === Tile.Bridge) ? Tile.Bridge : tile);
  }
}

/** Lays ground, paths, water, trees, rocks or walls on tiles. */
export const PAINT: EditKind<'paint'> = {
  kind: 'paint',
  name: 'Paint',
  hint: 'Click or drag to lay ground, paths, water, trees, rocks or walls. A path over water becomes a bridge.',
  pointer: 'drag',
  fields: [
    { key: 'tile', label: 'Lay', type: 'choice', choices: () => PAINT_TILES.map((id) => ({ id, name: PAINT_NAMES[id] })) },
    { key: 'brush', label: 'Brush', type: 'number', min: 1, max: 5, default: 1 },
  ],
  shape: '{"kind":"paint","tile":"ground"|"path"|"water"|"tree"|"rock"|"wall","tiles":[[x,y],...]}',
  check(map, edit) {
    if (!PAINT_TILES.includes(edit.tile)) return 'The brush cannot lay that.';
    if (!Array.isArray(edit.tiles) || !edit.tiles.length) return 'Paint at least one tile.';
    if (edit.tiles.length > MAX_STROKE) return `Paint at most ${MAX_STROKE} tiles at a time.`;
    return edit.tiles.every((t) => inside(map, t)) ? undefined : OFF_EDGE;
  },
  apply(map, edit) {
    paint(map, edit.tile, edit.tiles);
    // A spot painted over is gone.
    map.spots = map.spots.filter((p) => tileOf(map, [p.x, p.y]) === Tile.Blocked);
    return true;
  },
  keep: (d) => ({ kind: 'paint', tile: d.tile, tiles: d.tiles.map(([x, y]) => [x, y]) }),
  words: (e) => `${PAINT_NAMES[e.tile]} on ${e.tiles.length} tile${e.tiles.length === 1 ? '' : 's'}`,
};
