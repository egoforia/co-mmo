// What defeated creatures leave on their bodies. A creature's own drop list
// is where its loot starts; wishes add to it and God's View sets it outright.
// Every change is a content entry, so it is saved, shared with every region
// server and can be rolled back like any wish: the table a creature rolls is
// worked out again from the changes that still stand.

import { CREATURES, ITEMS, type Drop } from './rpg.ts';

/** One thing a creature may drop, and the change it came from (none: the creature's own list). */
export interface LootLine extends Drop {
  /** The content entry that put it there. */
  from?: string;
}

/** A change to a creature's loot: a wish adds to it, God's View sets the whole list. */
export interface LootChange {
  /** The content entry it is. */
  id: string;
  at: number;
  creature: string;
  mode: 'add' | 'set';
  drops: Drop[];
}

/** Changes that stand, by content entry id. */
const CHANGES = new Map<string, LootChange>();

/** Notes a granted loot change, replacing an earlier copy of the same entry. */
export function applyLoot(change: LootChange): void {
  CHANGES.set(change.id, change);
}

/** Forgets a loot change that was rolled back. */
export function removeLoot(id: string): void {
  CHANGES.delete(id);
}

/** The loot changes that stand for one creature, oldest first. */
export function lootChanges(creature: string): LootChange[] {
  return [...CHANGES.values()].filter((c) => c.creature === creature).sort((a, b) => a.at - b.at);
}

/**
 * What a creature may drop now: its own list, then every standing change in
 * order. A wish adds its things (replacing the same item's line); God's View
 * replaces the list. Items that no longer exist are left out.
 */
export function lootTable(creature: string): LootLine[] {
  let lines: LootLine[] = (CREATURES[creature]?.drops ?? []).map((d) => ({ ...d }));
  for (const change of lootChanges(creature)) {
    const added = change.drops.map((d) => ({ ...d, from: change.id }));
    if (change.mode === 'set') lines = added;
    else lines = [...lines.filter((l) => !added.some((a) => a.item === l.item)), ...added];
  }
  return lines.filter((l) => ITEMS[l.item]);
}

/** A drop chance as players read it: "always", or a percentage. */
export function chanceText(chance: number): string {
  return chance >= 1 ? 'always' : `${Math.max(1, Math.round(chance * 100))}%`;
}
