// The five attributes and every number built on them: health, Energy,
// regeneration, attack, crits, dodge, cooldowns, Armor and Ward
// (docs/attributes.md). Re-exported from rpg.ts.

import { gearBonus, totalStats, type Character } from '../rpg.ts';

/** What a formula needs: the character's level, attributes and what they wear. */
type Gear = Pick<Character, 'level' | 'stats'> & Partial<Pick<Character, 'equipment'>>;
type Worn = Pick<Character, 'stats'> & Partial<Pick<Character, 'equipment'>>;

/** Health: mostly from Vigor, a little from Might. */
export function maxHp(c: Gear): number {
  const s = totalStats(c);
  return 20 + c.level * 6 + s.vigor * 4 + s.might;
}

/** Energy for abilities: Wit raises it. */
export function maxEnergy(c: Gear): number {
  return 20 + c.level * 2 + totalStats(c).wit * 3;
}

/** Energy regained per second, always (Spirit speeds it up). */
export function energyPerSecond(c: Worn): number {
  return 1.5 + totalStats(c).spirit * 0.12;
}

/** Health regained per second once out of combat. */
export function regenPerSecond(c: Worn): number {
  return 1 + totalStats(c).spirit * 0.3;
}

/** Damage left after armour: each point of armour takes off a little, never all of it. */
export function afterArmor(amount: number, armor: number): number {
  return Math.max(1, Math.round((amount * 12) / (12 + Math.max(0, armor))));
}

// Weapon families (build plan step 3) bring each weapon's speed and scaling;
// until then a plain attack keeps the old power and speed.

/** Damage before randomness and debuffs. */
export function attackPower(c: Gear): number {
  return 3 + totalStats(c).might + c.level + gearBonus(c, 'attack');
}

/** Seconds between attacks: Agility makes them quicker. */
export function attackCooldown(c: Worn): number {
  return Math.max(0.35, 0.8 - totalStats(c).agility * 0.03);
}

/** Damage of a critical hit, as a multiple of the hit. */
export const CRIT_MULTIPLIER = 1.5;

/** Chance (0 to 0.35) that a hit is critical: Agility raises it. */
export function critChance(c: Worn): number {
  return Math.min(0.35, 0.05 + totalStats(c).agility * 0.004);
}

/** Chance (0 to 0.2) to dodge a physical hit: Agility raises it. */
export function dodgeChance(c: Worn): number {
  return Math.min(0.2, totalStats(c).agility * 0.0025);
}

/** What ability rests are multiplied by: Wit shortens them, by at most a fifth. */
export function cooldownFactor(c: Worn): number {
  return 1 - Math.min(0.2, totalStats(c).wit * 0.004);
}

/** Defence against physical hits: worn armour plus half of Vigor. */
export function armor(c: Worn): number {
  return gearBonus(c, 'armor') + totalStats(c).vigor * 0.5;
}

/** Defence against arcane hits: half of Spirit (worn ward comes with damage types). */
export function ward(c: Worn): number {
  return totalStats(c).spirit * 0.5;
}
