import { setPiece, setPieces } from '../../sea-cave-kit.ts';
import { block, type Landmark } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside, open, pieceTiles, tileOf } from '../tiles.ts';

/** Stands a kit set piece (only while its kit's wish is on). */
export const PIECE: EditKind<'piece'> = {
  kind: 'piece',
  name: 'Set piece',
  hint: 'Click open ground or a floor to stand a sea cave piece there. It shows once its picture is painted in the Art tab.',
  pointer: 'click',
  fields: [{ key: 'piece', label: 'Piece', type: 'choice', choices: () => setPieces().map((p) => ({ id: p.id, name: p.name })) }],
  shape: '{"kind":"piece","piece":"<pieceId>","at":[x,y]}',
  check(map, edit) {
    const piece = typeof edit.piece === 'string' ? setPiece(edit.piece) : undefined;
    if (!piece) return 'There is no set piece of that kind.';
    if (!inside(map, edit.at)) return OFF_EDGE;
    const tiles = pieceTiles(edit.at, piece.footprint);
    if (!tiles.every((t) => inside(map, t))) return 'It would stand off the edge of this land.';
    return tiles.every((t) => open(tileOf(map, t))) ? undefined : 'Something already stands there. Pick open ground or a floor.';
  },
  // Unless its kit is switched off or something took its spot since.
  apply(map, { piece: id, at }) {
    const piece = setPiece(id);
    if (!piece) return;
    const tiles = pieceTiles(at, piece.footprint);
    if (!tiles.every(([x, y]) => x >= 0 && y >= 0 && x < map.width && y < map.height && open(tileOf(map, [x, y])))) return;
    // Bottom centre of its footprint, as block() and the scene read a landmark.
    const landmark: Landmark = { asset: piece.id, x: at[0] + piece.footprint.width / 2, y: at[1] + 1, footprint: { ...piece.footprint } };
    map.landmarks.push(landmark);
    block(map, landmark.x, landmark.y, piece.footprint.width, piece.footprint.height);
  },
  keep: (d) => ({ kind: 'piece', piece: d.piece, at: d.at }),
  words: (e) => `${setPiece(e.piece)?.name ?? 'A set piece'} at ${e.at.join(', ')}`,
};
