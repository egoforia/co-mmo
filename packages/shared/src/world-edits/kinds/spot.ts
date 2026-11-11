import { SPOTS } from '../../gathering.ts';
import { ITEMS } from '../../rpg.ts';
import { Tile, set } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside, tileOf } from '../tiles.ts';

/** Stands a gathering spot on open ground, or takes one away. */
export const SPOT: EditKind<'spot'> = {
  kind: 'spot',
  name: 'Gathering',
  hint: 'Click open ground to stand a gathering spot there, or choose Take away and click a spot.',
  pointer: 'click',
  fields: [{ key: 'spot', label: 'Spot', type: 'choice', choices: () => [{ id: '', name: 'Take away' }, ...Object.entries(SPOTS).map(([id, s]) => ({ id, name: `${s.name} (${ITEMS[s.material]?.name ?? s.material})` }))], default: () => Object.keys(SPOTS)[0] ?? '' }],
  shape: '{"kind":"spot","spot":"<spotId>"|null,"at":[x,y]}',
  make: (use, v) => ({ kind: 'spot', spot: v.spot ? String(v.spot) : null, at: use.at }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    const there = map.spots.some((p) => p.x === edit.at[0] && p.y === edit.at[1]);
    if (edit.spot === null) return there ? undefined : 'There is no gathering spot there.';
    if (typeof edit.spot !== 'string' || !SPOTS[edit.spot]) return 'There is no gathering spot of that kind.';
    if (there) return 'A gathering spot already stands there.';
    return tileOf(map, edit.at) === Tile.Ground || tileOf(map, edit.at) === Tile.Path ? undefined : 'Gathering spots stand on open ground. Pick another spot.';
  },
  apply(map, edit) {
    const [x, y] = edit.at;
    const here = (p: { x: number; y: number }) => p.x === x && p.y === y;
    if (edit.spot === null) {
      if (!map.spots.some(here)) return false;
      map.spots = map.spots.filter((p) => !here(p));
      set(map, x, y, Tile.Ground);
      return true;
    }
    const t = tileOf(map, edit.at);
    if (!SPOTS[edit.spot] || map.spots.some(here) || (t !== Tile.Ground && t !== Tile.Path)) return false;
    map.spots.push({ id: edit.id, kind: edit.spot, x, y });
    set(map, x, y, Tile.Blocked);
    return true;
  },
  keep: (d) => ({ kind: 'spot', spot: d.spot, at: d.at }),
  words: (e) => (e.spot ? `${SPOTS[e.spot]?.name ?? 'A gathering spot'} at ${e.at.join(', ')}` : `Took away the gathering spot at ${e.at.join(', ')}`),
};
