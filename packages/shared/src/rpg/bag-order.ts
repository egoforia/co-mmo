// Arranging the bag (inventory refactor, step 4): moving a stack to another
// cell, merging two stacks of one thing, splitting a stack, and sorting.
// The server runs these on a `bag` message and the client only asks, so a
// player's bag order is the server's and is saved with the character.
// Re-exported from rpg.ts.

import { ITEMS, MAX_STACK, RARITIES, type Character, type InventorySlot, type ItemDef } from '../rpg.ts';
import { BAG_FULL, BAG_SLOTS, GOLD, putItem } from './bag.ts';

/** What a player reads when a split would leave nothing on one side. */
export const SPLIT_HOW = 'Choose how many to take off, fewer than the stack holds.';
/** Coins share one slot (egoforia, 2026-11-18). */
export const COINS_ONE_SLOT = 'Coins stay together in one slot.';

/** True when `i` names a stack in the bag. */
function isStack(c: Pick<Character, 'inventory'>, i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < c.inventory.length;
}

/**
 * Moves the stack in cell `from` to cell `to`. Onto a stack of the same
 * thing it merges as much as fits there; onto another stack the two swap;
 * onto an empty cell (past the last stack) it goes last. Returns why not, or
 * undefined when done.
 */
export function moveSlot(c: Pick<Character, 'inventory'>, from: number, to: number): string | undefined {
  if (!isStack(c, from) || !Number.isInteger(to) || to < 0 || to >= BAG_SLOTS || from === to) return 'Nothing to move there.';
  const moving = c.inventory[from]!;
  const onto = c.inventory[to];
  if (!onto) {
    c.inventory.splice(from, 1);
    c.inventory.push(moving);
    return undefined;
  }
  if (onto.item === moving.item && moving.item !== GOLD) {
    const n = Math.min(moving.qty, MAX_STACK - onto.qty);
    if (n <= 0) return 'That stack is already full.';
    onto.qty += n;
    moving.qty -= n;
    if (moving.qty === 0) c.inventory.splice(from, 1);
    return undefined;
  }
  c.inventory[from] = onto;
  c.inventory[to] = moving;
  return undefined;
}

/**
 * Takes `qty` off the stack in cell `index` into a new stack just after it.
 * Needs a free slot: a full bag cannot split, which is harsh and honest.
 */
export function splitStack(c: Pick<Character, 'inventory'>, index: number, qty: number): string | undefined {
  if (!isStack(c, index)) return 'Nothing to split there.';
  const slot = c.inventory[index]!;
  if (slot.item === GOLD) return COINS_ONE_SLOT;
  if (!Number.isInteger(qty) || qty < 1 || qty >= slot.qty) return SPLIT_HOW;
  if (c.inventory.length >= BAG_SLOTS) return BAG_FULL;
  slot.qty -= qty;
  c.inventory.splice(index + 1, 0, { item: slot.item, qty });
  return undefined;
}

/** Where a kind of thing goes when the bag is sorted: coins and books first, materials last. */
const KIND_ORDER: ItemDef['kind'][] = ['coins', 'book', 'equipment', 'consumable', 'scroll', 'tool', 'material'];

/** Sort key parts for one stack. */
function rank(slot: InventorySlot): [number, number, string] {
  const def = ITEMS[slot.item];
  const kind = slot.item === GOLD ? 0 : def ? KIND_ORDER.indexOf(def.kind) : -1;
  // Better things first within a kind (RARITIES runs common to legendary).
  return [kind < 0 ? KIND_ORDER.length : kind, -RARITIES.indexOf(def?.rarity ?? 'common'), def?.name ?? slot.item];
}

/**
 * Sorts the bag by kind, then rarity, then name, merging stacks of the same
 * thing first, so a sorted bag never takes more slots than before.
 */
export function sortBag(c: Character): void {
  const totals = new Map<string, number>();
  for (const s of c.inventory) totals.set(s.item, (totals.get(s.item) ?? 0) + s.qty);
  c.inventory = [];
  for (const [item, qty] of totals) putItem(c, item, qty);
  c.inventory.sort((a, b) => {
    const [ka, ra, na] = rank(a);
    const [kb, rb, nb] = rank(b);
    return ka - kb || ra - rb || na.localeCompare(nb) || b.qty - a.qty;
  });
}

