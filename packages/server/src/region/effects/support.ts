import { POISONED_HEALING, STATUSES, cleanse as clear, maxHp, statusOf } from '@co-mmo/shared';
import { healThreat } from '../../threat.ts';
import { afflictPlayer } from '../statuses.ts';
import type { PlayerState } from '../state.ts';
import { allyFor, type Effect, type EffectKit } from './types.ts';

/**
 * Mends the chosen ally in range, else the most hurt one, else you (only you
 * when it has no range); Poison makes it weaker. Creatures fighting the one
 * healed take threat from the healer. A Bellkeeper's heal leaves an Echo on
 * the one healed, and their finisher heal is a Toll that rings every Echo in
 * range instead.
 */
export const heal: Effect = {
  ready: (kit, cast) => {
    if (cast.a.finisher) return kit.gauges.echoesNear(cast.p, cast.a.range).length ? undefined : 'No Echoes are close enough to ring.';
    const m = allyFor(kit, cast);
    if (m.character.hp < maxHp(m.character)) return undefined;
    return m === cast.p ? 'You are already at full health.' : `${m.info.name} is already at full health.`;
  },
  run: (kit, cast) => {
    const { p, a, amount } = cast;
    if (a.finisher) return void kit.gauges.toll(p, a);
    const m = allyFor(kit, cast);
    const healed = mend(kit, p, m, amount);
    if (m === p) return kit.s.notice(p, `${a.name} restores ${healed} health.`);
    kit.s.notice(p, `${a.name} restores ${healed} health to ${m.info.name}.`);
    kit.s.notice(m, `${p.info.name}'s ${a.name} restores ${healed} of your health.`);
  },
};

/**
 * Heals one player for `healer` (less while Poisoned, never past full): the
 * creatures fighting them take threat from the healer, and a Bellkeeper's
 * heal leaves an Echo. Returns the health restored.
 */
export function mend(kit: EffectKit, healer: PlayerState, m: PlayerState, amount: number): number {
  const ch = m.character;
  const poisoned = statusOf(m, 'poisoned', kit.s.now()) ? POISONED_HEALING : 1;
  const healed = Math.max(0, Math.min(maxHp(ch) - ch.hp, Math.round(amount * poisoned)));
  ch.hp += healed;
  m.dirty = true;
  healThreat(kit.s.creatures, m.info.id, healer.info.id, healed);
  kit.gauges.healed(healer, m, healed);
  return healed;
}

/** A shield on you that takes the ability's amount of damage before your health does. */
export const shield: Effect = {
  run: (kit, { p, a, amount }) => {
    const size = Math.round(amount);
    afflictPlayer(kit.s, p, 'shielded', a.duration, { amount: size });
    kit.s.notice(p, `${a.name} shields you from ${size} damage.`);
  },
};

/**
 * The ability's status on you and your party close by (a Shield's size is the
 * ability's amount); one with no radius goes to one ally, chosen as heals are.
 */
export const buff: Effect = {
  ready: (_kit, { a }) => (a.status ? undefined : 'That has nothing to give.'),
  run: (kit, cast) => {
    const { p, a, amount } = cast;
    const status = a.status!;
    // A Shield's size and a Riposte's answering blow are the ability's amount.
    const size = status === 'shielded' || status === 'poised' ? { amount: Math.round(amount) } : {};
    const party = a.radius ? kit.partyNear(p, a.radius) : [allyFor(kit, cast)];
    for (const m of party) {
      afflictPlayer(kit.s, m, status, a.duration, { by: p.info.id, ...size });
      if (m !== p) kit.s.notice(m, `${p.info.name}'s ${a.name} leaves you ${STATUSES[status].name}.`);
    }
    const one = party[0] !== p ? `${party[0]!.info.name} is` : 'you are';
    kit.s.notice(p, `${a.name}: ${party.length > 1 ? `you and ${party.length - 1} near you are` : one} ${STATUSES[status].name}.`);
  },
};

/** Clears every harmful status from you and your party close by. */
export const cleanse: Effect = {
  run: (kit, { p, a }) => {
    let cleared = 0;
    for (const m of kit.partyNear(p, a.radius ?? 0)) {
      const n = clear(m);
      cleared += n;
      if (n && m !== p) kit.s.notice(m, `${p.info.name}'s ${a.name} washes your ailments away.`);
    }
    kit.s.notice(p, cleared ? `${a.name} washes ${cleared === 1 ? 'an ailment' : `${cleared} ailments`} away.` : `${a.name}: nothing to wash away.`);
  },
};
