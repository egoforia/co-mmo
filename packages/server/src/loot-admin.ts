import { CREATURES, ITEMS, lootTable, type LootWish } from '@co-mmo/shared';
import type { ContentRecord, Store } from './store.ts';

/** Where a line of loot came from, as the Loot tab says it. */
export interface LootSource {
  kind: 'built-in' | 'creature-wish' | 'wish' | 'gods-view';
  /** Who wished it, or who changed it in God's View. */
  by?: string;
  at?: number;
  /** The content entry, so its change can be undone. */
  entry?: string;
}

/** One creature on the Loot tab: what it drops now and every change that made it so. */
export interface CreatureLoot {
  id: string;
  name: string;
  /** Where its picture is served. */
  picture?: string;
  level: number;
  /** The creature's own wish, for wished creatures. */
  wished?: { by: string; at: number; entry: string };
  lines: { item: string; name: string; chance: number; qty: number; source: LootSource }[];
  /** Loot wishes and God's View changes, newest first, including undone ones. */
  changes: { id: string; at: number; by: string; godsView: boolean; status: string; mode: 'add' | 'set'; summary: string }[];
}

/**
 * The Loot tab (God's View): every creature in the world with its loot and
 * where each line came from, plus the items that can go on it.
 */
export function lootOverview(store: Store): { creatures: CreatureLoot[]; items: { id: string; name: string; bound: boolean }[] } {
  const byId = new Map(store.content.map((r) => [r.id, r]));
  const creatures = Object.entries(CREATURES).map(([id, def]): CreatureLoot => {
    const own = creatureWish(store.content, id);
    const changes = store.content.filter((r): r is ContentRecord & { definition: LootWish } => r.definition?.kind === 'loot' && r.definition.creature === id);
    return {
      id,
      name: def.name,
      ...(picture(own, id, def.art) ? { picture: picture(own, id, def.art) } : {}),
      level: def.level,
      ...(own ? { wished: { by: own.wisher.name, at: own.at, entry: own.id } } : {}),
      lines: lootTable(id).map((l) => {
        const from = l.from ? byId.get(l.from) : undefined;
        const source: LootSource = from
          ? { kind: from.godsView ? 'gods-view' : 'wish', by: from.wisher.name, at: from.at, entry: from.id }
          : own ? { kind: 'creature-wish', by: own.wisher.name, at: own.at, entry: own.id } : { kind: 'built-in' };
        return { item: l.item, name: ITEMS[l.item]!.name, chance: l.chance, qty: l.qty ?? 1, source };
      }),
      changes: changes.reverse().map((r) => ({
        id: r.id, at: r.at, by: r.wisher.name, godsView: !!r.godsView, status: r.status, mode: r.definition.mode, summary: r.summary,
      })),
    };
  });
  creatures.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const items = Object.entries(ITEMS).map(([id, i]) => ({ id, name: i.name, bound: !!i.bound })).sort((a, b) => a.name.localeCompare(b.name));
  return { creatures, items };
}

/** A creature's picture: built-in art, or its wish's painting once there is one. */
function picture(own: ContentRecord | undefined, id: string, art: string): string | undefined {
  if (!own) return `/art/${art}.png`;
  return own.id === id ? own.art : own.itemArt?.[id];
}

/** The granted wish that brought a creature: its own wish, or the region it lives in. */
function creatureWish(content: readonly ContentRecord[], id: string): ContentRecord | undefined {
  return content.find((r) => r.status === 'granted' && (r.id === id || (r.definition?.kind === 'region' && id.startsWith(`${r.id}-c`))));
}
