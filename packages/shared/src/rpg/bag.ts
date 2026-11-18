// The bag (combat decisions, step 1): a bag holds BAG_SLOTS stacks, and gold
// is coins carried in it, not a number on the character. Coins share one
// slot however many there are; other things stack up to MAX_STACK a slot,
// and one thing may fill more than one slot (a split stack, or more than 99).
// Re-exported from rpg.ts.

import { MAX_STACK, discover, itemCount, type Character, type InventorySlot } from '../rpg.ts';

/** How many stacks a bag holds. The Bible takes one, like anything else carried. */
export const BAG_SLOTS = 20;

/** The item id of gold coins. */
export const GOLD = 'gold';

/** What a player reads when nothing more fits. */
export const BAG_FULL = 'Your bag is full.';

/** Gold coins carried. */
export function goldOf(c: Pick<Character, 'inventory'>): number {
  return itemCount(c, GOLD);
}

/** How much of an item one stack may hold. */
function stackLimit(item: string): number {
  return item === GOLD ? Number.MAX_SAFE_INTEGER : MAX_STACK;
}

/** The stacks of `item` in the bag, in bag order. A split stack is two of them. */
export function stacksOf(c: Pick<Character, 'inventory'>, item: string): InventorySlot[] {
  return c.inventory.filter((s) => s.item === item);
}

/** Room left on the stacks already holding `item`. */
function roomOnStacks(c: Pick<Character, 'inventory'>, item: string): number {
  return stacksOf(c, item).reduce((n, s) => n + Math.max(0, stackLimit(item) - s.qty), 0);
}

/** How many of `item` the bag can still take: room on its stacks, then free slots for new ones. */
export function bagRoom(c: Pick<Character, 'inventory'>, item: string): number {
  return roomOnStacks(c, item) + Math.max(0, BAG_SLOTS - c.inventory.length) * stackLimit(item);
}

/** True when all of `items` would fit at once: on their stacks first, then in free slots. */
export function fitsAll(c: Pick<Character, 'inventory'>, items: { item: string; qty: number }[]): boolean {
  const added = new Map<string, number>();
  for (const s of items) added.set(s.item, (added.get(s.item) ?? 0) + s.qty);
  let newSlots = 0;
  for (const [item, qty] of added) {
    const over = qty - roomOnStacks(c, item);
    if (over > 0) newSlots += Math.ceil(over / stackLimit(item));
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
  let left = qty;
  for (const slot of stacksOf(c, item)) {
    const n = Math.min(left, stackLimit(item) - slot.qty);
    if (n > 0) {
      slot.qty += n;
      left -= n;
    }
  }
  while (left > 0) {
    const n = Math.min(left, stackLimit(item));
    c.inventory.push({ item, qty: n });
    left -= n;
  }
  discover(c, item);
}

/**
 * Takes `qty` of an item out of its stacks, the last stack first so the
 * first keeps its place; false (and no change) when there are not enough.
 * No check for bound things: equip() moves those, takeItem() refuses them.
 */
export function removeFromStacks(c: Pick<Character, 'inventory'>, item: string, qty: number): boolean {
  const stacks = stacksOf(c, item);
  if (stacks.reduce((n, s) => n + s.qty, 0) < qty) return false;
  let left = qty;
  for (const slot of stacks.reverse()) {
    const n = Math.min(left, slot.qty);
    slot.qty -= n;
    left -= n;
    if (slot.qty === 0) c.inventory.splice(c.inventory.indexOf(slot), 1);
    if (left === 0) break;
  }
  return true;
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
  return removeFromStacks(c, GOLD, amount);
}

/** Gold a saved character held as a number before coins: moved into the bag as coins, even past its slots. */
export function coinsFromSavedGold(c: Character, saved: unknown): void {
  const gold = Math.floor(Number((saved as { gold?: unknown } | undefined)?.gold) || 0);
  if (gold > 0 && itemCount(c, GOLD) === 0) putItem(c, GOLD, gold);
}

/** The bag as it would be once `items` are taken out of it, for checking room before anything changes. */
export function bagWithout(c: Pick<Character, 'inventory'>, items: { item: string; qty: number }[]): Pick<Character, 'inventory'> {
  const bag = { inventory: c.inventory.map((s) => ({ ...s })) };
  for (const i of items) if (!removeFromStacks(bag, i.item, i.qty)) for (const s of stacksOf(bag, i.item)) s.qty = 0;
  bag.inventory = bag.inventory.filter((s) => s.qty > 0);
  return bag;
}

/** Sets the coins carried to exactly `amount`, even past the bag's slots (God's View and tests). */
export function setGold(c: Character, amount: number): void {
  takeGold(c, goldOf(c));
  if (amount > 0) putItem(c, GOLD, amount);
}
