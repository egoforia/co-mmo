import { rand2, valueNoise } from '../../random.ts';
import { Tile, set } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside, tileOf } from '../tiles.ts';
import { MAX_CLEAR_RADIUS } from '../types.ts';

// The land's own scenery, scattered over a round patch the way the layouts
// lay it (world.ts scatter): trees in clumps, rocks here and there, drawn in
// the land's biome kit. Thickness 0 clears a patch of trees and rocks back
// to open ground. Only open ground and scenery change; paths, water and
// anything built stay as they are.

/** How thick each setting is, as a share of the open ground it may cover. */
const THICK = [0, 0.15, 0.35, 0.6];
const THICK_NAMES = ['None (clear them away)', 'Sparse', 'Some', 'Thick'];

/** Trees and rocks over a round patch, as thick as chosen. */
export const SCENERY: EditKind<'scenery'> = {
  kind: 'scenery',
  name: 'Scenery',
  hint: 'Choose how thick the trees and rocks grow and how wide a patch, then click its middle. They are drawn in the land’s own look; “None” clears a patch.',
  pointer: 'click',
  fields: [
    { key: 'trees', label: 'Trees', type: 'choice', choices: () => THICK_NAMES.map((name, i) => ({ id: String(i), name })), default: () => '2' },
    { key: 'rocks', label: 'Rocks', type: 'choice', choices: () => THICK_NAMES.map((name, i) => ({ id: String(i), name })), default: () => '1' },
    { key: 'radius', label: 'Tiles around', type: 'number', min: 1, max: MAX_CLEAR_RADIUS, default: 6 },
  ],
  shape: '{"kind":"scenery","at":[x,y],"radius":6,"trees":2,"rocks":1}',
  outline(_map, { at }, v) {
    const r = Number(v.radius) || 1;
    return [{ x: at[0] - r, y: at[1] - r, w: r * 2 + 1, h: r * 2 + 1 }];
  },
  make: (use, v) => ({ kind: 'scenery', at: use.at, radius: Number(v.radius), trees: Number(v.trees), rocks: Number(v.rocks) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    if (!Number.isInteger(edit.radius) || edit.radius < 1 || edit.radius > MAX_CLEAR_RADIUS) return `Cover 1 to ${MAX_CLEAR_RADIUS} tiles around.`;
    const thick = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < THICK.length;
    if (!thick(edit.trees) || !thick(edit.rocks)) return 'Pick how thick the trees and rocks grow.';
    // Never over where players arrive.
    const s = map.spawn;
    return (edit.trees || edit.rocks) && Math.hypot(s.x - edit.at[0] - 0.5, s.y - edit.at[1] - 0.5) <= edit.radius + 1.5 ? 'Keep scenery off where players arrive.' : undefined;
  },
  apply(map, edit) {
    const r = edit.radius;
    const seed = map.seed + edit.at[0] * 31 + edit.at[1] * 17;
    for (let y = edit.at[1] - r; y <= edit.at[1] + r; y++) {
      for (let x = edit.at[0] - r; x <= edit.at[0] + r; x++) {
        if (!inside(map, [x, y]) || (x - edit.at[0]) ** 2 + (y - edit.at[1]) ** 2 > r * r) continue;
        const t = tileOf(map, [x, y]);
        if (t !== Tile.Ground && t !== Tile.Tree && t !== Tile.Rock) continue;
        // Trees in clumps (noise), rocks scattered (chance), the same each time the land is laid.
        const tree = valueNoise(x, y, seed, 4) < THICK[edit.trees]! * 1.2 && rand2(x, y, seed + 1) < 0.8;
        const rock = !tree && rand2(x, y, seed + 2) < THICK[edit.rocks]! * 0.25;
        set(map, x, y, tree ? Tile.Tree : rock ? Tile.Rock : Tile.Ground);
      }
    }
    return true;
  },
  keep: (d) => ({ kind: 'scenery', at: d.at, radius: d.radius, trees: d.trees, rocks: d.rocks }),
  words: (e) => (e.trees || e.rocks ? `Trees and rocks within ${e.radius} of ${e.at.join(', ')}` : `Cleared trees and rocks within ${e.radius} of ${e.at.join(', ')}`),
};
