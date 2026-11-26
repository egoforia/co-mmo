import { BAG_FULL, STASH_BOUND, STASH_FULL, putItem, stashRoom, stashable, type InventorySlot, addGold, addItem, ownPieces, applySkillLook, fitsAll, takeGold, changeCalling, discover, forgetVanished, gainCreatorXp, gainXp, itemCount, maxHp, takeItem, type CallingId, type Character, type RaceId } from '@co-mmo/shared';

/**
 * A change to a player's character made from outside the simulation: Favor
 * spent or refunded on a wish, a scripted rule's gift, Creator XP. Changes
 * are plain data rather than functions, so they can be sent to the region
 * server where the player is.
 */
export type CharacterOp =
  | { op: 'favor'; amount: number }
  | { op: 'give'; item: string; qty: number; discover?: boolean }
  /** Fails, changing nothing, when the player has fewer. */
  | { op: 'take'; item: string; qty: number }
  | { op: 'heal'; amount: number }
  /** Never below 1 health: a rule hurts, it does not kill. */
  | { op: 'hurt'; amount: number }
  /** Fails, changing nothing, when it would leave less than no gold. */
  | { op: 'gold'; amount: number }
  /** XP; the region adds its level-up messages. */
  | { op: 'xp'; amount: number }
  | { op: 'creatorXp'; amount: number }
  /** A new people and/or Calling, by wish; fails, changing nothing, when it changes nothing. */
  | { op: 'calling'; race?: RaceId; calling?: CallingId }
  /** A Calling Wish: a skill's new name and look; fails, changing nothing, when no Calling Wish is left. */
  | { op: 'skillLook'; skill: string; name: string; description: string; wish: string }
  /** Drops items and abilities whose wish was rolled back. */
  | { op: 'forget' }
  /**
   * The shared stash (stash.ts): only by a stash chest, so the region checks
   * where the player stands first. `stashNear` asks just that. `stashIn`
   * takes `qty` (or all) off bag cell `index` when the account's `stash`, as
   * it is now with `slots` slots, has room, and answers what it took;
   * `stashOut` puts things in the bag, all or nothing.
   */
  | { op: 'stashNear' }
  | { op: 'stashIn'; index: number; qty?: number; stash: InventorySlot[]; slots: number }
  | { op: 'stashOut'; item: string; qty: number };

/** How a change went; `levels` are levels gained (Creator levels for Creator XP). */
export interface OpResult {
  ok: boolean;
  levels?: number;
  /** What a stash change took from the bag. */
  taken?: InventorySlot;
  /** Why it was refused, in words for the player. */
  why?: string;
}

/** Applies a change to a character in place. */
export function applyOp(c: Character, op: CharacterOp): OpResult {
  switch (op.op) {
    case 'favor':
      c.favor += op.amount;
      return { ok: true };
    case 'give':
      // All or nothing: a full bag takes none of it. Gear comes as pieces of its own.
      const pieces = ownPieces([{ item: op.item, qty: op.qty }]);
      if (!fitsAll(c, pieces)) return { ok: false };
      for (const s of pieces) addItem(c, s.item, s.qty);
      if (op.discover) discover(c, op.item);
      return { ok: true };
    case 'take':
      if (itemCount(c, op.item) < op.qty) return { ok: false };
      takeItem(c, op.item, op.qty);
      return { ok: true };
    case 'heal':
      c.hp = Math.min(maxHp(c), c.hp + op.amount);
      return { ok: true };
    case 'hurt':
      c.hp = Math.max(1, c.hp - op.amount);
      return { ok: true };
    case 'gold':
      // Gold is coins in the bag: paying needs enough, being paid needs room.
      return { ok: op.amount < 0 ? takeGold(c, -op.amount) : addGold(c, op.amount) };
    case 'xp':
      return { ok: true, levels: gainXp(c, op.amount) };
    case 'creatorXp':
      return { ok: true, levels: gainCreatorXp(c, op.amount) };
    case 'calling':
      return { ok: !changeCalling(c, op.race, op.calling) };
    case 'skillLook':
      return { ok: applySkillLook(c, op, op.wish) };
    case 'forget':
      forgetVanished(c);
      return { ok: true };
    case 'stashNear':
      return { ok: true };
    case 'stashIn': {
      const cell = c.inventory[op.index];
      if (!cell) return { ok: false, why: 'Nothing to put away there.' };
      if (!stashable(cell.item)) return { ok: false, why: STASH_BOUND };
      const qty = Math.min(op.qty ?? cell.qty, cell.qty);
      if (stashRoom(op.stash, cell.item, op.slots) < qty) return { ok: false, why: STASH_FULL };
      const taken = { item: cell.item, qty };
      cell.qty -= qty;
      if (cell.qty === 0) c.inventory.splice(op.index, 1);
      return { ok: true, taken };
    }
    case 'stashOut':
      if (!fitsAll(c, [{ item: op.item, qty: op.qty }])) return { ok: false, why: BAG_FULL };
      putItem(c, op.item, op.qty);
      return { ok: true };
  }
}
