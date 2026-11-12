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

/** How a brush lays its tiles: where it is dragged, a filled rectangle or a line from where it is pressed to where it is let go, or a fill of the patch clicked. */
export type BrushShape = 'free' | 'rect' | 'line' | 'fill';

const SHAPES: Record<BrushShape, string> = { free: 'Where I drag', rect: 'Rectangle', line: 'Line', fill: 'Fill the patch clicked' };

/**
 * The tiles a brush shape covers between where it was pressed and where it
 * was let go (`size` wide, for a line): at most MAX_STROKE, nearest first.
 * A fill takes the tiles like the one pressed that join it, side by side.
 */
export function brushTiles(map: RegionMap, shape: BrushShape, from: TilePoint, to: TilePoint, size = 1): TilePoint[] {
  const out = new Map<string, TilePoint>();
  const add = (x: number, y: number) => {
    if (out.size < MAX_STROKE && inside(map, [x, y])) out.set(`${x},${y}`, [x, y]);
  };
  if (shape === 'rect') {
    const [x0, x1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
    const [y0, y1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) add(x, y);
  } else if (shape === 'line') {
    const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), 1);
    const half = Math.floor(size / 2);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(from[0] + ((to[0] - from[0]) * i) / steps);
      const y = Math.round(from[1] + ((to[1] - from[1]) * i) / steps);
      for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) add(x + dx, y + dy);
    }
  } else if (shape === 'fill') {
    if (!inside(map, from)) return [];
    const like = tileOf(map, from);
    const queue: TilePoint[] = [from];
    add(...from);
    while (queue.length && out.size < MAX_STROKE) {
      const [x, y] = queue.shift()!;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as TilePoint[]) {
        if (!inside(map, [nx, ny]) || out.has(`${nx},${ny}`) || tileOf(map, [nx, ny]) !== like) continue;
        add(nx, ny);
        queue.push([nx, ny]);
      }
    }
  } else add(...from);
  return [...out.values()];
}

/** Lays ground, paths, water, trees, rocks or walls on tiles. */
export const PAINT: EditKind<'paint'> = {
  kind: 'paint',
  name: 'Paint',
  hint: 'Click or drag to lay ground, paths, water, trees, rocks or walls; or drag out a rectangle or a line, or fill the patch clicked. A path over water becomes a bridge.',
  pointer: 'drag',
  fields: [
    { key: 'tile', label: 'Lay', type: 'choice', choices: () => PAINT_TILES.map((id) => ({ id, name: PAINT_NAMES[id] })), default: () => 'tree' },
    { key: 'brush', label: 'Brush', type: 'choice', choices: () => [1, 3, 5].map((n) => ({ id: String(n), name: `${n} × ${n}` })) },
    { key: 'shape', label: 'Shape', type: 'choice', choices: () => (Object.keys(SHAPES) as BrushShape[]).map((id) => ({ id, name: SHAPES[id] })) },
  ],
  shape: '{"kind":"paint","tile":"ground"|"path"|"water"|"tree"|"rock"|"wall","tiles":[[x,y],...]}',
  outline: (_map, { at }, v) => {
    const n = Number(v.brush) || 1;
    const half = Math.floor(n / 2);
    return [{ x: at[0] - half, y: at[1] - half, w: n, h: n }];
  },
  make: (use, v) => ({ kind: 'paint', tile: String(v.tile) as PaintTile, tiles: use.tiles ?? [use.at] }),
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
