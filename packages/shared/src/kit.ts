// The Adventurer's kit (milestone 8): crafting recipes, NPC shops and
// trainers, trading between players, and Creator XP. Server and client both
// use these rules, so a shop window shows the same prices the server charges.

import {
  ABILITIES,
  ITEMS,
  MAX_STACK,
  addItem,
  itemCount,
  learnAbility,
  takeItem,
  totalStats,
  type Character,
  type InventorySlot,
} from './rpg.ts';

// --- Crafting ------------------------------------------------------------------

/** Recipes combine materials into something new (design doc, Crafting). */
export interface RecipeDef {
  /** Wished recipes have their own name; others are called by what they make. */
  name?: string;
  materials: InventorySlot[];
  result: InventorySlot;
  /** Wit needed to make it. */
  wit: number;
}

/** Recipes everyone knows; wishes add more, keyed by the wish's id. */
export const RECIPES: Record<string, RecipeDef> = {
  tonic: { materials: [{ item: 'mushroom-cap', qty: 2 }], result: { item: 'tonic', qty: 1 }, wit: 0 },
  'mushroom-hat': { materials: [{ item: 'mushroom-cap', qty: 4 }], result: { item: 'mushroom-hat', qty: 1 }, wit: 3 },
  'crab-lance': { materials: [{ item: 'crab-shell', qty: 3 }, { item: 'goat-horn', qty: 1 }], result: { item: 'crab-lance', qty: 1 }, wit: 5 },
  'shell-mail': { materials: [{ item: 'crab-shell', qty: 5 }], result: { item: 'shell-mail', qty: 1 }, wit: 5 },
  'scarab-charm': { materials: [{ item: 'scarab-shell', qty: 3 }, { item: 'goat-horn', qty: 1 }], result: { item: 'scarab-charm', qty: 1 }, wit: 7 },
};

/** Why this character cannot craft a recipe now, or undefined when they can. */
export function cannotCraft(c: Character, id: string): string | undefined {
  const r = RECIPES[id];
  if (!r || !ITEMS[r.result.item] || r.materials.some((m) => !ITEMS[m.item])) return 'Nobody knows that recipe any more.';
  const wit = totalStats(c).wit;
  if (wit < r.wit) return `You need ${r.wit} Wit to make that; you have ${wit}.`;
  const missing = r.materials.filter((m) => itemCount(c, m.item) < m.qty).map((m) => ITEMS[m.item]!.name);
  if (missing.length) return `You need more ${missing.join(' and ')}.`;
  if (itemCount(c, r.result.item) + r.result.qty > MAX_STACK) return 'Your bag cannot hold any more of those.';
  return undefined;
}

/** A recipe's name as players see it. */
export function recipeName(id: string): string {
  const r = RECIPES[id];
  return r?.name ?? ITEMS[r?.result.item ?? '']?.name ?? id;
}

/** Makes a recipe: takes the materials and adds the result. Returns why not. */
export function craft(c: Character, id: string): string | undefined {
  const why = cannotCraft(c, id);
  if (why) return why;
  const r = RECIPES[id]!;
  for (const m of r.materials) takeItem(c, m.item, m.qty);
  addItem(c, r.result.item, r.result.qty);
  return undefined;
}

// --- Shops and trainers ----------------------------------------------------------

/** What an NPC sells, and the abilities they teach, with prices in gold. */
export interface ShopDef {
  sells: { item: string; price: number }[];
  teaches: { ability: string; price: number }[];
  /** They buy what players bring, at half its value. */
  buys: boolean;
}

/** NPC shops and trainers (design doc, Gold: spent at NPC shops). */
export const SHOPS: Record<string, ShopDef> = {
  marina: {
    sells: [{ item: 'tonic', price: 8 }, { item: 'wooden-sword', price: 15 }, { item: 'traveller-coat', price: 20 }],
    teaches: [],
    buys: true,
  },
  'cactus-elder': {
    sells: [{ item: 'scroll-firebolt', price: 40 }, { item: 'tonic', price: 10 }],
    teaches: [],
    buys: true,
  },
  'sister-amala': {
    sells: [],
    teaches: [{ ability: 'mend', price: 15 }],
    buys: false,
  },
};

/** Gold a shop pays for one of an item; 0 when it cannot be sold. */
export function sellPrice(item: string): number {
  const def = ITEMS[item];
  if (!def || def.bound) return 0;
  return Math.max(1, Math.floor((def.value ?? 2) / 2));
}

/** Buys one item from a shop. Returns why not. */
export function buy(c: Character, npc: string, item: string): string | undefined {
  const offer = SHOPS[npc]?.sells.find((s) => s.item === item);
  if (!offer || !ITEMS[item]) return 'That is not for sale here.';
  if (c.gold < offer.price) return `That costs ${offer.price} gold; you have ${c.gold}.`;
  if (itemCount(c, item) >= MAX_STACK) return 'Your bag cannot hold any more of those.';
  c.gold -= offer.price;
  addItem(c, item);
  return undefined;
}

/** Sells items to a shop that buys. Returns why not. */
export function sell(c: Character, npc: string, item: string, qty = 1): string | undefined {
  if (!SHOPS[npc]?.buys) return 'They do not buy things.';
  const price = sellPrice(item);
  if (!price) return 'That cannot be sold.';
  if (!Number.isInteger(qty) || qty < 1 || itemCount(c, item) < qty) return 'You do not have that many.';
  takeItem(c, item, qty);
  c.gold += price * qty;
  return undefined;
}

/** Pays a trainer to learn an ability. Returns why not. */
export function train(c: Character, npc: string, ability: string): string | undefined {
  const offer = SHOPS[npc]?.teaches.find((t) => t.ability === ability);
  if (!offer || !ABILITIES[ability]) return 'They cannot teach you that.';
  if (c.abilities.includes(ability)) return 'You know that already.';
  if (c.gold < offer.price) return `Lessons cost ${offer.price} gold; you have ${c.gold}.`;
  c.gold -= offer.price;
  learnAbility(c, ability);
  return undefined;
}

/** Reads a scroll: learns its ability and uses the scroll up. Returns why not. */
export function readScroll(c: Character, item: string): string | undefined {
  const ability = ITEMS[item]?.teaches;
  if (!ability || !ABILITIES[ability]) return 'The words have faded; nothing can be learned from it.';
  if (c.abilities.includes(ability)) return `You know ${ABILITIES[ability]!.name} already. Sell the scroll, or give it to a friend.`;
  if (!takeItem(c, item)) return 'That is not in your bag.';
  learnAbility(c, ability);
  return undefined;
}

// --- Trading between players -------------------------------------------------------

/** What one side puts on the table. */
export interface TradeOffer {
  items: InventorySlot[];
  gold: number;
}

export const MAX_TRADE_SLOTS = 8;

/** A clean copy of an offer: whole numbers, no repeats, things that can change hands. */
export function cleanOffer(raw: unknown): TradeOffer {
  const o = (raw ?? {}) as { items?: unknown; gold?: unknown };
  const items: InventorySlot[] = [];
  for (const s of Array.isArray(o.items) ? o.items : []) {
    const item = typeof s?.item === 'string' ? s.item : '';
    const qty = Math.floor(Number(s?.qty));
    if (!ITEMS[item] || ITEMS[item]!.bound || !(qty > 0) || items.some((i) => i.item === item)) continue;
    items.push({ item, qty: Math.min(qty, MAX_STACK) });
    if (items.length >= MAX_TRADE_SLOTS) break;
  }
  const gold = Math.max(0, Math.floor(Number(o.gold) || 0));
  return { items, gold };
}

/** True when the character holds everything they offer. */
export function canGive(c: Character, offer: TradeOffer): boolean {
  return c.gold >= offer.gold && offer.items.every((s) => !ITEMS[s.item]?.bound && itemCount(c, s.item) >= s.qty);
}

/**
 * Swaps two offers between two characters, all or nothing. Returns why not;
 * nothing changes unless both still hold what they offered.
 */
export function swap(a: Character, b: Character, fromA: TradeOffer, fromB: TradeOffer): string | undefined {
  if (!canGive(a, fromA) || !canGive(b, fromB)) return 'Someone no longer has what they offered.';
  const give = (from: Character, to: Character, offer: TradeOffer) => {
    from.gold -= offer.gold;
    to.gold += offer.gold;
    for (const s of offer.items) {
      takeItem(from, s.item, s.qty);
      addItem(to, s.item, s.qty);
    }
  };
  give(a, b, fromA);
  give(b, a, fromB);
  return undefined;
}

// --- Creator XP --------------------------------------------------------------------

/** How someone else enjoyed a thing you wished for. */
export type CreatorCredit = 'defeat' | 'talk' | 'use' | 'craft' | 'learn' | 'equip' | 'visit';

/** Creator XP per kind of enjoyment (design doc, Characters and progression). */
export const CREATOR_XP: Record<CreatorCredit, number> = { defeat: 2, talk: 3, use: 2, craft: 3, learn: 5, equip: 3, visit: 4 };

/** Favor for each Creator level gained: making things people love pays for more wishes. */
export const CREATOR_LEVEL_FAVOR = 3;

/** The same player enjoying the same thing in the same way counts once per this many ms (defeats always count). */
export const CREATOR_REPEAT_MS = 10 * 60_000;

/** Creator XP needed to go from this Creator level to the next. */
export function creatorXpToNext(level: number): number {
  return 10 * level;
}

/** Adds Creator XP; each Creator level gained pays Favor. Returns levels gained. */
export function gainCreatorXp(c: Character, amount: number): number {
  c.creatorXp += amount;
  let levels = 0;
  while (c.creatorXp >= creatorXpToNext(c.creatorLevel)) {
    c.creatorXp -= creatorXpToNext(c.creatorLevel);
    c.creatorLevel++;
    levels++;
  }
  c.favor += levels * CREATOR_LEVEL_FAVOR;
  return levels;
}
