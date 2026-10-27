// The five attributes and every number built on them: health, Energy,
// regeneration, attack, crits, stagger, dodge, block, cooldowns, Armor and
// Ward (docs/attributes.md). Re-exported from rpg.ts.

import { gearBonus, totalStats, type Character, type Stats } from '../rpg.ts';
import type { CallingId } from '../classes.ts';
import { UNTRAINED_DAMAGE, trainedShield, wieldedFamily, wieldsTrained } from '../weapons.ts';

/** What a formula needs: the character's level, attributes, what they wear and (once chosen) their Calling. */
type Gear = Pick<Character, 'level' | 'stats'> & Partial<Pick<Character, 'equipment'>> & { calling?: CallingId | null };
type Worn = Pick<Character, 'stats'> & Partial<Pick<Character, 'equipment'>> & { calling?: CallingId | null };

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

/**
 * A plain attack's damage before randomness, defence and debuffs: the
 * family's and the item's damage, plus level, plus each attribute times the
 * family's scale. A weapon outside the character's training deals 30% less.
 */
export function attackPower(c: Gear): number {
  const family = wieldedFamily(c);
  const s = totalStats(c);
  let amount = family.damage + gearBonus(c, 'attack') + c.level;
  for (const [k, factor] of Object.entries(family.scale) as [keyof Stats, number][]) amount += s[k] * factor;
  return Math.round(amount * (wieldsTrained(c) ? 1 : UNTRAINED_DAMAGE));
}

/** Seconds between attacks: the family's speed, up to 30% quicker with Agility, never under 0.35. */
export function attackCooldown(c: Worn): number {
  const bonus = Math.min(0.3, totalStats(c).agility * 0.01);
  return Math.max(0.35, Math.round((wieldedFamily(c).speed / (1 + bonus)) * 100) / 100);
}

/** How far a plain attack reaches, in tiles: the weapon family's reach. */
export function attackReach(c: Partial<Pick<Character, 'equipment'>>): number {
  return wieldedFamily(c).reach;
}

/** Chance (0 to 0.25) that a heavy weapon's hit cancels the target's next attack: Might raises it. */
export function staggerChance(c: Worn): number {
  return wieldedFamily(c).heavy && wieldsTrained(c) ? Math.min(0.25, totalStats(c).might * 0.01) : 0;
}

/** A trained shield's chance (at most 0.4) to block a hit, and how much a block takes off (Might adds to it). */
export function blocking(c: Worn): { chance: number; amount: number } {
  const shield = trainedShield(c);
  if (!shield?.block) return { chance: 0, amount: 0 };
  return { chance: Math.min(0.4, shield.block), amount: (shield.blockAmount ?? 0) + totalStats(c).might * 0.5 };
}

/** Damage of a critical hit, as a multiple of the hit. */
export const CRIT_MULTIPLIER = 1.5;

/** Chance (0 to 0.35) that a hit is critical: Agility raises it, and so do twin blades. */
export function critChance(c: Worn): number {
  const weapon = wieldsTrained(c) ? (wieldedFamily(c).crit ?? 0) : 0;
  return Math.min(0.35, 0.05 + totalStats(c).agility * 0.004 + weapon);
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

/** Defence against arcane hits: worn ward plus half of Spirit. */
export function ward(c: Worn): number {
  return gearBonus(c, 'ward') + totalStats(c).spirit * 0.5;
}
