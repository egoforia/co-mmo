// The bag (combat decisions, step 1): a bag holds BAG_SLOTS stacks, and gold
// is coins carried in it, not a number on the character. Coins share one
// slot however many there are; other things stack up to MAX_STACK a slot.
// Re-exported from rpg.ts.

import { MAX_STACK, discover, itemCount, type Character } from '../rpg.ts';

/** How many stacks a bag holds. The Bible takes one, like anything else carried. */
export const BAG_SLOTS = 20;

/** The item id of gold coins. */
export const GOLD = 'gold';

/** What a player reads when nothing more fits. */
export const BAG_FULL = 'Your bag is full.';

/** Gold coins carried. */
export function goldOf(c: Pick<Character, 'inventory'>): number {
  return c.inventory.find((s) => s.item === GOLD)?.qty ?? 0;
}

/** How much of an item one stack may hold. */
function stackLimit(item: string): number {
  return item === GOLD ? Number.MAX_SAFE_INTEGER : MAX_STACK;
}

/** How many of `item` the bag can still take: room on its stack, or a free slot for a new one. */
export function bagRoom(c: Pick<Character, 'inventory'>, item: string): number {
  const slot = c.inventory.find((s) => s.item === item);
  if (slot) return Math.max(0, stackLimit(item) - slot.qty);
  return c.inventory.length < BAG_SLOTS ? stackLimit(item) : 0;
}

/** True when all of `items` would fit at once, each on its own stack or a free slot. */
export function fitsAll(c: Pick<Character, 'inventory'>, items: { item: string; qty: number }[]): boolean {
  const added = new Map<string, number>();
  for (const s of items) added.set(s.item, (added.get(s.item) ?? 0) + s.qty);
  let newSlots = 0;
  for (const [item, qty] of added) {
    const slot = c.inventory.find((s) => s.item === item);
    if (slot) {
      if (slot.qty + qty > stackLimit(item)) return false;
    } else {
      if (qty > stackLimit(item)) return false;
      newSlots++;
    }
  }
  return c.inventory.length + newSlots <= BAG_SLOTS;
}

/**
 * Puts up to `qty` of an item in the bag, as much as fits. Returns how many
 * went in; what does not fit is left to the caller (it stays on a body, in
 * a shop, or the action is refused).
 */
export function addItem(c: Character, item: string, qty = 1): number {
  const n = Math.min(qty, bagRoom(c, item));
  if (n <= 0) return 0;
  putItem(c, item, n);
  return n;
}

/**
 * Puts items in the bag even past its slots. Only for things that were
 * already the player's and must not vanish: worn gear coming off when a
 * wish is switched off, or an older save that held more than a bag does now.
 */
export function putItem(c: Character, item: string, qty = 1): void {
  const slot = c.inventory.find((s) => s.item === item);
  if (slot) slot.qty = Math.min(stackLimit(item), slot.qty + qty);
  else c.inventory.push({ item, qty: Math.min(stackLimit(item), qty) });
  discover(c, item);
}

/** Adds gold coins; false (and nothing added) when the bag has no slot for them. */
export function addGold(c: Character, amount: number): boolean {
  if (amount <= 0) return true;
  if (bagRoom(c, GOLD) < amount) return false;
  putItem(c, GOLD, amount);
  return true;
}

/** Takes gold coins; false (and nothing taken) when there are not enough. */
export function takeGold(c: Character, amount: number): boolean {
  if (amount <= 0) return true;
  const slot = c.inventory.find((s) => s.item === GOLD);
  if (!slot || slot.qty < amount) return false;
  slot.qty -= amount;
  if (slot.qty === 0) c.inventory.splice(c.inventory.indexOf(slot), 1);
  return true;
}

/** Gold a saved character held as a number before coins: moved into the bag as coins, even past its slots. */
export function coinsFromSavedGold(c: Character, saved: unknown): void {
  const gold = Math.floor(Number((saved as { gold?: unknown } | undefined)?.gold) || 0);
  if (gold > 0 && itemCount(c, GOLD) === 0) putItem(c, GOLD, gold);
}


/** The bag as it would be once `items` are taken out of it, for checking room before anything changes. */
export function bagWithout(c: Pick<Character, 'inventory'>, items: { item: string; qty: number }[]): Pick<Character, 'inventory'> {
  const inventory = c.inventory
    .map((s) => ({ ...s, qty: s.qty - items.filter((i) => i.item === s.item).reduce((n, i) => n + i.qty, 0) }))
    .filter((s) => s.qty > 0);
  return { inventory };
}

/** Sets the coins carried to exactly `amount`, even past the bag's slots (God's View and tests). */
export function setGold(c: Character, amount: number): void {
  takeGold(c, goldOf(c));
  if (amount > 0) putItem(c, GOLD, amount);
}
