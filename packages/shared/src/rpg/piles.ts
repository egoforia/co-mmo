// Things dropped on the ground (inventory refactor, step 6; egoforia,
// 2026-11-18): they lie as a pile anyone may take, like a body's loot, for
// ten minutes, and then they are gone. Safe areas are no different.
// Re-exported from rpg.ts.

import { ITEMS, type InventorySlot } from '../rpg.ts';

/** The body kind a pile of dropped things has, so the client draws it as one. */
export const PILE_KIND = 'pile';

/** How long a pile lies before it is gone, in ms. */
export const PILE_MS = 10 * 60 * 1000;

/** How close a drop must be to an earlier pile to join it, in tiles. */
export const PILE_JOIN = 0.75;

/** How many stacks one pile holds before a new pile starts beside it. */
export const PILE_STACKS = 20;

/** A pile's name: the thing's own name while it holds one kind of thing. */
export function pileName(loot: readonly InventorySlot[]): string {
  const kinds = new Set(loot.map((s) => s.item));
  if (kinds.size !== 1) return 'Pile of things';
  const name = ITEMS[loot[0]!.item]?.name ?? 'something';
  return `Dropped ${name}`;
}
