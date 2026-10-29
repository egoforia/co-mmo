import { STATUSES } from '@co-mmo/shared';
import { provoke } from '../../creature-brain.ts';
import { afflictCreature } from '../statuses.ts';
import type { Creature } from '../state.ts';
import { addStatus, aimAt, type Cast, type Effect, type EffectKit } from './types.ts';

/** How long a taunt holds, and how far it carries when the skill gives no radius. */
const TAUNT_SECONDS = 4;

/** Puts the ability's status (Marked when it names none) on the chosen or nearest creature in range. */
export const debuff: Effect = {
  ready: (kit, cast) => (aimAt(kit, cast) ? undefined : `No creature within ${cast.a.range} steps.`),
  run: (kit, cast) => {
    const c = cast.target!;
    const status = cast.a.status ?? 'marked';
    const took = addStatus(kit, { ...cast, a: { ...cast.a, status } }, c);
    kit.s.notice(cast.p, took ? `${c.def.name} is ${STATUSES[status].name}.` : `${c.def.name} shrugs it off.`);
  },
};

/**
 * Taunts the creatures around you (or the chosen one in range, when the
 * skill has no radius): Taunted by you, they fight you whatever the threat
 * (threat.ts chooseTarget) until it wears off.
 */
export const taunt: Effect = {
  ready: (kit, cast) => (taunted(kit, cast).length ? undefined : 'Nothing near enough to taunt.'),
  run: (kit, cast) => {
    const list = taunted(kit, cast);
    for (const c of list) {
      if (!afflictCreature(kit.s, c, 'taunted', cast.a.duration ?? TAUNT_SECONDS, { by: cast.p.info.id })) continue;
      provoke(c, cast.p.info.id, { creatures: kit.s.creatures, now: cast.now });
      if (!c.fleeing) c.aggro = cast.p.info.id;
      if (cast.a.status && cast.a.status !== 'taunted') addStatus(kit, cast, c);
    }
    kit.s.notice(cast.p, list.length === 1 ? `${list[0]!.def.name} turns on you.` : `${list.length} creatures turn on you.`);
  },
};

function taunted(kit: EffectKit, cast: Cast): Creature[] {
  if (cast.a.radius) return kit.creaturesNear(cast.p, cast.p, cast.a.radius);
  const c = aimAt(kit, cast);
  return c ? [c] : [];
}
