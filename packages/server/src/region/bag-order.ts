import { ITEM_USE_MS, moveSlot, sortBag, splitStack, type BagMessage } from '@co-mmo/shared';
import type { PlayerState, RegionState } from './state.ts';

// Arranging a player's bag (inventory refactor, steps 4 and 6): the client
// asks to move, merge, split, sort or drop; the rules in shared/rpg/bag-order.ts decide.
// The new order is part of the character, so it is saved with it.

/** Handles `bag` messages for a region. */
export class BagOrder {
  /** `drop` lays things from the bag on the ground as a pile (region/bodies.ts). */
  constructor(private readonly s: RegionState, private readonly drop: (p: PlayerState, index: number, qty?: number) => void) {}

  /** Moves, merges, splits or sorts; tells the player why when it can't. */
  handle(p: PlayerState, m: BagMessage): void {
    // Sorting is a whole-bag change: no more often than items are used.
    const now = Date.now();
    if (m.action === 'sort') {
      if (p.lastSort !== undefined && now - p.lastSort < ITEM_USE_MS) return;
      p.lastSort = now;
      sortBag(p.character);
      p.dirty = true;
      return;
    }
    if (m.action === 'drop') return this.drop(p, m.from ?? -1, m.qty);
    const why = m.action === 'move'
      ? moveSlot(p.character, m.from ?? -1, m.to ?? -1)
      : splitStack(p.character, m.from ?? -1, m.qty ?? 0);
    if (why) return this.s.notice(p, why);
    p.dirty = true;
  }
}
