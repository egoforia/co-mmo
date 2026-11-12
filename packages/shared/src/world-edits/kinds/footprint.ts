import { block } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, clearUnder, footprint, inside, landmarkAt, open, tileOf } from '../tiles.ts';
import { MAX_FOOTPRINT } from '../types.ts';

/** The tiles a set piece or piece of furniture blocks, still centred under its picture. */
export const FOOTPRINT: EditKind<'footprint'> = {
  kind: 'footprint',
  name: 'Footprint',
  hint: 'Click a piece of furniture or a set piece to change how many tiles across and deep it blocks.',
  pointer: 'click',
  fields: [
    { key: 'width', label: 'Across', type: 'number', min: 1, max: MAX_FOOTPRINT, default: 1 },
    { key: 'height', label: 'Deep', type: 'number', min: 1, max: MAX_FOOTPRINT, default: 1 },
  ],
  shape: '{"kind":"footprint","at":[x,y],"footprint":[2,1]}',
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    const piece = landmarkAt(map, edit.at);
    if (!piece) return 'There is no set piece or furniture there.';
    const [w, h] = Array.isArray(edit.footprint) ? edit.footprint : [NaN, NaN];
    if (![w, h].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_FOOTPRINT)) return `A footprint is 1 to ${MAX_FOOTPRINT} tiles a side.`;
    const old = footprint(piece);
    const next = footprint({ ...piece, footprint: { width: w, height: h } });
    for (let y = next.top; y < next.top + h; y++) {
      for (let x = next.left; x < next.left + w; x++) {
        if (!inside(map, [x, y])) return 'It would reach off the edge of this land.';
        const mine = x >= old.left && x < old.left + old.width && y >= old.top && y < old.top + old.height;
        if (!mine && !open(tileOf(map, [x, y]))) return 'Something else stands there, or a wall. Make it smaller or move it first.';
      }
    }
    return undefined;
  },
  // Unless something took the tiles since.
  apply(map, { at, footprint: [width, height] }) {
    const piece = landmarkAt(map, at);
    if (!piece) return;
    const old = footprint(piece);
    const next = footprint({ ...piece, footprint: { width, height } });
    const mine = (x: number, y: number) => x >= old.left && x < old.left + old.width && y >= old.top && y < old.top + old.height;
    for (let y = next.top; y < next.top + height; y++) {
      for (let x = next.left; x < next.left + width; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height || (!mine(x, y) && !open(tileOf(map, [x, y])))) return;
      }
    }
    clearUnder(map, old);
    piece.footprint = { width, height };
    block(map, piece.x, piece.y, width, height);
  },
  keep: (d) => ({ kind: 'footprint', at: d.at, footprint: [d.footprint[0], d.footprint[1]] }),
  words: (e) => `Footprint of what stands at ${e.at.join(', ')} set to ${e.footprint[0]} × ${e.footprint[1]}`,
};
