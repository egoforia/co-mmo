import { isBlocking } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, floorOf, inside, tileOn } from '../tiles.ts';
import type { TilePoint } from '../types.ts';
import { spawnAt } from './monster-ways.ts';

/** Most corners a patrol path may have, and how far apart a drawn path's corners are kept, in tiles. */
export const PATROL = { corners: 16, apart: 3 };

/** A drawn line of tiles as a path's corners: every few tiles, and its end. */
export function corners(tiles: TilePoint[]): TilePoint[] {
  const out: TilePoint[] = [];
  for (const t of tiles) {
    const last = out.at(-1);
    if (!last || Math.hypot(t[0] - last[0], t[1] - last[1]) >= PATROL.apart) out.push(t);
  }
  const end = tiles.at(-1);
  if (end && out.at(-1) !== end) out.push(end);
  return out.slice(0, PATROL.corners);
}

/** A patrol path for one spawn's monsters, drawn from one of their homes; they walk it round and round. */
export const PATROL_PATH: EditKind<'patrol'> = {
  kind: 'patrol',
  name: 'Patrol path',
  hint: 'Press on a monster’s home and drag along the way it should walk, then let go. Its whole spawn walks the path round and round, and attacks anyone it meets.',
  pointer: 'drag',
  onFloors: true,
  // From the inspector the drag starts at the picked home, wherever it is pressed.
  inspects: { picks: ['monster'], title: 'Patrol path', action: 'Draw its path' },
  fields: [],
  shape: '{"kind":"patrol","at":[x,y],"route":[[x,y],[x,y]]}',
  // Where the drag started is the home; the rest of the line is the path.
  make: (use) => ({ kind: 'patrol', at: use.at, route: corners((use.tiles ?? []).slice(1)) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    const floor = floorOf(edit);
    if (!spawnAt(map, edit.at, floor).length) return 'Start the path on a monster’s home: where one stands before it wanders.';
    if (!Array.isArray(edit.route) || edit.route.length < 2 || edit.route.length > PATROL.corners) return `Drag a path of at least ${PATROL.apart * 2} tiles from the home.`;
    if (!edit.route.every((p) => inside(map, p))) return OFF_EDGE;
    return edit.route.some((p) => isBlocking(tileOn(map, p, floor))) ? 'The path crosses something no monster can walk through.' : undefined;
  },
  apply(map, edit) {
    const spawn = spawnAt(map, edit.at, floorOf(edit));
    for (const c of spawn) {
      c.behavior = 'patrol';
      c.route = edit.route.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
    }
    return spawn.length > 0;
  },
  keep: (d) => ({ kind: 'patrol', at: d.at, route: d.route.map(([x, y]) => [x, y] as TilePoint) }),
  words: (e) => `A patrol path of ${e.route.length} corners for the monsters at ${e.at.join(', ')}`,
};
