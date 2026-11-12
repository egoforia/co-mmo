import { road } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside } from '../tiles.ts';

/** A two-tile road between two tiles, bridging water. */
export const ROAD: EditKind<'road'> = {
  kind: 'road',
  name: 'Road',
  hint: 'Click where the road starts, then where it ends. It runs across, then down.',
  pointer: 'two-clicks',
  fields: [],
  shape: '{"kind":"road","from":[x1,y1],"to":[x2,y2]}',
  outline(_map, { at, from }) {
    if (!from) return [{ x: at[0], y: at[1], w: 2, h: 2 }];
    // As road() lays it: across on the start's row, then down the end's column, two tiles wide.
    const [x0, y0] = from;
    return [
      { x: Math.min(x0, at[0]), y: y0, w: Math.abs(at[0] - x0) + 1, h: 2, tone: 'held' },
      { x: at[0], y: Math.min(y0, at[1]), w: 2, h: Math.abs(at[1] - y0) + 2, tone: 'held' },
    ];
  },
  make: (use) => ({ kind: 'road', from: use.from ?? use.at, to: use.at }),
  check: (map, edit) => (inside(map, edit.from) && inside(map, edit.to) ? undefined : OFF_EDGE),
  apply: (map, edit) => (road(map, edit.from[0], edit.from[1], edit.to[0], edit.to[1]), true),
  keep: (d) => ({ kind: 'road', from: d.from, to: d.to }),
  words: (e) => `Road from ${e.from.join(', ')} to ${e.to.join(', ')}`,
};
