import { DOT_SHARE, DAMAGE_STATUSES, abilityDamageType, maxHp, type AbilityDef, type DamageType } from '@co-mmo/shared';
import type { Gauges } from '../gauges.ts';
import type { Paths } from '../paths/index.ts';
import { slowLength } from '../paths/types.ts';
import type { Creature, PlayerState, RegionState } from '../state.ts';
import { afflictCreature } from '../statuses.ts';

// What every effect of the kit (rpg/abilities.ts) is given: the region, the
// cast, and the few combat moves effects share. Each effect lives in its
// own small file here; Combat.useAbility looks it up in EFFECTS (index.ts).

/** How a blow lands: its damage type, the ability it came from, and whether armour is ignored. */
export interface Blow {
  type: DamageType;
  ability?: string;
  ranged?: boolean;
  /** Goes past Armor and Ward (Bleeding, Poison). */
  pierce?: boolean;
  /** A critical hit (Blazing Edge sets these Burning). */
  crit?: boolean;
}

/** The combat moves effects use; Combat provides them. */
export interface EffectKit {
  readonly s: RegionState;
  /** The players' signature gauges: hits fill them, finishers and Toll spend them. */
  readonly gauges: Gauges;
  /** Path skills at work: their timed parts, passives and hooks (region/paths/). */
  readonly paths: Paths;
  /** Damages a creature for a player, paying the rewards on a defeat. */
  strike(p: PlayerState, c: Creature, raw: number, how: Blow): void;
  /** A hit made critical by chance. */
  critical(p: PlayerState, amount: number): number;
  /** Live creatures on the player's floor within `range` of a point, nearest first. */
  creaturesNear(p: PlayerState, at: { x: number; y: number }, range: number): Creature[];
  /** The nearest live creature within reach, or the one asked for if it is in reach. */
  creatureInReach(p: PlayerState, range: number, id?: string): Creature | undefined;
  /** Party members in the region within `radius` of the player and on their feet, the player first. */
  partyNear(p: PlayerState, radius: number): PlayerState[];
  /** Raises a Fallen player where they lie with `share` of their health (region/fallen.ts); false if they were not Fallen. */
  raise(p: PlayerState, share: number, by: PlayerState): boolean;
}

/** One use of an ability. */
export interface Cast {
  p: PlayerState;
  /** The ability's id and definition. */
  id: string;
  a: AbilityDef;
  now: number;
  /** The creature (or, for heals and buffs, the player) the player chose, if any. */
  targetId?: string;
  /** The creature an effect settled on before the cost was paid. */
  target?: Creature;
  /** Damage, healing or shield from the ability's numbers, after randomness (and the gauge's lift). */
  amount: number;
  /** A Wishweaver spell cast at three Weave: its amount is doubled, and skills may do more (build plan step 7). */
  woven?: boolean;
  /** The gauge pips a finisher spends. */
  spent?: number;
  /** Damage roll variance factor (0.9 to 1.1). */
  variance?: number;
}

/** An effect of the kit. */
export interface Effect {
  /** Checked before Energy is spent: why it cannot be used now, if it cannot. */
  ready?(kit: EffectKit, cast: Cast): string | undefined;
  /** Does it. */
  run(kit: EffectKit, cast: Cast): void;
}

/** Hits a creature with the cast's amount (× `share`), then adds the ability's status if it still stands. */
export function hitWith(kit: EffectKit, cast: Cast, c: Creature, share = 1): void {
  const { p, a, id } = cast;
  const plain = cast.amount * share;
  const amount = kit.critical(p, plain);
  kit.strike(p, c, amount, { type: abilityDamageType(a), ability: id, ...(amount > plain ? { crit: true } : {}) });
  // A finisher's own hits do not build the gauge it spends.
  if (!a.finisher) kit.gauges.landed(p);
  if (a.status && c.respawnAt === null) addStatus(kit, cast, c, amount);
}

/** Puts the ability's status on a creature; damage statuses hurt each second for a share of the hit. */
export function addStatus(kit: EffectKit, cast: Cast, c: Creature, hit = cast.amount): boolean {
  const status = cast.a.status;
  if (!status) return false;
  const amount = DAMAGE_STATUSES.includes(status) ? Math.max(1, Math.round(hit * (cast.a.dotShare ?? DOT_SHARE))) : undefined;
  return afflictCreature(kit.s, c, status, slowLength(cast.p, status, cast.a.duration), { by: cast.p.info.id, ...(amount ? { amount } : {}) });
}

/** The chosen creature in reach, else the nearest; sets it on the cast. */
export function aimAt(kit: EffectKit, cast: Cast, range = cast.a.range): Creature | undefined {
  const { p, targetId } = cast;
  cast.target = kit.creatureInReach(p, range, targetId) ?? (targetId ? kit.creatureInReach(p, range) : undefined);
  return cast.target;
}

/**
 * Who a heal or buff goes to: the chosen player when they stand within
 * `range` on the same floor, else the most hurt of the party in range, else
 * the player. A range of 0 means only the player.
 */
export function allyFor(kit: EffectKit, cast: Cast, range = cast.a.range): PlayerState {
  const { p, targetId } = cast;
  if (range <= 0) return p;
  const chosen = targetId ? kit.s.players.get(targetId) : undefined;
  if (chosen && chosen.character.hp > 0 && chosen.floor === p.floor && Math.hypot(chosen.x - p.x, chosen.y - p.y) <= range) return chosen;
  const hurt = (m: PlayerState) => m.character.hp / maxHp(m.character);
  // partyNear lists the player first, so they win a tie.
  return kit.partyNear(p, range).reduce((best, m) => (hurt(m) < hurt(best) ? m : best));
}

/** A unit step from the player toward a point, or the way they face when it is where they stand. */
export function towards(p: PlayerState, at?: { x: number; y: number }): { dx: number; dy: number } {
  const dx = at ? at.x - p.x : 0;
  const dy = at ? at.y - p.y : 0;
  const len = Math.hypot(dx, dy);
  if (len > 0.01) return { dx: dx / len, dy: dy / len };
  return p.facing ?? { dx: 1, dy: 0 };
}
