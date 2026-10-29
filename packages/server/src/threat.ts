import { statusOf, type Status } from '@co-mmo/shared';

// Who a creature fights (docs/attributes.md, Threat and targeting): each one
// keeps a list of who has threatened it, 1 per point of damage and 0.5 per
// point of healing done to someone it is fighting, split between the
// creatures that are. It fights whoever has the most, switching only when
// someone has 10% more than its target, and a taunt forces its target.

/** Threat from each point of healing, shared between the creatures fighting the one healed. */
export const HEAL_THREAT = 0.5;
/** Another must have this many times the target's threat to take its attention. */
export const SWITCH_AT = 1.1;

/** What a threat list needs from a creature. */
export interface Threatened {
  aggro: string | null;
  respawnAt: number | null;
  /** Threat by player id. */
  threat: Record<string, number>;
  statuses: Status[];
}

/** Adds threat from a player (at least putting them on the list). */
export function addThreat(c: Threatened, playerId: string, amount: number): void {
  c.threat[playerId] = (c.threat[playerId] ?? 0) + Math.max(0, amount);
}

/**
 * Healing draws threat: every live creature with the healed player on its
 * list takes an equal share of half the healing as threat from the healer.
 * Returns the creatures that did, so they can be told to fight.
 */
export function healThreat<C extends Threatened>(creatures: C[], healedId: string, healerId: string, healed: number): C[] {
  const fighting = creatures.filter((c) => c.respawnAt === null && c.aggro !== null && c.threat[healedId] !== undefined);
  for (const c of fighting) addThreat(c, healerId, (healed * HEAL_THREAT) / fighting.length);
  return fighting;
}

/**
 * Who it should fight now, of those `standing` (Fallen players and those who
 * left are passed over): whoever taunted it while the taunt lasts, else its
 * target until another has 10% more threat, else whoever has the most.
 * Null when nobody on its list is left standing.
 */
export function chooseTarget(c: Threatened, standing: (id: string) => boolean, now: number): string | null {
  const taunter = statusOf(c, 'taunted', now)?.by;
  if (taunter && standing(taunter)) return taunter;
  let best: string | null = null;
  let top = -1;
  for (const [id, t] of Object.entries(c.threat)) {
    if (t > top && standing(id)) {
      best = id;
      top = t;
    }
  }
  const current = c.aggro && standing(c.aggro) ? c.aggro : null;
  if (!current) return best;
  return best && top > (c.threat[current] ?? 0) * SWITCH_AT ? best : current;
}
