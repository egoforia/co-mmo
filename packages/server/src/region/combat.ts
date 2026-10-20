import {
  ABILITIES,
  ATTACK_RANGE,
  abilityAmount,
  lootTable,
  rollDrops,
  BODY_SECONDS,
  VIEW_RADIUS,
  attackCooldown,
  attackPower,
  discover,
  gainXp,
  maxHp,
  partyXp,
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

  /** A plain attack (Space) on the nearest creature in reach, once the weapon is ready. */
  attack(p: PlayerState): void {
    const now = this.s.now();
    if (p.character.hp <= 0 || now - p.lastAttack < attackCooldown(p.character) * 1000 - 1) return;
    p.lastAttack = now;
    const target = this.creatureInReach(p, ATTACK_RANGE);
    if (!target) return;
    this.strike(p, target, attackPower(p.character) * (0.8 + this.s.random() * 0.4));
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

  /** Damages a creature (halved while Weakened); a defeat pays the rewards. */
  private strike(p: PlayerState, target: Creature, raw: number, ability?: string): void {
    const weakened = this.s.now() < p.character.weakenedUntil ? 0.5 : 1;
    const amount = Math.max(1, Math.round(raw * weakened));
    target.hp = Math.max(0, target.hp - amount);
    const defeated = target.hp === 0;
    this.s.broadcastNear(target, { t: 'hit', by: p.info.id, target: target.id, amount, defeated, ...(ability ? { ability } : {}) });
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
    p.readyAt.set(id, now + a.cooldown * 1000);
    p.conn.send({ t: 'cooldown', ability: id, seconds: a.cooldown });
    p.dirty = true;
    const amount = abilityAmount(ch, a) * (0.9 + this.s.random() * 0.2);
    if (target) this.strike(p, target, amount, id);
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
