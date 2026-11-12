import { hashString, rand2 } from '../../random.ts';
import { isBlocking } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside, tileOf } from '../tiles.ts';
import { MAX_SPAWN, type TilePoint } from '../types.ts';

/** Monsters of a kind that live around a spot and come back there after they fall. */
export const SPAWN: EditKind<'spawn'> = {
  kind: 'spawn',
  name: 'Monsters',
  hint: 'Click open ground where the monsters should live. They come back there after they fall.',
  pointer: 'click',
  fields: [
    { key: 'creature', label: 'Monster', type: 'choice', choices: (ctx) => Object.entries(ctx.creatures).map(([id, c]) => ({ id, name: c.name })) },
    { key: 'count', label: 'How many', type: 'number', min: 1, max: MAX_SPAWN, default: 4 },
  ],
  shape: '{"kind":"spawn","creature":"<creatureId>","at":[x,y],"count":2}',
  check(map, edit, ctx) {
    if (typeof edit.creature !== 'string' || !ctx.creatures[edit.creature]) return 'There is no monster of that kind.';
    if (!Number.isInteger(edit.count) || edit.count < 1 || edit.count > MAX_SPAWN) return `A spawn holds 1 to ${MAX_SPAWN} monsters.`;
    if (!inside(map, edit.at)) return OFF_EDGE;
    return isBlocking(tileOf(map, edit.at)) ? 'Monsters cannot live there: pick open ground.' : undefined;
  },
  // Spots for its monsters, around its middle on open ground, the same wherever it is laid out.
  apply(map, edit) {
    const seed = hashString(edit.id);
    const taken: TilePoint[] = [];
    for (let i = 0; taken.length < edit.count && i < edit.count * 40; i++) {
      // The first stands right on the spot; the rest spread out to three tiles around it.
      const r = i === 0 ? 0 : 1 + rand2(i, 1, seed) * 2;
      const a = rand2(i, 2, seed) * Math.PI * 2;
      const x = Math.floor(edit.at[0] + 0.5 + Math.cos(a) * r);
      const y = Math.floor(edit.at[1] + 0.5 + Math.sin(a) * r);
      if (x < 0 || y < 0 || x >= map.width || y >= map.height || isBlocking(tileOf(map, [x, y]))) continue;
      if (taken.some(([tx, ty]) => tx === x && ty === y)) continue;
      taken.push([x, y]);
    }
    for (const [x, y] of taken) map.creatures.push({ kind: edit.creature, name: edit.name ?? edit.creature, asset: edit.asset ?? edit.creature, x: x + 0.5, y: y + 0.5 });
  },
  keep(d, ctx) {
    const def = ctx.creatures[d.creature]!;
    return { kind: 'spawn', creature: d.creature, at: d.at, count: d.count, name: def.name, asset: def.art };
  },
  words: (e, ctx) => `${e.count} ${e.name ?? ctx?.creatures[e.creature]?.name ?? e.creature} at ${e.at.join(', ')}`,
};
