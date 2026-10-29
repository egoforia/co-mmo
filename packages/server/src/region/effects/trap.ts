import { ABILITIES } from '@co-mmo/shared';
import type { Trap } from '../state.ts';
import { hitWith, type Effect, type EffectKit } from './types.ts';

/** How many of one trap a player may have set at once, how long one lasts, and how close it springs. */
const MAX_TRAPS = 2;
const TRAP_SECONDS = 30;
const TRAP_RADIUS = 0.8;

/** Sets a trap at your feet; the first creature to step on it is hurt and gets the ability's status. */
export const trap: Effect = {
  run: (kit, { p, id, a, amount, now }) => {
    const s = kit.s;
    const mine = s.traps.filter((t) => t.owner === p.info.id && t.ability === id);
    // The oldest goes when one too many is set.
    if (mine.length >= MAX_TRAPS) s.traps.splice(s.traps.indexOf(mine[0]!), 1);
    s.traps.push({ owner: p.info.id, ability: id, x: p.x, y: p.y, floor: p.floor, radius: a.radius ?? TRAP_RADIUS, amount, until: now + (a.duration ?? TRAP_SECONDS) * 1000 });
    s.notice(p, `You set a ${a.name}.`);
  },
};

/** Springs traps a creature has stepped on, and clears those that crumbled or whose setter left. */
export function springTraps(kit: EffectKit, now: number): void {
  const s = kit.s;
  if (!s.traps.length) return;
  s.traps = s.traps.filter((t) => now < t.until && s.players.has(t.owner) && !spring(kit, t, now));
}

/** True when the trap went off. */
function spring(kit: EffectKit, t: Trap, now: number): boolean {
  const p = kit.s.players.get(t.owner)!;
  const a = ABILITIES[t.ability];
  const c = kit.s.creatures.find((k) => k.respawnAt === null && k.floor === t.floor && Math.hypot(k.x - t.x, k.y - t.y) <= t.radius);
  if (!c || !a) return false;
  hitWith(kit, { p, id: t.ability, a, now, amount: t.amount }, c);
  kit.s.notice(p, `Your ${a.name} caught ${c.def.name}.`);
  return true;
}
