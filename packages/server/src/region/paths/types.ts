import { POISONED_HEALING, STATUSES, attackPower, knowsPassive, maxHp, pathNumbers, statusOf, type StatusId } from '@co-mmo/shared';
import { healThreat } from '../../threat.ts';
import type { Cast, Effect, EffectKit } from '../effects/index.ts';
import type { Creature, PlayerState } from '../state.ts';

/**
 * What a Path skill does beyond its effect's data (build plan step 7b): a
 * check that takes the effect's place, or a run that wraps it. The same
 * shape as the core skills' rules, so the two can sit in one table.
 */
export interface PathRule {
  /** Checked before Energy is spent, instead of the effect's own check. */
  ready?(kit: EffectKit, cast: Cast, effect: Effect): string | undefined;
  /** Does the skill; `effect` is its kit effect, to run as part of it. */
  run?(kit: EffectKit, cast: Cast, effect: Effect): void;
  /**
   * Used again while what it made is still out (the spirit hawk): ends it at
   * no cost and whatever the rest, returning what to tell the player; undefined to cast as usual.
   */
  again?(kit: EffectKit, p: PlayerState, id: string): string | undefined;
}

/** The player's plain weapon hit (Sunfall Dance, Dune Tempest and the hawk take a share of it). */
export function weaponHit(p: PlayerState): number {
  return attackPower(p.character);
}

/** Where a skill cast "at a spot" lands: the chosen creature in range, else the nearest, else the caster. */
export function spotFor(kit: EffectKit, cast: Cast): { x: number; y: number } {
  const c = (cast.targetId ? kit.creatureInReach(cast.p, cast.a.range, cast.targetId) : undefined) ?? kit.creatureInReach(cast.p, cast.a.range);
  return c ? { x: c.x, y: c.y } : { x: cast.p.x, y: cast.p.y };
}

/** A creature's share of its health left. */
export function healthShare(c: Creature): number {
  return c.def.hp > 0 ? c.hp / c.def.hp : 1;
}

/**
 * Heals a player for a Path skill: Poison weakens it, creatures fighting
 * them take threat from the healer, and what goes beyond full health may
 * become a shield (Overtone, through `overheal`). Returns what was healed.
 */
export function healPlayer(kit: EffectKit, by: PlayerState, m: PlayerState, amount: number): number {
  const ch = m.character;
  if (ch.hp <= 0) return 0;
  const wanted = Math.round(amount * (statusOf(m, 'poisoned', kit.s.now()) ? POISONED_HEALING : 1));
  const healed = Math.max(0, Math.min(maxHp(ch) - ch.hp, wanted));
  ch.hp += healed;
  m.dirty = true;
  if (healed) healThreat(kit.s.creatures, m.info.id, by.info.id, healed);
  kit.paths.overheal(by, m, wanted - healed);
  return healed;
}

/** The slows Loose Ends lengthens. */
const SLOWS: readonly StatusId[] = ['slowed', 'rooted'];

/** How much longer a player's slows last on creatures (Loose Ends: half again). */
export function slowLength(p: PlayerState, status: StatusId, seconds: number | undefined): number | undefined {
  if (!SLOWS.includes(status) || !knowsPassive(p.character, 'loose-ends')) return seconds;
  return (seconds ?? STATUSES[status].seconds) * (1 + (pathNumbers('loose-ends').longer ?? 0));
}
