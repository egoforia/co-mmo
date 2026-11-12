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
  check: (map, edit) => (inside(map, edit.from) && inside(map, edit.to) ? undefined : OFF_EDGE),
  apply: (map, edit) => (road(map, edit.from[0], edit.from[1], edit.to[0], edit.to[1]), true),
  keep: (d) => ({ kind: 'road', from: d.from, to: d.to }),
  words: (e) => `Road from ${e.from.join(', ')} to ${e.to.join(', ')}`,
};
