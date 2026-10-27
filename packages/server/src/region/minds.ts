import { ITEMS, TALK_RANGE, afterArmor, armor, dodgeChance, heldItem, offHandItem, type Weather } from '@co-mmo/shared';
import { giveUp, think, type Creature, type Habitat, type Prey } from '../creature-brain.ts';
import { live, type Townsperson } from '../townsfolk.ts';
import type { PlayerState, RegionState } from './state.ts';

/**
 * Runs the region's creatures and NPCs each tick. How they behave lives in
 * creature-brain.ts and townsfolk.ts; this system shows them the region
 * (its players, the hour, the weather) and deals the blows creatures strike.
 */
export class Minds {
  constructor(
    private readonly s: RegionState,
  ) {}

  /** Every creature takes its turn: respawn, sleep, notice, fight, run, walk home or roam. */
  think(now: number, phase: number, weather: Weather): void {
    const habitat = this.habitat(now, phase, weather);
    for (const c of this.s.creatures) think(c, habitat);
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
    // A creature's bite is physical: Agility may dodge it, Armour (gear and Vigor) softens it.
    if (this.s.random() < dodgeChance(p.character)) return;
    const amount = afterArmor(c.def.damage * (0.8 + this.s.random() * 0.4), armor(p.character));
    p.character.hp = Math.max(0, p.character.hp - amount);
    p.lastHurt = now;
    const defeated = p.character.hp === 0;
    this.s.broadcastNear(p, { t: 'hit', by: c.id, target: p.info.id, amount, defeated });
    if (defeated) giveUp(c);
  }
}
