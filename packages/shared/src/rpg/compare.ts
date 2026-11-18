// Comparing a piece of gear with what it would replace (inventory refactor,
// step 2): the item card shows each bonus gained in green and lost in red.
// Shared so the card's numbers are the server's: the pieces that come off
// follow equip()'s rule for two-handed weapons and the off hand.

import { BONUS_NAMES, ITEMS, PERCENT_KEYS, type Bonus, type Character } from '../rpg.ts';
import { twoHanded } from '../weapons.ts';

/** One bonus that changes if a piece is worn: positive is gained, negative lost. */
export interface GearChange {
  key: keyof Bonus;
  delta: number;
}

/** The worn pieces that would come off if `item` were put on, as equip() takes them off. */
export function replacedBy(c: Pick<Character, 'equipment'>, item: string): string[] {
  const def = ITEMS[item];
  if (!def?.slot) return [];
  const freed = def.slot === 'weapon' && twoHanded(item) ? 'offhand' : def.slot === 'offhand' && twoHanded(c.equipment.weapon) ? 'weapon' : undefined;
  return [c.equipment[def.slot], freed && c.equipment[freed]].filter((id): id is string => !!id);
}

/**
 * What wearing `item` would change, bonus by bonus, against what it replaces;
 * empty when it changes nothing or cannot be worn. Sorted with gains first.
 */
export function compareGear(c: Pick<Character, 'equipment'>, item: string): GearChange[] {
  const def = ITEMS[item];
  if (!def?.slot) return [];
  const sum = new Map<keyof Bonus, number>();
  const add = (bonus: Bonus | undefined, sign: number) => {
    for (const [k, v] of Object.entries(bonus ?? {}) as [keyof Bonus, number | undefined][]) if (v) sum.set(k, (sum.get(k) ?? 0) + sign * v);
  };
  add(def.bonus, 1);
  for (const off of replacedBy(c, item)) add(ITEMS[off]?.bonus, -1);
  return [...sum].filter(([, d]) => d !== 0).map(([key, delta]) => ({ key, delta })).sort((a, b) => b.delta - a.delta);
}

/** A change in the card's words, e.g. "+4 damage" or "−1 ward". */
export function changeWords(ch: GearChange): string {
  const sign = ch.delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(ch.delta)}${PERCENT_KEYS.has(ch.key) ? '%' : ''} ${BONUS_NAMES[ch.key] ?? ch.key}`;
}
