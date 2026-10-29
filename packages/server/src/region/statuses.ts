import {
  STATUSES,
  absorb,
  afflict,
  afterArmor,
  expireStatuses,
  statusLength,
  totalStats,
  ward,
  type StatusId,
} from '@co-mmo/shared';
import type { Creature, PlayerState, RegionState } from './state.ts';

/** Who gave a status and how strong it is (damage each second, or a shield's size). */
export interface StatusFrom {
  by?: string;
  amount?: number;
}

/**
 * Puts a status on a player for `seconds` (its usual length when missing).
 * Their Vigor shortens harmful ones; a stun while immune does nothing.
 * Returns false when it did not take.
 */
export function afflictPlayer(s: RegionState, p: PlayerState, id: StatusId, seconds: number | undefined, from: StatusFrom = {}): boolean {
  if (shrugs(p, id, s.now())) return false;
  const ms = statusLength(id, seconds ?? STATUSES[id].seconds, totalStats(p.character).vigor);
  return afflict(p, id, ms, s.now(), from);
}

/** Whether a Path keeps this status off the player: Rooted Stand stops Stuns and Roots, a Dune Tempest spin Slows and Roots. */
export function shrugs(p: PlayerState, id: StatusId, now: number): boolean {
  if (p.stance?.ability === 'rooted-stand' && (id === 'stunned' || id === 'rooted')) return true;
  return (p.steadfastUntil ?? 0) > now && (id === 'slowed' || id === 'rooted');
}

/** Puts a status on a creature for `seconds` (its usual length when missing); false when it did not take. */
export function afflictCreature(s: RegionState, c: Creature, id: StatusId, seconds: number | undefined, from: StatusFrom = {}): boolean {
  if (c.respawnAt !== null) return false;
  return afflict(c, id, statusLength(id, seconds ?? STATUSES[id].seconds), s.now(), from);
}

/**
 * Wears statuses off and deals their damage once a second: Burning is
 * arcane (Ward softens it), Bleeding and Poison go past armour. Damage to a
 * creature is dealt through `strikeFor` so its defeat pays whoever gave it;
 * if they have left the region, the wound stops hurting.
 */
export function tickStatuses(
  s: RegionState,
  now: number,
  strikeFor: (by: PlayerState, c: Creature, amount: number, id: StatusId) => void,
): void {
  for (const p of s.players.values()) {
    if (p.character.hp <= 0) p.statuses = p.statuses.filter((x) => !STATUSES[x.id].harmful);
    for (const x of p.statuses) {
      if (!x.amount || x.nextTick === undefined || now < x.nextTick || now > x.until) continue;
      x.nextTick += 1000;
      const raw = x.id === 'burning' ? afterArmor(x.amount, ward(p.character)) : x.amount;
      const amount = absorb(p, raw, now);
      if (amount <= 0) continue;
      p.character.hp = Math.max(0, p.character.hp - amount);
      p.lastHurt = now;
      s.broadcastNear(p, { t: 'hit', by: x.by ?? p.info.id, target: p.info.id, amount, defeated: p.character.hp === 0, damage: x.id === 'burning' ? 'arcane' : 'physical' });
    }
    expireStatuses(p, now);
  }
  for (const c of s.creatures) {
    if (c.respawnAt !== null) continue;
    for (const x of [...c.statuses]) {
      if (!x.amount || x.nextTick === undefined || now < x.nextTick || now > x.until) continue;
      x.nextTick += 1000;
      const by = x.by ? s.players.get(x.by) : undefined;
      if (by && c.respawnAt === null) strikeFor(by, c, x.amount, x.id);
    }
    expireStatuses(c, now);
  }
}
