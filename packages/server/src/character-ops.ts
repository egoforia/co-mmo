import { addItem, changeCalling, discover, forgetVanished, gainCreatorXp, gainXp, itemCount, maxHp, takeItem, type CallingId, type Character, type RaceId } from '@co-mmo/shared';

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
  /** Drops items and abilities whose wish was rolled back. */
  | { op: 'forget' };

/** How a change went; `levels` are levels gained (Creator levels for Creator XP). */
export interface OpResult {
  ok: boolean;
  levels?: number;
}

/** Applies a change to a character in place. */
export function applyOp(c: Character, op: CharacterOp): OpResult {
  switch (op.op) {
    case 'favor':
      c.favor += op.amount;
      return { ok: true };
    case 'give':
      addItem(c, op.item, op.qty);
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
      if (c.gold + op.amount < 0) return { ok: false };
      c.gold += op.amount;
      return { ok: true };
    case 'xp':
      return { ok: true, levels: gainXp(c, op.amount) };
    case 'creatorXp':
      return { ok: true, levels: gainCreatorXp(c, op.amount) };
    case 'calling':
      return { ok: !changeCalling(c, op.race, op.calling) };
    case 'forget':
      forgetVanished(c);
      return { ok: true };
  }
}
