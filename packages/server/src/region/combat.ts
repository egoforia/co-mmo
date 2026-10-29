import {
  ABILITIES,
  MARK_BONUS,
  abilityAmount,
  absorb,
  afterArmor,
  canAct,
  statusOf,
  lootTable,
  rollDrops,
  BODY_SECONDS,
  VIEW_RADIUS,
  attackCooldown,
  attackPower,
  attackReach,
  cooldownFactor,
  critChance,
  CRIT_MULTIPLIER,
  discover,
  gainXp,
  partyXp,
  staggerChance,
  wieldedFamily,
  wieldsTrained,
  type StatusId,
} from '@co-mmo/shared';
import { provoke } from '../creature-brain.ts';
import { addThreat } from '../threat.ts';
import { EFFECTS, endStance, helpersAct, holdStances, springTraps, type Blow, type Cast, type EffectKit } from './effects/index.ts';
import type { Fallen } from './fallen.ts';
import type { Gauges } from './gauges.ts';
import { PATH_RULES, type Paths } from './paths/index.ts';
import { SKILL_RULES, tendSanctuaries } from './skills/index.ts';
import type { Quests } from './quests.ts';
import type { Creature, PlayerState, RegionState } from './state.ts';
import { tickStatuses } from './statuses.ts';

/**
 * Players fighting creatures: plain attacks, abilities, and what a defeat
 * pays (XP shared with the party nearby, gold, a body with its loot).
 * Each ability effect is a small function in effects/; this gives them the
 * moves they share (EffectKit) and ticks statuses, traps, helpers and stances.
 */
export class Combat implements EffectKit {
  constructor(
    readonly s: RegionState,
    private readonly quests: Quests,
    readonly gauges: Gauges,
    private readonly fallen: Fallen,
    readonly paths: Paths,
  ) {}

  /** Raises a Fallen player where they lie (Peal of Waking). */
  raise(p: PlayerState, share: number, by: PlayerState): boolean {
    return this.fallen.raise(p, share, by);
  }

  /**
   * A plain attack (Space) on the chosen creature, or the nearest when it is
   * out of the weapon's reach, once it is ready: bows, wands and the like fire across the room. A trained
   * greatsword also hits the next creature in reach, a censer everything
   * close to its target, and a heavy weapon may stagger what it hits.
   */
  attack(p: PlayerState, targetId?: string): void {
    const now = this.s.now();
    const ch = p.character;
    if (ch.hp <= 0 || !canAct(p, now) || now - p.lastAttack < attackCooldown(ch) * 1000 - 1) return;
    p.lastAttack = now;
    const reach = attackReach(ch);
    const target = (targetId && this.creatureInReach(p, reach, targetId)) || this.creatureInReach(p, reach);
    if (!target) return;
    const family = wieldedFamily(ch);
    const trained = wieldsTrained(ch);
    const hits = [target];
    if (trained && family.targets) {
      for (const c of this.creaturesNear(p, p, reach)) if (hits.length < family.targets && !hits.includes(c)) hits.push(c);
    }
    if (trained && family.splash) {
      for (const c of this.creaturesNear(p, target, family.splash)) if (!hits.includes(c)) hits.push(c);
    }
    const power = attackPower(ch);
    const stagger = staggerChance(ch);
    for (const c of hits) {
      if (stagger && this.s.random() < stagger) this.stagger(c);
      const plain = power * (0.9 + this.s.random() * 0.2);
      const hit = this.critical(p, plain);
      this.strike(p, c, hit, { type: family.damageType, ranged: family.ranged, ...(hit > plain ? { crit: true } : {}) });
      this.gauges.landed(p);
    }
  }

  /** Live creatures on the player's floor within `range` of a point, nearest first. */
  creaturesNear(p: PlayerState, at: { x: number; y: number }, range: number): Creature[] {
    return this.s.creatures
      .filter((c) => c.respawnAt === null && c.floor === p.floor && Math.hypot(c.x - at.x, c.y - at.y) <= range)
      .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
  }

  /** A heavy blow cancels the creature's next attack: it waits a whole rest from now. */
  private stagger(c: Creature): void {
    const rest = c.def.cooldown * 1000;
    c.lastAttack = Math.max(c.lastAttack, this.s.now() - rest) + rest;
  }

  /** The nearest live creature within reach, or the one asked for if it is in reach. */
  creatureInReach(p: PlayerState, range: number, id?: string): Creature | undefined {
    let target: Creature | undefined;
    let best = range;
    for (const c of this.s.creatures) {
      if (c.respawnAt !== null || c.floor !== p.floor || (id && c.id !== id)) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= best) {
        best = d;
        target = c;
      }
    }
    return target;
  }

  /** Party members on their feet within `radius` of the player (and the player, first). */
  partyNear(p: PlayerState, radius: number): PlayerState[] {
    const party = this.s.hooks.party?.(p.info.id) ?? [p.info.id];
    const near = party
      .map((id) => this.s.players.get(id))
      .filter((m): m is PlayerState => !!m && m !== p && m.character.hp > 0 && m.floor === p.floor && Math.hypot(m.x - p.x, m.y - p.y) <= radius);
    return [p, ...near];
  }

  /** A hit made critical by chance (Agility and Focus raise it) does half again as much. */
  critical(p: PlayerState, amount: number): number {
    // A Duelist's next hit out of a Mirage is critical whatever the dice say.
    if (this.paths.critical(p)) return amount * CRIT_MULTIPLIER;
    return this.s.random() < critChance(p.character) + this.gauges.critBonus(p) ? amount * CRIT_MULTIPLIER : amount;
  }

  /**
   * Damages a creature (halved while Weakened, more if it is Marked by the
   * player or their party): its shield takes the hit first, then its Armor
   * softens physical hits and its Ward arcane ones, unless the blow pierces.
   * The damage is threat from the player (times the ability's `threat`).
   * A defeat pays the rewards.
   */
  strike(p: PlayerState, target: Creature, raw: number, how: Blow): void {
    const now = this.s.now();
    const weakened = now < p.character.weakenedUntil ? 0.5 : 1;
    const mark = statusOf(target, 'marked', now);
    const marked = mark?.by && (mark.by === p.info.id || (this.s.hooks.party?.(p.info.id) ?? []).includes(mark.by)) ? 1 + MARK_BONUS : 1;
    const defence = how.pierce ? 0 : how.type === 'arcane' ? target.def.ward : target.def.armor;
    // Path passives and a Knell make some blows land harder (paths/index.ts).
    const amount = afterArmor(absorb(target, raw * weakened * marked * this.paths.dealtTo(p, target, now), now), defence ?? 0);
    target.hp = Math.max(0, target.hp - amount);
    const defeated = target.hp === 0;
    const { ability, ranged, type } = how;
    this.s.broadcastNear(target, { t: 'hit', by: p.info.id, target: target.id, amount, defeated, damage: type, ...(ability ? { ability } : {}), ...(ranged ? { ranged } : {}) });
    this.paths.landed(p, target, amount, how, now);
    if (!defeated) {
      addThreat(target, p.info.id, amount * ((ability && ABILITIES[ability]?.threat) || 1));
      return provoke(target, p.info.id, { creatures: this.s.creatures, now });
    }
    target.respawnAt = now + target.def.respawnSeconds * 1000;
    target.aggro = null;
    target.threat = {};
    target.statuses = [];
    this.reward(p, target);
  }

  /**
   * Uses an ability (keys 1 to 6): its effect (effects/), or the Calling
   * skill's own rule (skills/), checks it can be used, then Energy and the
   * rest are paid and it runs. Skills that add gauge pips add them after.
   * Using a stance that is already held leaves it, at no cost.
   */
  useAbility(p: PlayerState, id: string, targetId?: string): void {
    const a = ABILITIES[id];
    const ch = p.character;
    if (!a || !ch.abilities.includes(id) || ch.hp <= 0) return;
    const now = this.s.now();
    if (!canAct(p, now)) return this.s.notice(p, 'You are Stunned and cannot act.');
    if (a.effect === 'stance' && p.stance?.ability === id) return endStance(this, p);
    // A Path skill used again while what it made is out ends it, like leaving a stance (the spirit hawk).
    const ended = PATH_RULES[id]?.again?.(this, p, id);
    if (ended) return this.s.notice(p, ended);
    if (now < (p.readyAt.get(id) ?? 0) - 1) return;
    if (ch.energy < a.energy) return this.s.notice(p, `Not enough Energy for ${a.name}.`);
    const effect = EFFECTS[a.effect];
    // A Calling skill or Path skill may check and do more than its effect's data says (skills/, paths/).
    const rule = SKILL_RULES[id] ?? PATH_RULES[id];
    const cast: Cast = { p, id, a, now, amount: 0, ...(targetId ? { targetId } : {}) };
    const refused = rule?.ready ? rule.ready(this, cast, effect) : effect.ready?.(this, cast);
    if (refused) return this.s.notice(p, refused);
    ch.energy -= a.energy;
    // Wit shortens the rest; the client shows the rest it is told.
    const rest = Math.round(a.cooldown * cooldownFactor(ch) * 10) / 10;
    p.readyAt.set(id, now + rest * 1000);
    p.conn.send({ t: 'cooldown', ability: id, seconds: rest });
    p.dirty = true;
    // The gauge may lift it: a finisher grows with the pips it spends, a Woven spell doubles.
    const spend = this.gauges.cast(p, a);
    cast.amount = this.paths.castAmount(p, a, abilityAmount(ch, a)) * (0.9 + this.s.random() * 0.2) * spend.factor;
    if (spend.woven) cast.woven = true;
    if (spend.spent) cast.spent = spend.spent;
    if (rule?.run) rule.run(this, cast, effect);
    else effect.run(this, cast);
    this.gauges.spend(p, spend);
    // Riposte and Sidestep add Momentum (a taunt counts what it turned, effects/marks.ts).
    if (a.gain && a.effect !== 'taunt') this.gauges.add(p, a.gain);
    this.paths.afterCast(p, a, spend);
    this.s.credit(id, p, 'use');
  }

  /** Each tick: statuses wear off and hurt, traps spring, helpers strike, Sanctuaries heal, stances drain Energy and gauges move. */
  tick(now: number): void {
    tickStatuses(this.s, now, (by, c, amount, id) => this.strike(by, c, amount, statusBlow(id)));
    springTraps(this, now);
    helpersAct(this, now);
    tendSanctuaries(this, now);
    holdStances(this);
    this.paths.tick(now);
    this.gauges.tick(now);
  }

  private reward(p: PlayerState, c: Creature): void {
    const ch = p.character;
    // Party members close by share the XP and the quest progress.
    const party = this.s.hooks.party?.(p.info.id) ?? [p.info.id];
    const sharers = party
      .map((id) => this.s.players.get(id))
      .filter((m): m is PlayerState => !!m && (m === p || (m.character.hp > 0 && Math.abs(m.x - c.x) <= VIEW_RADIUS && Math.abs(m.y - c.y) <= VIEW_RADIUS)));
    const xp = partyXp(c.def.xp, sharers.length);
    const gained: string[] = [sharers.length > 1 ? `+${xp} XP (shared)` : `+${xp} XP`];
    const [lo, hi] = c.def.gold;
    const gold = lo + Math.floor(this.s.random() * (hi - lo + 1));
    if (gold) {
      ch.gold += gold;
      gained.push(`${gold} gold`);
    }
    // What it carried stays on its body for anyone to take (E): its loot as set in God's View and by wishes.
    this.s.bodies.push({
      id: `body-${++this.s.bodyCount}`, kind: c.kind, def: c.def, x: c.x, y: c.y, floor: c.floor,
      until: this.s.now() + BODY_SECONDS * 1000, finders: sharers.map((m) => m.info.id), loot: rollDrops(lootTable(c.kind), this.s.random),
    });
    discover(ch, c.kind);
    this.s.hooks.event?.('defeat', p.info.id, { creature: c.kind });
    this.s.credit(c.kind, p, 'defeat');
    this.s.notice(p, `Defeated ${c.def.name}: ${gained.join(', ')}. Press E beside its body to search it.`);
    for (const m of sharers) {
      if (m !== p) {
        discover(m.character, c.kind);
        this.s.notice(m, `${p.info.name} defeated ${c.def.name}: +${xp} XP (shared).`);
      }
      this.quests.countDefeat(m, c.kind);
      this.s.levelUps(m, gainXp(m.character, xp));
      m.dirty = true;
    }
  }
}

/** A damage status's tick: Burning is arcane; Bleeding and Poison go past armour. */
function statusBlow(id: StatusId): Blow {
  return id === 'burning' ? { type: 'arcane' } : { type: 'physical', pierce: true };
}
