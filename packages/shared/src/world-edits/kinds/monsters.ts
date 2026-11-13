import type { EditKind } from '../kind.ts';
import { OFF_EDGE, floorOf, inside } from '../tiles.ts';
import { WAYS_FIELDS, keptWays, setWays, spawnAt, waysFrom, waysProblem } from './monster-ways.ts';

/** Changes one spawn's monsters, picked by one of their homes: their level, ways and hours. */
export const MONSTERS: EditKind<'monsters'> = {
  kind: 'monsters',
  name: 'Change monsters',
  hint: 'Choose a level, ways and hours, then click a monster’s home: every monster of its spawn changes. “Its own” puts back what its kind does.',
  pointer: 'click',
  onFloors: true,
  inspects: {
    picks: ['monster'],
    title: 'Level, ways and hours',
    action: 'Change their spawn',
    current: (map, p) => {
      const c = spawnAt(map, [p.box.x, p.box.y], p.level)[0];
      return c && { monsterLevel: c.level ?? 0, behavior: c.behavior ?? 'own', active: c.active ?? 'own', loot: c.loot?.[0]?.item ?? 'none', lootChance: c.loot?.[0] ? Math.round(c.loot[0].chance * 100) : 25 };
    },
  },
  fields: WAYS_FIELDS,
  shape: '{"kind":"monsters","at":[x,y],"monsterLevel":5,"behavior":"guard","active":"night"}',
  make: (use, v) => ({ kind: 'monsters', at: use.at, ...waysFrom(v) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    if (!spawnAt(map, edit.at, floorOf(edit)).length) return 'Click a monster’s home: where one stands before it wanders.';
    return waysProblem(edit);
  },
  apply(map, edit) {
    const spawn = spawnAt(map, edit.at, floorOf(edit));
    for (const c of spawn) setWays(c, edit);
    return spawn.length > 0;
  },
  keep: (d) => ({ kind: 'monsters', at: d.at, ...keptWays(d, true) }),
  words: (e) => `Changed the monsters living at ${e.at.join(', ')}${e.monsterLevel ? ` to level ${e.monsterLevel}` : ''}`,
};
