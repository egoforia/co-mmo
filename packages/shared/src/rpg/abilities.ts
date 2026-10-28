// What abilities are made of: the closed effect kit that hand-made and
// wished skills both draw on (docs/classes.md, New mechanics). The God picks
// only the effect; the world sets the numbers. Re-exported from rpg.ts.

import type { Stats } from '../rpg.ts';
import type { DamageType } from '../weapons.ts';
import type { StatusId } from './statuses.ts';

/**
 * What an ability does. Damage: `strike` (your weapon, in reach), `bolt`
 * (one creature further off), `area` (around you, or around the creature
 * you chose), `cone` (in front of you), `line` (straight ahead), `dash`
 * (run to a creature and strike it), `trap` (springs on the first creature
 * to step on it) and `summon` (a helper that fights beside you). Movement:
 * `blink` (vanish and appear further on). Support: `heal`, `shield`,
 * `buff` (a status on you and your party close by), `cleanse`, and
 * `stance` (on until used again, draining Energy each second). Against
 * creatures: `debuff` (a status or mark) and `taunt`.
 */
export type AbilityEffect =
  | 'strike'
  | 'bolt'
  | 'heal'
  | 'area'
  | 'cone'
  | 'line'
  | 'dash'
  | 'blink'
  | 'shield'
  | 'buff'
  | 'debuff'
  | 'taunt'
  | 'trap'
  | 'summon'
  | 'stance'
  | 'cleanse';

/** Every effect in the kit, in the order the God's prompt lists them. */
export const ABILITY_EFFECTS: readonly AbilityEffect[] = [
  'strike', 'bolt', 'heal', 'area', 'cone', 'line', 'dash', 'blink', 'shield', 'buff', 'debuff', 'taunt', 'trap', 'summon', 'stance', 'cleanse',
];

/** The Wishweaver's three threads (docs/classes/wishweaver.md); the Weave gauge reads them (build plan step 6). */
export type Thread = 'ember' | 'tide' | 'gale';

export interface AbilityDef {
  name: string;
  description: string;
  effect: AbilityEffect;
  /** Energy it costs (a stance: Energy each second while on). */
  energy: number;
  /** Seconds before it can be used again. */
  cooldown: number;
  /** How far it reaches, in tiles (not used by heal). */
  range: number;
  /** The amount is base + level + stat × factor (+ weapon damage for strikes and dashes). */
  base: number;
  stat: keyof Stats;
  factor: number;
  /** The one status it adds: on each creature it hits, or on you and your party for buffs and stances. */
  status?: StatusId;
  /** Tiles around the spot an area, taunt, trap, buff or cleanse covers (a summon: how far it looks for creatures). */
  radius?: number;
  /** Seconds its status, trap, summon or shield lasts, when not the status's usual length. */
  duration?: number;
  /** Physical or arcane, when not the effect's own kind (see abilityDamageType). */
  damageType?: DamageType;
  /** The Wishweaver thread it belongs to. */
  thread?: Thread;
  /** A finisher spends the Calling's gauge (build plan step 6). */
  finisher?: boolean;
}

/** Effects that hurt creatures with the ability's amount. */
export const DAMAGE_EFFECTS: readonly AbilityEffect[] = ['strike', 'bolt', 'area', 'cone', 'line', 'dash', 'trap', 'summon'];

/** Blows of the weapon add its damage to the amount, and are physical unless the skill says. */
export const WEAPON_EFFECTS: readonly AbilityEffect[] = ['strike', 'dash', 'cone'];

/** Whether an ability's hits are physical (Armor softens them) or arcane (Ward does). */
export function abilityDamageType(a: Pick<AbilityDef, 'effect' | 'damageType'>): DamageType {
  return a.damageType ?? (WEAPON_EFFECTS.includes(a.effect) || a.effect === 'trap' ? 'physical' : 'arcane');
}
