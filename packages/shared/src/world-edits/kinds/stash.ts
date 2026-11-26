import { blockOn } from '../../floors.ts';
import { STASH_CHEST } from '../../rpg/stash.ts';
import { isSafe } from '../../safe-areas.ts';
import type { Landmark } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, floorOf, inside, open, pieceTiles, tileOn } from '../tiles.ts';

// A stash chest (docs/stash.md): where any character opens their account's
// shared stash. Only in a safe area, so carrying things out in the wild still
// matters (egoforia, 2026-11-26). It stands as a landmark the scene draws once
// its picture (stash-chest) is painted in the Art tab.

/** How many tiles a stash chest stands on, across and deep. */
const CHEST = { width: 2, height: 1 };

/** Stands a stash chest with its footprint's bottom-left tile at `at`. */
export const STASH: EditKind<'stash'> = {
  kind: 'stash',
  name: 'Stash chest',
  hint: 'Click open ground in a safe area to stand a stash chest there. Every character opens their account\'s shared stash at it. It shows once its picture is painted in the Art tab.',
  pointer: 'click',
  onFloors: true,
  fields: [],
  shape: '{"kind":"stash","at":[x,y]}',
  outline: (_map, { at }) => [{ x: at[0], y: at[1], w: CHEST.width, h: CHEST.height }],
  make: (use) => ({ kind: 'stash', at: use.at }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    const tiles = pieceTiles(edit.at, CHEST);
    if (!tiles.every((t) => inside(map, t))) return 'It would stand off the edge of this land.';
    if (!isSafe(map, edit.at[0] + 1, edit.at[1] + 0.5)) return 'Stand stash chests in a safe area, where nobody can be robbed at one.';
    return tiles.every((t) => open(tileOn(map, t, floorOf(edit)))) ? undefined : 'Something already stands there. Pick open ground or a floor.';
  },
  apply(map, edit) {
    const floor = floorOf(edit);
    const tiles = pieceTiles(edit.at, CHEST);
    if (!tiles.every(([x, y]) => x >= 0 && y >= 0 && x < map.width && y < map.height && open(tileOn(map, [x, y], floor)))) return false;
    // Bottom centre of its footprint, as block() and the scene read a landmark.
    const landmark: Landmark = { asset: STASH_CHEST, x: edit.at[0] + CHEST.width / 2, y: edit.at[1] + 1, footprint: { ...CHEST }, ...(floor ? { floor } : {}) };
    map.landmarks.push(landmark);
    blockOn(map, floor, landmark.x, landmark.y, CHEST.width, CHEST.height, STASH_CHEST);
    return true;
  },
  keep: (d) => ({ kind: 'stash', at: d.at }),
  words: (e) => `A stash chest at ${e.at.join(', ')}`,
};
