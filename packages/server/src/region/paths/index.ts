import {
  ATTACK_RANGE,
  TICK_SECONDS,
  knowsPassive,
  maxEnergy,
  maxHp,
  pathNumbers,
  statusOf,
  totalStats,
  type AbilityDef,
  type StatusId,
} from '@co-mmo/shared';
import type { Blow, EffectKit } from '../effects/index.ts';
import type { GaugeSpend, Gauges } from '../gauges.ts';
import type { Creature, PlayerState, RegionState } from '../state.ts';
import { afflictCreature, afflictPlayer } from '../statuses.ts';
import { BELLKEEPER_PATH_RULES } from './bellkeeper.ts';
import { DUELIST_PATH_RULES } from './duelist.ts';
import { RANGER_PATH_RULES } from './ranger.ts';
import type { PathRule } from './types.ts';
import { WARDEN_PATH_RULES } from './warden.ts';
import { WISHWEAVER_PATH_RULES } from './wishweaver.ts';

export { slowLength, type PathRule } from './types.ts';

/** Path skills that do more than their effect's data says, by ability id (build plan step 7b). */
export const PATH_RULES: Record<string, PathRule> = {
  ...WARDEN_PATH_RULES, ...DUELIST_PATH_RULES, ...RANGER_PATH_RULES, ...WISHWEAVER_PATH_RULES, ...BELLKEEPER_PATH_RULES,
};

/** Creature statuses Loose Ends rewards. */
const BOUND: readonly StatusId[] = ['slowed', 'rooted', 'silenced'];

/** One blow a creature dealt a player, kept a few seconds for Rewrite. */
interface Blowed {
  victim: string;
  by: string;
  amount: number;
  at: number;
}

/**
 * Path skills at work in a region (docs/classes/*.md, Paths): the timed
 * parts of great skills (falling stars, a spin, a dance, a drawn arrow, a
 * fading heal), the passives, and the few places combat asks about them.
 * Combat and Minds call its hooks; each Calling's rules are in their own file.
 */
export class Paths {
  /** Things that happen later, in order of when. */
  private jobs: { at: number; run: () => void }[] = [];
  /** Blows creatures dealt players lately (Rewrite looks back over them). */
  private blows: Blowed[] = [];
  /** Players whose next hit is a critical one (Mirage), and when Steady Breath last held. */
  private readonly ambushers = new Set<string>();
  private readonly breaths = new Map<string, number>();

  constructor(
    readonly s: RegionState,
    readonly gauges: Gauges,
    /** The combat moves (Combat), for passives that strike back or heal from a tick. */
    private readonly kit: () => EffectKit,
  ) {}

  /** Runs `run` at `at` (epoch ms), from the region's tick. */
  later(at: number, run: () => void): void {
    this.jobs.push({ at, run });
    this.jobs.sort((a, b) => a.at - b.at);
  }

  /** Mirage: the player's next hit is a critical hit. */
  ambush(p: PlayerState): void {
    this.ambushers.add(p.info.id);
  }

  /** Each tick: what is due happens, Grace and Barkskin heal. */
  tick(now: number): void {
    while (this.jobs.length && this.jobs[0]!.at <= now) this.jobs.shift()!.run();
    this.blows = this.blows.filter((b) => now - b.at <= 5000);
    for (const p of this.s.players.values()) {
      const ch = p.character;
      if (ch.hp <= 0) continue;
      // Grace heals a little every tick; what goes past full may ring as Overtone.
      const grace = statusOf(p, 'graced', now);
      const by = grace?.by ? this.s.players.get(grace.by) : undefined;
      if (grace?.amount && by) {
        const before = ch.hp;
        const add = grace.amount * TICK_SECONDS;
        ch.hp = Math.min(maxHp(ch), ch.hp + add);
        this.overheal(by, p, add - (ch.hp - before));
      }
      // Barkskin: a full Resolve keeps the Warden healing, even in a fight.
      if (knowsPassive(ch, 'barkskin') && this.gauges.pips(p) >= 5 && ch.hp < maxHp(ch)) {
        ch.hp = Math.min(maxHp(ch), ch.hp + maxHp(ch) * (pathNumbers('barkskin').share ?? 0) * TICK_SECONDS);
      }
    }
  }

  // --- Asked by combat when a player strikes -----------------------------------

  /** True when the player's hit must be critical (Mirage's next hit), using it up. */
  critical(p: PlayerState): boolean {
    return this.ambushers.delete(p.info.id);
  }

  /** How much more a player's blow does to this creature: Pack Instinct, Loose Ends and Knell. */
  dealtTo(p: PlayerState, c: Creature, now: number): number {
    let more = 1;
    if (statusOf(c, 'marked', now) && knowsPassive(p.character, 'pack-instinct')) more += pathNumbers('pack-instinct').more ?? 0;
    if (BOUND.some((id) => statusOf(c, id, now)) && knowsPassive(p.character, 'loose-ends')) more += pathNumbers('loose-ends').more ?? 0;
    if (statusOf(c, 'knelled', now)) more += pathNumbers('knell').more ?? 0;
    return more;
  }

  /** After a player's blow landed: Knell heals the striker, Blazing Edge burns, the hawk Marks (Pack Instinct). */
  landed(p: PlayerState, c: Creature, amount: number, how: Blow, now: number): void {
    const ch = p.character;
    if (statusOf(c, 'knelled', now) && ch.hp > 0) {
      ch.hp = Math.min(maxHp(ch), ch.hp + Math.round(maxHp(ch) * (pathNumbers('knell').share ?? 0)));
      p.dirty = true;
    }
    if (c.respawnAt !== null) return;
    if (how.crit && knowsPassive(ch, 'blazing-edge')) {
      const n = pathNumbers('blazing-edge');
      const seconds = n.seconds ?? 3;
      afflictCreature(this.s, c, 'burning', seconds, { by: p.info.id, amount: Math.max(1, Math.round((amount * (n.share ?? 0)) / seconds)) });
    }
    if (how.ability === 'call-companion' && knowsPassive(ch, 'pack-instinct')) afflictCreature(this.s, c, 'marked', undefined, { by: p.info.id });
  }

  /** After a cast was paid for and run: Overflow gives back a Woven spell's Energy; Thirsting Blade heals for spent Momentum. */
  afterCast(p: PlayerState, a: AbilityDef, spend: GaugeSpend): void {
    const ch = p.character;
    if (spend.woven && knowsPassive(ch, 'overflow')) ch.energy = Math.min(maxEnergy(ch), ch.energy + a.energy);
    if (spend.spent && a.finisher && knowsPassive(ch, 'thirsting-blade')) {
      ch.hp = Math.min(maxHp(ch), ch.hp + Math.round(maxHp(ch) * (pathNumbers('thirsting-blade').share ?? 0) * spend.spent));
    }
  }

  /** A cast's amount with what passives add: Iron Psalm puts half your Vigor into heals. */
  castAmount(p: PlayerState, a: AbilityDef, amount: number): number {
    if (a.effect !== 'heal' || !knowsPassive(p.character, 'iron-psalm')) return amount;
    return amount + totalStats(p.character).vigor * (pathNumbers('iron-psalm').factor ?? 0);
  }

  /** Healing beyond full health becomes a shield (Overtone), up to a share of the healed one's health. */
  overheal(by: PlayerState, m: PlayerState, extra: number): void {
    if (extra <= 0 || !knowsPassive(by.character, 'overtone')) return;
    const n = pathNumbers('overtone');
    const size = Math.round(Math.min(extra, maxHp(m.character) * (n.share ?? 0)));
    if (size > 0) afflictPlayer(this.s, m, 'shielded', n.seconds, { by: by.info.id, amount: size });
  }

  // --- Asked by the creatures' minds when a creature strikes a player ----------

  /** True while creatures cannot see or strike the player (Hidden: Mirage, Sunfall Dance). */
  hidden(p: PlayerState, now: number): boolean {
    return !!statusOf(p, 'hidden', now);
  }

  /** How much of its blow a creature deals (Knelled: less). */
  dealtBy(c: Creature, now: number): number {
    return statusOf(c, 'knelled', now) ? 1 - (pathNumbers('knell').less ?? 0) : 1;
  }

  /** Armor a Path adds: Rooted Stand's, from Vigor, while the stance is held. */
  extraArmor(p: PlayerState): number {
    return p.stance?.ability === 'rooted-stand' ? p.stance.amount : 0;
  }

  /** What a blow may take from health: never the last point while Unyielding (Last Knight). */
  floor(p: PlayerState, amount: number, now: number): number {
    return statusOf(p, 'unyielding', now) ? Math.min(amount, Math.max(0, p.character.hp - 1)) : amount;
  }

  /**
   * True when a hit should leave the Ranger's Focus alone: Steady Breath
   * holds once every few seconds.
   */
  steady(p: PlayerState, now: number): boolean {
    if (!knowsPassive(p.character, 'steady-breath')) return false;
    const last = this.breaths.get(p.info.id);
    if (last !== undefined && now - last < (pathNumbers('steady-breath').seconds ?? 5) * 1000) return false;
    this.breaths.set(p.info.id, now);
    return true;
  }

  /** A creature's blow landed: remember it for Rewrite, and a Stonefist may strike straight back (Retaliate). */
  struck(p: PlayerState, c: Creature, amount: number, now: number): void {
    if (amount > 0) this.blows.push({ victim: p.info.id, by: c.id, amount, at: now });
    const ch = p.character;
    if (ch.hp <= 0 || !knowsPassive(ch, 'retaliate') || Math.hypot(c.x - p.x, c.y - p.y) > ATTACK_RANGE + 0.5) return;
    const n = pathNumbers('retaliate');
    if (this.gauges.pips(p) < 5 && this.s.random() >= (n.chance ?? 0)) return;
    const back = ch.level + totalStats(ch).might * (n.factor ?? 0);
    this.kit().strike(p, c, back, { type: 'physical', ability: 'retaliate' });
  }

  /** Damage taken by a player, or dealt by a creature, within the last `seconds` (Rewrite). */
  recent(who: { victim?: string; by?: string }, seconds: number, now: number): number {
    return this.blows
      .filter((b) => now - b.at <= seconds * 1000 && (!who.victim || b.victim === who.victim) && (!who.by || b.by === who.by))
      .reduce((sum, b) => sum + b.amount, 0);
  }

  /** Forgets the blows a player took (they were rewritten). */
  rewritten(victim: string): void {
    this.blows = this.blows.filter((b) => b.victim !== victim);
  }
}
