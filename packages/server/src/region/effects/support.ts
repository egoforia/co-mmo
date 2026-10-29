import { POISONED_HEALING, STATUSES, cleanse as clear, maxHp, statusOf } from '@co-mmo/shared';
import { afflictPlayer } from '../statuses.ts';
import type { Effect } from './types.ts';

/**
 * Mends you; Poison makes it weaker. A Bellkeeper's heal leaves an Echo, and
 * their finisher heal is a Toll that rings every Echo in range instead.
 */
export const heal: Effect = {
  ready: (kit, { p, a }) => {
    if (a.finisher) return kit.gauges.echoesNear(p, a.range).length ? undefined : 'No Echoes are close enough to ring.';
    return p.character.hp >= maxHp(p.character) ? 'You are already at full health.' : undefined;
  },
  run: (kit, { p, a, amount, now }) => {
    if (a.finisher) return void kit.gauges.toll(p, a);
    const ch = p.character;
    const poisoned = statusOf(p, 'poisoned', now) ? POISONED_HEALING : 1;
    const healed = Math.min(maxHp(ch) - ch.hp, Math.round(amount * poisoned));
    ch.hp += healed;
    kit.gauges.healed(p, p, healed);
    kit.s.notice(p, `${a.name} restores ${healed} health.`);
  },
};

/** A shield on you that takes the ability's amount of damage before your health does. */
export const shield: Effect = {
  run: (kit, { p, a, amount }) => {
    const size = Math.round(amount);
    afflictPlayer(kit.s, p, 'shielded', a.duration, { amount: size });
    kit.s.notice(p, `${a.name} shields you from ${size} damage.`);
  },
};

/** The ability's status on you and your party close by (a Shield's size is the ability's amount). */
export const buff: Effect = {
  ready: (_kit, { a }) => (a.status ? undefined : 'That has nothing to give.'),
  run: (kit, { p, a, amount }) => {
    const status = a.status!;
    const size = status === 'shielded' ? { amount: Math.round(amount) } : {};
    const party = kit.partyNear(p, a.radius ?? 0);
    for (const m of party) {
      afflictPlayer(kit.s, m, status, a.duration, { by: p.info.id, ...size });
      if (m !== p) kit.s.notice(m, `${p.info.name}'s ${a.name} leaves you ${STATUSES[status].name}.`);
    }
    kit.s.notice(p, `${a.name}: ${party.length > 1 ? `you and ${party.length - 1} near you are` : 'you are'} ${STATUSES[status].name}.`);
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
