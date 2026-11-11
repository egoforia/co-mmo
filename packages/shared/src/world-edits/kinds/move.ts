import { Tile, block, set } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, built, clearUnder, footprint, inside, landmarkAt, movable, tileOf } from '../tiles.ts';

/** Picks up a tree, rock, water or set piece and puts it down elsewhere, or takes it away. */
export const MOVE: EditKind<'move'> = {
  kind: 'move',
  name: 'Move',
  hint: 'Click a tree, rock, water or set piece to pick it up, then click where it goes.',
  pointer: 'pick-then-click',
  fields: [],
  shape: '{"kind":"move","from":[x1,y1],"to":[x2,y2]|null}',
  check(map, edit) {
    if (!inside(map, edit.from) || (edit.to !== null && !inside(map, edit.to))) return OFF_EDGE;
    const piece = landmarkAt(map, edit.from);
    if (!piece && !movable(tileOf(map, edit.from))) return 'There is nothing there to move: pick a tree, a rock, water or a set piece.';
    // Furniture may move about a floor; trees and rocks stay out of buildings.
    const into = edit.to && tileOf(map, edit.to);
    if (into !== null && (into === Tile.Wall || into === Tile.Door || (!piece && built(into)))) return 'That would land inside a building. Pick another spot.';
    return undefined;
  },
  apply(map, { from, to }) {
    const piece = landmarkAt(map, from);
    if (piece) {
      clearUnder(map, footprint(piece));
      if (!to) {
        map.landmarks.splice(map.landmarks.indexOf(piece), 1);
        return;
      }
      piece.x += to[0] - from[0];
      piece.y += to[1] - from[1];
      block(map, piece.x, piece.y, piece.footprint.width, piece.footprint.height);
      return;
    }
    const tile = tileOf(map, from);
    if (!movable(tile)) return;
    set(map, from[0], from[1], Tile.Ground);
    if (to && !built(tileOf(map, to))) set(map, to[0], to[1], tile);
  },
  keep: (d) => ({ kind: 'move', from: d.from, to: d.to }),
  words: (e) => (e.to ? `Moved from ${e.from.join(', ')} to ${e.to.join(', ')}` : `Took away what stood at ${e.from.join(', ')}`),
};
