import { ECHO_ART, HALLOWED_ART, HAWK_SKILL, SAND_DOUBLE_ART, SPIRIT_HAWK_ART, TRAP_ART, type WorldMark } from '@co-mmo/shared';
import { round } from '../region-views.ts';
import type { RegionState } from './state.ts';

// What skills leave in the world, as players see it (build plan step 10):
// traps, Echoes on friends, hallowed ground, the spirit hawk and the sand
// double. Each is only seen; what it does stays in its effect's own code.

/** Where a spirit hawk flies beside its owner, in tiles: just behind and to the left. */
const HAWK_OFFSET = { x: -0.7, y: -0.5 };

/** Everything skills left in the region that is still there now. */
export function worldMarks(s: RegionState, now: number): WorldMark[] {
  const marks: WorldMark[] = [];
  const add = (id: string, asset: string, x: number, y: number, floor: number) => marks.push({ id, asset, x: round(x), y: round(y), ...(floor ? { floor } : {}) });
  s.traps.forEach((t, i) => now < t.until && add(`trap-${t.owner}-${i}`, TRAP_ART, t.x, t.y, t.floor));
  s.zones.forEach((z, i) => now < z.until && add(`hallowed-${z.owner}-${i}`, HALLOWED_ART, z.x, z.y, z.floor));
  for (const d of s.doubles) if (now < d.until) add(`double-${d.owner}`, SAND_DOUBLE_ART, d.x, d.y, d.floor);
  for (const h of s.helpers) {
    const owner = s.players.get(h.owner);
    if (owner && h.ability === HAWK_SKILL && now < h.until) add(`hawk-${h.owner}`, SPIRIT_HAWK_ART, owner.x + HAWK_OFFSET.x, owner.y + HAWK_OFFSET.y, owner.floor);
  }
  for (const p of s.players.values()) {
    for (const e of p.gauge?.echoes ?? []) {
      const friend = s.players.get(e.on);
      if (friend && now < e.until) add(`echo-${p.info.id}-${e.on}`, ECHO_ART, friend.x, friend.y, friend.floor);
    }
  }
  return marks;
}
