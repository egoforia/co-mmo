import { SPOTS } from '../../gathering.ts';
import { hashString, rand2 } from '../../random.ts';
import { ITEMS } from '../../rpg.ts';
import { Tile, set } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside, tileOf } from '../tiles.ts';
import { MAX_SPOTS, type TilePoint } from '../types.ts';

/** Stands a gathering spot on open ground, or takes one away. */
export const SPOT: EditKind<'spot'> = {
  kind: 'spot',
  name: 'Gathering',
  hint: 'Click open ground to stand gathering spots there (more than one scatter around it), or choose Take away and click a spot.',
  pointer: 'click',
  fields: [{ key: 'spot', label: 'Spot', type: 'choice', choices: () => [{ id: '', name: 'Take away' }, ...Object.entries(SPOTS).map(([id, s]) => ({ id, name: `${s.name} (${ITEMS[s.material]?.name ?? s.material})` }))], default: () => Object.keys(SPOTS)[0] ?? '' },
    { key: 'count', label: 'How many', type: 'number', min: 1, max: MAX_SPOTS, default: 1 },
  ],
  shape: '{"kind":"spot","spot":"<spotId>"|null,"at":[x,y],"count":3}',
  make: (use, v) => ({ kind: 'spot', spot: v.spot ? String(v.spot) : null, at: use.at, ...(v.spot && Number(v.count) > 1 ? { count: Number(v.count) } : {}) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    const there = map.spots.some((p) => p.x === edit.at[0] && p.y === edit.at[1]);
    if (edit.spot === null) return there ? undefined : 'There is no gathering spot there.';
    if (typeof edit.spot !== 'string' || !SPOTS[edit.spot]) return 'There is no gathering spot of that kind.';
    if (there) return 'A gathering spot already stands there.';
    if (edit.count !== undefined && (!Number.isInteger(edit.count) || edit.count < 1 || edit.count > MAX_SPOTS)) return `One click stands 1 to ${MAX_SPOTS} gathering spots.`;
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
    const open = (p: TilePoint) => inside(map, p) && !map.spots.some((s) => s.x === p[0] && s.y === p[1]) && [Tile.Ground, Tile.Path].includes(tileOf(map, p));
    if (!SPOTS[edit.spot] || !open(edit.at)) return false;
    // The first on the tile clicked; the rest scattered up to four tiles round it, the same wherever it is laid out.
    const seed = hashString(edit.id);
    const placed: TilePoint[] = [edit.at];
    for (let i = 1; placed.length < (edit.count ?? 1) && i < (edit.count ?? 1) * 40; i++) {
      const r = 1.5 + rand2(i, 1, seed) * 2.5;
      const a = rand2(i, 2, seed) * Math.PI * 2;
      const p: TilePoint = [Math.floor(x + 0.5 + Math.cos(a) * r), Math.floor(y + 0.5 + Math.sin(a) * r)];
      if (open(p) && !placed.some(([px, py]) => Math.abs(px - p[0]) <= 1 && Math.abs(py - p[1]) <= 1)) placed.push(p);
    }
    placed.forEach(([px, py], i) => {
      map.spots.push({ id: i ? `${edit.id}:${i}` : edit.id, kind: edit.spot!, x: px, y: py });
      set(map, px, py, Tile.Blocked);
    });
    return true;
  },
  keep: (d) => ({ kind: 'spot', spot: d.spot, at: d.at, ...(d.spot && d.count && d.count > 1 ? { count: d.count } : {}) }),
  words: (e) => (e.spot ? `${SPOTS[e.spot]?.name ?? 'A gathering spot'} at ${e.at.join(', ')}` : `Took away the gathering spot at ${e.at.join(', ')}`),
};
