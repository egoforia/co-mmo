import { BIOMES, BUILDING_STYLES, ITEMS, type BiomeId, type ItemWish, type PicturedWish } from '@co-mmo/shared';

// Where each picture sits in the Art tab: characters and monsters by name,
// items by kind, scenery and buildings by the land they belong to, so the
// Owner finds a picture the way they think of it in the game.

/** The Art tab's own tabs, besides Painting now and Sounds and music. */
export type ArtTab = 'characters' | 'monsters' | 'items' | 'biomes';

/** Where a picture sits: a tab, a page within it, and a heading on that page. */
export interface ArtPlace {
  tab: ArtTab;
  /** The page: a character's or monster's name, a kind of item, or a land. */
  page: string;
  /** A heading on the page, such as "Scenery" or a building's name. */
  section?: string;
}

/** Kinds of item, in the order the Items tab shows them. */
export const ITEM_PAGES = ['Consumables', 'Weapons', 'Armour', 'Charms', 'Materials', 'Books and scrolls', 'Other'] as const;

/** A land's name as a page title: "Sanctum" rather than "the Sanctum". */
export function landName(biome: BiomeId | 'any'): string {
  if (biome === 'any') return 'Everywhere';
  const name = BIOMES[biome]?.name ?? biome;
  return name.replace(/^the /, '').replace(/^./, (c) => c.toUpperCase());
}

/** A shipped item picture's kind of item, by the items drawn with it. */
export function shippedItemPage(artId: string): (typeof ITEM_PAGES)[number] {
  const item = Object.values(ITEMS).find((i) => i.art === artId);
  if (!item) return 'Other';
  if (item.kind === 'consumable') return 'Consumables';
  if (item.kind === 'material') return 'Materials';
  if (item.kind === 'book' || item.kind === 'scroll') return 'Books and scrolls';
  return item.slot === 'weapon' ? 'Weapons' : item.slot === 'charm' ? 'Charms' : 'Armour';
}

/** A wished item's kind of item. */
export function wishedItemPage(kind: ItemWish['itemKind']): (typeof ITEM_PAGES)[number] {
  if (kind === 'consumable') return 'Consumables';
  if (kind === 'material') return 'Materials';
  if (kind === 'weapon') return 'Weapons';
  if (kind === 'head' || kind === 'body') return 'Armour';
  return 'Charms';
}

/** Where a shipped picture sits, by its kind (anchors and the biome kit). */
export function shippedPlace(asset: { id: string; name?: string; kind: string; biome: string }): ArtPlace {
  const name = asset.name ?? asset.id;
  if (asset.kind === 'player' || asset.kind === 'npc') return { tab: 'characters', page: name };
  if (asset.kind === 'monster') return { tab: 'monsters', page: name };
  if (asset.kind === 'item') return { tab: 'items', page: shippedItemPage(asset.id) };
  return { tab: 'biomes', page: landName(asset.biome as BiomeId), section: 'Scenery' };
}

/** Where a building's pictures sit: its land's page, under its own name. */
export function buildingPlace(styleId: string): ArtPlace {
  const style = Object.values(BUILDING_STYLES).find((s) => s.id === styleId)!;
  return { tab: 'biomes', page: landName(style.biome), section: style.name };
}

/** Where a wished thing's picture sits. */
export function wishedPlace(def: PicturedWish): ArtPlace {
  if (def.kind === 'player' || def.kind === 'npc') return { tab: 'characters', page: def.name };
  if (def.kind === 'creature') return { tab: 'monsters', page: def.name };
  if (def.kind === 'ability') return { tab: 'items', page: 'Books and scrolls' };
  return { tab: 'items', page: wishedItemPage(def.itemKind) };
}
