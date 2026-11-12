import { blockOn } from '../../floors.ts';
import { Tile, set } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, built, clearUnder, floorOf, footprint, inside, landmarkFor, movable, tileOf, tileOn } from '../tiles.ts';

/** Picks up a tree, rock, water or set piece and puts it down elsewhere, or takes it away. Set pieces and furniture move on any floor. */
export const MOVE: EditKind<'move'> = {
  kind: 'move',
  name: 'Move',
  hint: 'Click a tree, rock, water or set piece to pick it up, then click where it goes.',
  pointer: 'pick-then-click',
  onFloors: true,
  targets: true,
  fields: [],
  shape: '{"kind":"move","from":[x1,y1],"to":[x2,y2]|null}',
  check(map, edit) {
    if (!inside(map, edit.from) || (edit.to !== null && !inside(map, edit.to))) return OFF_EDGE;
    const floor = floorOf(edit);
    const piece = landmarkFor(map, edit);
    if (edit.target && !piece) return 'That is not there any more.';
    if (!piece && (floor || !movable(tileOf(map, edit.from)))) return 'There is nothing there to move: pick a tree, a rock, water or a set piece.';
    // Furniture may move about a floor; trees and rocks stay out of buildings.
    const into = edit.to && tileOn(map, edit.to, floor);
    if (into !== null && (into === Tile.Wall || into === Tile.Door || (!piece && built(into)))) return 'That would land inside a building. Pick another spot.';
    return undefined;
  },
  apply(map, edit) {
    const { from, to } = edit;
    const floor = floorOf(edit);
    const piece = landmarkFor(map, edit);
    if (piece) {
      clearUnder(map, footprint(piece), floor);
      if (!to) {
        map.landmarks.splice(map.landmarks.indexOf(piece), 1);
        return true;
      }
      piece.x += to[0] - from[0];
      piece.y += to[1] - from[1];
      blockOn(map, floor, piece.x, piece.y, piece.footprint.width, piece.footprint.height);
      return true;
    }
    const tile = tileOf(map, from);
    if (floor || !movable(tile)) return false;
    set(map, from[0], from[1], Tile.Ground);
    if (to && !built(tileOf(map, to))) set(map, to[0], to[1], tile);
    return true;
  },
  keep: (d) => ({ kind: 'move', from: d.from, to: d.to }),
  words: (e) => (e.to ? `Moved from ${e.from.join(', ')} to ${e.to.join(', ')}` : `Took away what stood at ${e.from.join(', ')}`),
};
