import { setPiece, setPieces } from '../../sea-cave-kit.ts';
import { blockOn } from '../../floors.ts';
import type { Landmark } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, floorOf, inside, open, pieceTiles, tileOn } from '../tiles.ts';

/** Stands a kit set piece (only while its kit's wish is on). */
export const PIECE: EditKind<'piece'> = {
  kind: 'piece',
  name: 'Set piece',
  hint: 'Click open ground or a floor to stand a sea cave piece there. It shows once its picture is painted in the Art tab.',
  pointer: 'click',
  onFloors: true,
  available: () => setPieces().length > 0,
  fields: [{ key: 'piece', label: 'Piece', type: 'choice', choices: () => setPieces().map((p) => ({ id: p.id, name: p.name })) }],
  shape: '{"kind":"piece","piece":"<pieceId>","at":[x,y]}',
  outline(_map, { at }, v) {
    const f = setPiece(String(v.piece))?.footprint ?? { width: 1, height: 1 };
    return [{ x: at[0], y: at[1] - f.height + 1, w: f.width, h: f.height }];
  },
  make: (use, v) => ({ kind: 'piece', piece: String(v.piece), at: use.at }),
  check(map, edit) {
    const piece = typeof edit.piece === 'string' ? setPiece(edit.piece) : undefined;
    if (!piece) return 'There is no set piece of that kind.';
    if (!inside(map, edit.at)) return OFF_EDGE;
    const tiles = pieceTiles(edit.at, piece.footprint);
    if (!tiles.every((t) => inside(map, t))) return 'It would stand off the edge of this land.';
    return tiles.every((t) => open(tileOn(map, t, floorOf(edit)))) ? undefined : 'Something already stands there. Pick open ground or a floor.';
  },
  // Unless its kit is switched off or something took its spot since.
  apply(map, edit) {
    const { piece: id, at } = edit;
    const floor = floorOf(edit);
    const piece = setPiece(id);
    if (!piece) return false;
    const tiles = pieceTiles(at, piece.footprint);
    if (!tiles.every(([x, y]) => x >= 0 && y >= 0 && x < map.width && y < map.height && open(tileOn(map, [x, y], floor)))) return false;
    // Bottom centre of its footprint, as block() and the scene read a landmark.
    const landmark: Landmark = { asset: piece.id, x: at[0] + piece.footprint.width / 2, y: at[1] + 1, footprint: { ...piece.footprint }, ...(floor ? { floor } : {}) };
    map.landmarks.push(landmark);
    blockOn(map, floor, landmark.x, landmark.y, piece.footprint.width, piece.footprint.height);
    return true;
  },
  keep: (d) => ({ kind: 'piece', piece: d.piece, at: d.at }),
  words: (e) => `${setPiece(e.piece)?.name ?? 'A set piece'} at ${e.at.join(', ')}`,
};
