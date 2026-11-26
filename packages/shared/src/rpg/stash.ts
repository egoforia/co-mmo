// The shared stash (docs/stash.md): one chest of stacks for every character
// on an account, opened at a stash chest in a town's safe area. It keeps the
// bag's rules (99 a stack, coins in one slot however many) with more slots,
// set by the Owner. Bound things never go in. The server runs these; the
// browser shows the result. Re-exported from rpg.ts.

import { ITEMS, MAX_STACK, type InventorySlot } from '../rpg.ts';
import type { Landmark } from '../world.ts';
import { GOLD } from './bag.ts';

/** Slots a stash holds unless the Owner sets another number (egoforia, 2026-11-26). */
export const STASH_SLOTS = 40;
/** The most slots the Owner may give a stash. */
export const MOST_STASH_SLOTS = 200;
/** The picture and landmark of a stash chest. */
export const STASH_CHEST = 'stash-chest';
/** How near a stash chest a player must stand to open it, in tiles from its middle. */
export const STASH_REACH = 2.5;

/** What a player reads when the stash has no room. */
export const STASH_FULL = 'The stash is full.';
/** What a player reads away from a stash chest. */
export const STASH_AWAY = 'Stand by a stash chest in a town to open your stash.';
/** What a player reads trying to stash a bound thing. */
export const STASH_BOUND = 'That is bound to you and cannot go in the stash.';

/** How much of an item one stack may hold. */
function stackLimit(item: string): number {
  return item === GOLD ? Number.MAX_SAFE_INTEGER : MAX_STACK;
}

/** True when an item may go in the stash: anything not bound. */
export function stashable(item: string): boolean {
  return !ITEMS[item]?.bound;
}

/** How many of `item` the stash can still take: room on its stacks, then free slots. */
export function stashRoom(stash: readonly InventorySlot[], item: string, slots: number): number {
  const onStacks = stash.filter((s) => s.item === item).reduce((n, s) => n + Math.max(0, stackLimit(item) - s.qty), 0);
  return onStacks + Math.max(0, slots - stash.length) * stackLimit(item);
}

/** Puts `qty` of an item in the stash (changed in place); false, changing nothing, when it does not all fit. */
export function putInStash(stash: InventorySlot[], item: string, qty: number, slots: number): boolean {
  if (qty <= 0 || stashRoom(stash, item, slots) < qty) return false;
  let left = qty;
  for (const s of stash) {
    if (s.item !== item) continue;
    const n = Math.min(left, stackLimit(item) - s.qty);
    s.qty += n;
    left -= n;
  }
  while (left > 0) {
    const n = Math.min(left, stackLimit(item));
    stash.push({ item, qty: n });
    left -= n;
  }
  return true;
}

/** Takes `qty` (or all) off the stack in cell `index`; what was taken, or undefined when there is nothing there. */
export function takeFromStash(stash: InventorySlot[], index: number, qty?: number): InventorySlot | undefined {
  const s = Number.isInteger(index) ? stash[index] : undefined;
  if (!s) return undefined;
  const n = qty === undefined ? s.qty : Math.min(qty, s.qty);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  s.qty -= n;
  if (s.qty === 0) stash.splice(index, 1);
  return { item: s.item, qty: n };
}

/** True when a stash chest stands within reach of a point on a floor. */
export function nearStashChest(landmarks: readonly Landmark[], x: number, y: number, floor = 0): boolean {
  // A landmark's x, y is the bottom middle of its footprint; its middle is half a footprint up.
  return landmarks.some((l) => l.asset === STASH_CHEST && (l.floor ?? 0) === floor &&
    Math.hypot(x - l.x, y - (l.y - l.footprint.height / 2)) <= STASH_REACH);
}
