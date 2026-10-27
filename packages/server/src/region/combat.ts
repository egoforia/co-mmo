import {
  ABILITIES,
  abilityAmount,
  afterArmor,
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
  maxHp,
  partyXp,
  staggerChance,
  wieldedFamily,
  wieldsTrained,
  type DamageType,
} from '@co-mmo/shared';
import { provoke } from '../creature-brain.ts';
import type { Quests } from './quests.ts';
import type { Creature, PlayerState, RegionState } from './state.ts';

/**
 * Players fighting creatures: plain attacks, abilities, and what a defeat
 * pays (XP shared with the party nearby, gold, a body with its loot).
 */
export class Combat {
  constructor(
    private readonly s: RegionState,
    private readonly quests: Quests,
  ) {}

  /**
   * A plain attack (Space) on the nearest creature in the weapon's reach, once
   * it is ready: bows, wands and the like fire across the room. A trained
   * greatsword also hits the next creature in reach, a censer everything
   * close to its target, and a heavy weapon may stagger what it hits.
   */
  attack(p: PlayerState): void {
    const now = this.s.now();
    const ch = p.character;
    if (ch.hp <= 0 || now - p.lastAttack < attackCooldown(ch) * 1000 - 1) return;
    p.lastAttack = now;
    const reach = attackReach(ch);
    const target = this.creatureInReach(p, reach);
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
      this.strike(p, c, this.critical(p, power * (0.9 + this.s.random() * 0.2)), { type: family.damageType, ranged: family.ranged });
    }
  }

  /** Live creatures on the player's floor within `range` of a point, nearest first. */
  private creaturesNear(p: PlayerState, at: { x: number; y: number }, range: number): Creature[] {
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
  private creatureInReach(p: PlayerState, range: number, id?: string): Creature | undefined {
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

  /** A hit made critical by chance (Agility raises it) does half again as much. */
  private critical(p: PlayerState, amount: number): number {
    return this.s.random() < critChance(p.character) ? amount * CRIT_MULTIPLIER : amount;
  }

  /**
   * Damages a creature (halved while Weakened): its Armor softens physical
   * hits and its Ward arcane ones. A defeat pays the rewards.
   */
  private strike(p: PlayerState, target: Creature, raw: number, how: { type: DamageType; ability?: string; ranged?: boolean }): void {
    const weakened = this.s.now() < p.character.weakenedUntil ? 0.5 : 1;
    const defence = how.type === 'arcane' ? target.def.ward : target.def.armor;
    const amount = afterArmor(raw * weakened, defence ?? 0);
    target.hp = Math.max(0, target.hp - amount);
    const defeated = target.hp === 0;
    const { ability, ranged, type } = how;
    this.s.broadcastNear(target, { t: 'hit', by: p.info.id, target: target.id, amount, defeated, damage: type, ...(ability ? { ability } : {}), ...(ranged ? { ranged } : {}) });
    if (!defeated) return provoke(target, p.info.id, { creatures: this.s.creatures, now: this.s.now() });
    target.respawnAt = this.s.now() + target.def.respawnSeconds * 1000;
    target.aggro = null;
    this.reward(p, target);
  }

  /** Uses an ability (keys 1 to 4): a heal, or a strike or bolt at a creature in reach. */
  useAbility(p: PlayerState, id: string, targetId?: string): void {
    const a = ABILITIES[id];
    const ch = p.character;
    if (!a || !ch.abilities.includes(id) || ch.hp <= 0) return;
    const now = this.s.now();
    if (now < (p.readyAt.get(id) ?? 0) - 1) return;
    if (ch.energy < a.energy) return this.s.notice(p, `Not enough Energy for ${a.name}.`);
    const max = maxHp(ch);
    let target: Creature | undefined;
    if (a.effect === 'heal') {
      if (ch.hp >= max) return this.s.notice(p, 'You are already at full health.');
    } else {
      target = this.creatureInReach(p, a.range, targetId) ?? (targetId ? this.creatureInReach(p, a.range) : undefined);
      if (!target) return this.s.notice(p, a.effect === 'bolt' ? `No creature within ${a.range} steps.` : 'Nothing in reach to strike.');
    }
    ch.energy -= a.energy;
    // Wit shortens the rest; the client shows the rest it is told.
    const rest = Math.round(a.cooldown * cooldownFactor(ch) * 10) / 10;
    p.readyAt.set(id, now + rest * 1000);
    p.conn.send({ t: 'cooldown', ability: id, seconds: rest });
    p.dirty = true;
    const amount = abilityAmount(ch, a) * (0.9 + this.s.random() * 0.2);
    // Bolts are arcane; strikes are blows of the weapon, so physical.
    if (target) this.strike(p, target, this.critical(p, amount), { type: a.effect === 'bolt' ? 'arcane' : 'physical', ability: id });
    else {
      const healed = Math.min(max - ch.hp, Math.round(amount));
      ch.hp += healed;
      this.s.notice(p, `${a.name} restores ${healed} health.`);
    }
    this.s.credit(id, p, 'use');
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
