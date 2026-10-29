// The numbers a wished ability gets. The God picks only the effect from the
// kit (rpg/abilities.ts) and, for some, one status; the world sets every
// number, a little below the hand-made skills (docs/classes.md, Wishes and
// Callings).

import { ABILITY_EFFECTS, DAMAGE_EFFECTS, type AbilityDef, type AbilityEffect } from './rpg/abilities.ts';
import { SKILL_STATUSES, STATUSES, type StatusId } from './rpg/statuses.ts';

type Numbers = Omit<AbilityDef, 'name' | 'description' | 'effect' | 'status'>;

/** World-set numbers for each effect a wish may choose. */
export const WISHED_ABILITY_NUMBERS: Record<AbilityEffect, Numbers> = {
  strike: { energy: 8, cooldown: 6, range: 1.8, base: 3, stat: 'might', factor: 1.3 },
  bolt: { energy: 6, cooldown: 3, range: 5, base: 2, stat: 'wit', factor: 1.3 },
  heal: { energy: 10, cooldown: 12, range: 0, base: 6, stat: 'spirit', factor: 2.5 },
  area: { energy: 10, cooldown: 8, range: 5, base: 2, stat: 'wit', factor: 0.8, radius: 2 },
  cone: { energy: 9, cooldown: 7, range: 3, base: 2, stat: 'might', factor: 0.8 },
  line: { energy: 9, cooldown: 7, range: 5, base: 2, stat: 'wit', factor: 0.9 },
  dash: { energy: 8, cooldown: 8, range: 5, base: 2, stat: 'agility', factor: 1 },
  blink: { energy: 8, cooldown: 12, range: 4, base: 0, stat: 'wit', factor: 0 },
  shield: { energy: 10, cooldown: 15, range: 0, base: 5, stat: 'spirit', factor: 1.5, duration: 6 },
  buff: { energy: 12, cooldown: 20, range: 0, base: 3, stat: 'spirit', factor: 1, radius: 4, duration: 6 },
  debuff: { energy: 6, cooldown: 12, range: 6, base: 0, stat: 'wit', factor: 0 },
  taunt: { energy: 6, cooldown: 10, range: 0, base: 0, stat: 'vigor', factor: 0, radius: 3 },
  trap: { energy: 8, cooldown: 15, range: 0, base: 2, stat: 'agility', factor: 0.5, radius: 0.8, duration: 30 },
  summon: { energy: 15, cooldown: 30, range: 0, base: 1, stat: 'spirit', factor: 0.4, radius: 5, duration: 20 },
  stance: { energy: 1, cooldown: 2, range: 0, base: 1, stat: 'vigor', factor: 0.5 },
  cleanse: { energy: 8, cooldown: 15, range: 0, base: 0, stat: 'spirit', factor: 0, radius: 4 },
};

/** The status an effect gives when the wish names none, or must give. */
const DEFAULT_STATUS: Partial<Record<AbilityEffect, StatusId>> = { debuff: 'marked', trap: 'rooted', buff: 'shielded', stance: 'shielded' };

/** Ailments a wished ability may put on what it hits: never Weakened (waking at the shrine does that) or Taunted (taunts do). */
export const WISHED_AILMENTS: readonly StatusId[] = (Object.keys(STATUSES) as StatusId[]).filter((s) => STATUSES[s].harmful && s !== 'weakened' && s !== 'taunted');

/** The status a wished ability may carry: an ailment on what it hits, a helpful one on you. */
export function wishedStatus(effect: AbilityEffect, raw: unknown): StatusId | undefined {
  const named = (Object.keys(STATUSES) as StatusId[]).find((s) => s === raw && s !== 'weakened' && s !== 'taunted' && !SKILL_STATUSES.includes(s));
  const helps = effect === 'buff' || effect === 'stance';
  const fits = named && (helps ? !STATUSES[named].harmful : STATUSES[named].harmful && (DAMAGE_EFFECTS.includes(effect) || effect === 'debuff'));
  return fits ? named : DEFAULT_STATUS[effect];
}

/** The kit's effect a wish named, or a strike. */
export function wishedEffect(raw: unknown): AbilityEffect {
  return ABILITY_EFFECTS.find((e) => e === raw) ?? 'strike';
}
