import { EVASIVE_DODGE, ITEMS, TALK_RANGE, absorb, afterArmor, armor, blocking, canAct, dodgeChance, heldItem, offHandItem, paceOf, statusOf, type Weather } from '@co-mmo/shared';
import { forget, think, type Creature, type Habitat, type Prey } from '../creature-brain.ts';
import { live, type Townsperson } from '../townsfolk.ts';
import type { Combat } from './combat.ts';
import type { CombatLogger } from './combat-logger.ts';
import type { Gauges } from './gauges.ts';
import type { PlayerState, RegionState } from './state.ts';

/**
 * Runs the region's creatures and NPCs each tick. How they behave lives in
 * creature-brain.ts and townsfolk.ts; this system shows them the region
 * (its players, the hour, the weather) and deals the blows creatures strike.
 */
export class Minds {
  logger?: CombatLogger;

  constructor(
    private readonly s: RegionState,
    private readonly gauges: Gauges,
    private readonly combat: Pick<Combat, 'strike'>,
  ) {}

  /**
   * Every creature takes its turn: respawn, sleep, notice, fight, run, walk
   * home or roam. A Stunned one loses its turn; Slowed and Rooted ones move
   * slower or not at all.
   */
  think(now: number, phase: number, weather: Weather): void {
    const habitat = this.habitat(now, phase, weather);
    for (const c of this.s.creatures) {
      if (c.respawnAt === null && !canAct(c, now)) continue;
      c.pace = paceOf(c, now);
      think(c, habitat);
    }
  }

  /** NPCs go about their day, but wait while someone is close enough to talk. */
  live(phase: number): void {
    for (const n of this.s.townsfolk) live(n, { map: this.s.map, random: this.s.random, phase, listening: this.listening(n) });
  }

  /** The land as its creatures find it this tick. */
  private habitat(now: number, phase: number, weather: Weather): Habitat {
    const players: Prey[] = [];
    for (const p of this.s.players.values()) {
      const lit = [heldItem(p.character), offHandItem(p.character)].some((item) => item && ITEMS[item]?.light);
      players.push({ id: p.info.id, x: p.x, y: p.y, floor: p.floor, alive: p.character.hp > 0, lit });
    }
    return {
      map: this.s.map, now, tick: this.s.tickCount, random: this.s.random, phase, weather, players, creatures: this.s.creatures,
      hurt: (c, id) => {
        const p = this.s.players.get(id);
        if (p) this.hurt(p, c, now);
      },
    };
  }

  /** True while someone stands close enough to talk to this person, so they wait. */
  private listening(n: Townsperson): boolean {
    for (const p of this.s.players.values()) {
      if (p.character.hp > 0 && p.floor === n.floor && Math.hypot(p.x - n.x, p.y - n.y) <= TALK_RANGE) return true;
    }
    return false;
  }

  private hurt(p: PlayerState, c: Creature, now: number): void {
    // A creature's bite is physical: Agility may dodge it (more while
    // Evasive), a Poised Duelist turns it aside and strikes back, a shield
    // may block some of it, Armour (gear and Vigor) softens the rest, being
    // Guarded spares a share, and a Shield takes it before health.
    const dodgeChanceVal = dodgeChance(p.character) + (statusOf(p, 'evasive', now) ? EVASIVE_DODGE : 0);
    const dodgeRoll = this.s.random();
    const dodged = dodgeRoll < dodgeChanceVal;
    if (dodged) {
      if (this.logger?.active) {
        this.logger.record({
          id: `hit-${++this.s.bodyCount}-${now}`,
          at: now,
          tick: this.s.tickCount,
          region: this.s.map.def.id,
          attacker: { id: c.id, name: c.def.name, kind: 'creature' },
          target: { id: p.info.id, name: p.info.name, kind: 'player' },
          action: { id: 'attack', name: 'Attack', kind: 'attack' },
          damageType: 'physical',
          pierce: false,
          rolls: {
            variance: 1,
            dodge: { chance: dodgeChanceVal, rolled: dodgeRoll, dodged: true },
          },
          factors: { base: c.def.damage, power: c.def.damage, raw: 0 },
          mitigation: { shieldAbsorb: 0, defenseStat: armor(p.character), afterDefense: 0 },
          finalAmount: 0,
          defeated: false,
        });
      }
      return;
    }
    const poised = statusOf(p, 'poised', now);
    if (poised) {
      p.statuses.splice(p.statuses.indexOf(poised), 1);
      this.s.notice(p, `You turn the ${c.def.name}'s blow aside and strike back.`);
      this.combat.strike(p, c, poised.amount ?? 0, { type: 'physical', ability: 'riposte' });
      return;
    }
    const varianceRoll = 0.8 + this.s.random() * 0.4;
    let raw = c.def.damage * varianceRoll;
    const baseRaw = raw;
    const shield = blocking(p.character);
    const blockRoll = this.s.random();
    const blocked = Boolean(shield.chance && blockRoll < shield.chance);
    if (blocked) raw = Math.max(0, raw - shield.amount);
    const guard = statusOf(p, 'guarded', now);
    // Hold the Line: each blow on a Guarded ally steadies the Warden who guards them.
    if (guard?.by && guard.by !== p.info.id) {
      const warden = this.s.players.get(guard.by);
      if (warden) this.gauges.add(warden, 1, 'resolve');
    }
    const targetArmor = armor(p.character);
    const afterArmorVal = afterArmor(raw, targetArmor) * (1 - (guard?.amount ?? 0) / 100);
    const amount = absorb(p, afterArmorVal, now);
    const shieldAbsorb = afterArmorVal - amount;
    p.character.hp = Math.max(0, p.character.hp - amount);
    p.lastHurt = now;
    this.gauges.struck(p);
    const defeated = p.character.hp === 0;
    this.s.broadcastNear(p, { t: 'hit', by: c.id, target: p.info.id, amount, defeated });

    if (this.logger?.active) {
      this.logger.record({
        id: `hit-${++this.s.bodyCount}-${now}`,
        at: now,
        tick: this.s.tickCount,
        region: this.s.map.def.id,
        attacker: { id: c.id, name: c.def.name, kind: 'creature' },
        target: { id: p.info.id, name: p.info.name, kind: 'player' },
        action: { id: 'attack', name: 'Attack', kind: 'attack' },
        damageType: 'physical',
        pierce: false,
        rolls: {
          variance: varianceRoll,
          dodge: { chance: dodgeChanceVal, rolled: dodgeRoll, dodged: false },
          block: shield.chance ? { chance: shield.chance, rolled: blockRoll, blocked, amount: blocked ? shield.amount : 0 } : undefined,
        },
        factors: {
          base: c.def.damage,
          power: c.def.damage,
          raw: baseRaw,
        },
        mitigation: {
          shieldAbsorb,
          defenseStat: targetArmor,
          afterDefense: afterArmorVal,
        },
        finalAmount: amount,
        defeated,
      });
    }

    // Fallen: every creature after them turns to whoever else threatened it, or goes home.
    if (defeated) this.forgetPlayer(p.info.id, now);
  }

  /** A player fell or left: off every creature's threat list. */
  forgetPlayer(id: string, now: number): void {
    const standing = (other: string) => (this.s.players.get(other)?.character.hp ?? 0) > 0 && other !== id;
    for (const c of this.s.creatures) if (c.threat[id] !== undefined || c.aggro === id || c.fleeing === id) forget(c, id, standing, now);
  }
}
