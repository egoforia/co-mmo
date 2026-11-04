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
  replacedWords,
  takeItem,
  totalStats,
  STARTING_STATS,
  type Character,
  type InventorySlot,
  type Stats,
} from './rpg.ts';
import { NPC_PEOPLES, PREFERRED_MATERIAL_QUALITY, canLean, prefersMaterial } from './fashion.ts';
import { EVERYWHERE_REGION } from './material-traits.ts';
import { QUALITY_STANDARD, clampQuality, makesCopies, newCopy, type CopyInfo } from './copies.ts';
import {
  CRAFTS,
  HOME_CRAFT_QUALITY,
  UNMASTERED_QUALITY_MAX,
  bestTool,
  craftLevel,
  craftOfFamily,
  gainCraftXp,
  isHomeCraft,
  isMastered,
  toolOffers,
  wearTool,
  chooseMastery,
  type CraftId,
} from './crafts.ts';

// --- Crafting ------------------------------------------------------------------

/** Recipes combine materials into something new (design doc, Crafting). */
export interface RecipeDef {
  /** Wished recipes have their own name; others are called by what they make. */
  name?: string;
  materials: InventorySlot[];
  result: InventorySlot;
  /** The craft it belongs to; when missing, the main material's (recipeCraft). */
  craft?: CraftId;
  /** Craft level needed to make it, 1 to 20. */
  level: number;
  /** Its tier when not worked out from its materials (recipeTier). */
  tier?: RecipeTier;
}

/**
 * How rare a recipe is (the plan's recipe tiers): common uses one land's
 * materials (the Sanctum's count anywhere), rare mixes two or three lands,
 * and unique needs a boss's or a quest's key item and a master to make it.
 */
export type RecipeTier = 'common' | 'rare' | 'unique';
export const RECIPE_TIERS: readonly RecipeTier[] = ['common', 'rare', 'unique'];

/** A recipe's tier: its own, else worked out from where its materials come from. */
export function recipeTier(r: Pick<RecipeDef, 'materials' | 'tier'>): RecipeTier {
  if (r.tier) return r.tier;
  const infos = r.materials.map((m) => ITEMS[m.item]?.material);
  if (infos.some((m) => m?.tier === 3)) return 'unique';
  // The lands each material may count for; the Sanctum's count for any.
  const lands = infos.map((m) => m?.homes ?? []).filter((h) => h.length && !h.includes(EVERYWHERE_REGION));
  if (!lands.length) return 'common';
  return lands[0]!.some((land) => lands.every((h) => h.includes(land))) ? 'common' : 'rare';
}

/** Recipes everyone knows; wishes add more, keyed by the wish's id. */
export const RECIPES: Record<string, RecipeDef> = {
  tonic: { materials: [{ item: 'mushroom-cap', qty: 2 }], result: { item: 'tonic', qty: 1 }, craft: 'herbalism', level: 1 },
  'mushroom-hat': { materials: [{ item: 'mushroom-cap', qty: 4 }], result: { item: 'mushroom-hat', qty: 1 }, craft: 'tailoring', level: 2 },
  'crab-lance': { materials: [{ item: 'crab-shell', qty: 3 }, { item: 'goat-horn', qty: 1 }], result: { item: 'crab-lance', qty: 1 }, craft: 'smithing', level: 4 },
  'shell-mail': { materials: [{ item: 'crab-shell', qty: 5 }], result: { item: 'shell-mail', qty: 1 }, craft: 'smithing', level: 4 },
  'scarab-charm': { materials: [{ item: 'scarab-shell', qty: 3 }, { item: 'goat-horn', qty: 1 }], result: { item: 'scarab-charm', qty: 1 }, craft: 'jewellery', level: 5 },
};

/** The craft a recipe belongs to: its own, else the craft that works its main material; undefined when none does (anyone can make it). */
export function recipeCraft(r: RecipeDef): CraftId | undefined {
  return r.craft ?? craftOfFamily(ITEMS[mainMaterial(r) ?? '']?.material?.family);
}

/** Why this character cannot craft a recipe now, or undefined when they can. */
export function cannotCraft(c: Character, id: string): string | undefined {
  const r = RECIPES[id];
  if (!r || !ITEMS[r.result.item] || r.materials.some((m) => !ITEMS[m.item])) return 'Nobody knows that recipe any more.';
  const craft = recipeCraft(r);
  if (craft) {
    const name = CRAFTS[craft].name;
    const level = craftLevel(c, craft);
    if (level < r.level) return `You need ${name} level ${r.level} to make that; yours is ${level}.`;
    // Tier 3 materials and unique pieces answer only to a master's hand.
    if (!isMastered(c, craft) && (recipeTier(r) === 'unique' || r.materials.some((m) => ITEMS[m.item]!.material?.tier === 3))) return `Only a master of ${name} can make that.`;
    if (!bestTool(c, craft)) return `You need a ${CRAFTS[craft].tool.toLowerCase()} in your bag for ${name}.`;
  }
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

/** Turns a made or bought piece of gear into its own copy; gives back the id it goes in the bag under. */
export type Mint = (base: string) => string;

/**
 * Makes a recipe: takes the materials and adds the result. Gear comes out as
 * a copy when `mint` is given (the server always gives one), each piece its
 * own. Returns why not, or the ids of what was made.
 */
export function craft(c: Character, id: string, mint?: Mint): string | undefined {
  const why = cannotCraft(c, id);
  if (why) return why;
  const r = RECIPES[id]!;
  for (const m of r.materials) takeItem(c, m.item, m.qty);
  if (mint && makesCopies(ITEMS[r.result.item])) for (let i = 0; i < r.result.qty; i++) addItem(c, mint(r.result.item));
  else addItem(c, r.result.item, r.result.qty);
  return undefined;
}

/** The recipe material used most, which gives a crafted copy its trait. */
export function mainMaterial(recipe: RecipeDef): string | undefined {
  return [...recipe.materials].sort((a, b) => b.qty - a.qty)[0]?.item;
}

/**
 * Quality of a piece a player crafts: standard at the recipe's level, two
 * points better for each craft level above it, one for each Wit above the
 * start, five for each tool tier above the first, ten in a home craft, ten
 * more when the main material is one their people prefers, and a little luck
 * either way. Only a master reaches the very top.
 */
export function craftQuality(c: Character, recipe: RecipeDef, random: () => number): number {
  const craft = recipeCraft(recipe);
  const luck = Math.round((random() - 0.5) * 16);
  const wit = totalStats(c).wit - STARTING_STATS.wit;
  if (!craft) return clampQuality(Math.min(UNMASTERED_QUALITY_MAX, QUALITY_STANDARD + wit + luck));
  const q = QUALITY_STANDARD
    + (craftLevel(c, craft) - recipe.level) * 2
    + wit
    + ((bestTool(c, craft)?.tier ?? 1) - 1) * 5
    + (isHomeCraft(c, craft) ? HOME_CRAFT_QUALITY : 0)
    + (prefersMaterial(c.race, ITEMS[mainMaterial(recipe) ?? '']) ? PREFERRED_MATERIAL_QUALITY : 0)
    + luck;
  return clampQuality(isMastered(c, craft) ? q : Math.min(UNMASTERED_QUALITY_MAX, q));
}

/** Practice a craft gives: more for harder recipes, little for ones far below your level. */
export function craftPractice(c: Character, recipe: RecipeDef): number {
  const craft = recipeCraft(recipe);
  if (!craft) return 0;
  const xp = 8 + 4 * recipe.level;
  return craftLevel(c, craft) - recipe.level >= 5 ? Math.ceil(xp / 4) : xp;
}

/** What working a recipe did beyond making it: a new craft level, a worn-out tool. */
export interface Practised {
  craft?: CraftId;
  level?: number;
  broke?: string;
}

/** After a recipe is made: the craft grows and the tool may wear out. */
export function practise(c: Character, recipeId: string, random: () => number): Practised {
  const r = RECIPES[recipeId];
  const craft = r && recipeCraft(r);
  if (!r || !craft) return {};
  const level = gainCraftXp(c, craft, craftPractice(c, r));
  const tool = bestTool(c, craft);
  const broke = tool ? wearTool(c, tool, random) : undefined;
  return { craft, ...(level ? { level } : {}), ...(broke ? { broke } : {}) };
}

/**
 * The copy a player makes of a recipe's result: their name, people, quality
 * and the main material's trait. `lean` is which of their people's two lifted
 * attributes they give the larger share; anything else is ignored.
 */
export function crafted(c: Character, maker: string, recipeId: string, random: () => number, lean?: keyof Stats): Mint {
  const r = RECIPES[recipeId]!;
  const material = mainMaterial(r);
  const trait = material ? ITEMS[material]?.material?.traits[0] : undefined;
  return (base) => newCopy({
    of: base,
    quality: craftQuality(c, r, random),
    maker: { kind: 'player', name: maker },
    ...(c.race ? { people: c.race, ...(canLean(c.race, lean) ? { lean } : {}) } : {}),
    ...(trait ? { trait } : {}),
    ...(material ? { material } : {}),
  } satisfies CopyInfo, random);
}

/** The copy a shopkeeper sells: standard quality, made by them, leaning their people's way when they have one. */
export function shopMade(npcName: string, random: () => number, npcId?: string): Mint {
  const people = npcId && Object.hasOwn(NPC_PEOPLES, npcId) ? NPC_PEOPLES[npcId] : undefined;
  return (base) => newCopy({ of: base, quality: QUALITY_STANDARD, maker: { kind: 'npc', name: npcName }, ...(people ? { people } : {}) }, random);
}

// --- Shops and trainers ----------------------------------------------------------

/** What an NPC sells, and the abilities they teach, with prices in gold. */
export interface ShopDef {
  sells: { item: string; price: number }[];
  teaches: { ability: string; price: number }[];
  /** They buy what players bring, at half its value. */
  buys: boolean;
  /** Crafts they are the master of: players take up a mastery with them (crafts.ts). */
  masters?: CraftId[];
}

/** NPC shops and trainers (design doc, Gold: spent at NPC shops). */
export const SHOPS: Record<string, ShopDef> = {
  marina: {
    sells: [{ item: 'tonic', price: 8 }, { item: 'wooden-sword', price: 15 }, { item: 'traveller-coat', price: 20 }, ...toolOffers('fletching')],
    teaches: [],
    buys: true,
    // Gull feathers come in with every tide.
    masters: ['fletching'],
  },
  // The Woods' herbalist.
  'old-bramble': { sells: toolOffers('herbalism'), teaches: [], buys: false, masters: ['herbalism'] },
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

/** Buys one item from a shop; gear comes as a copy made by the shopkeeper when `mint` is given. Returns why not. */
export function buy(c: Character, npc: string, item: string, mint?: Mint): string | undefined {
  const offer = SHOPS[npc]?.sells.find((s) => s.item === item);
  if (!offer || !ITEMS[item]) return 'That is not for sale here.';
  if (c.gold < offer.price) return `That costs ${offer.price} gold; you have ${c.gold}.`;
  if (itemCount(c, item) >= MAX_STACK) return 'Your bag cannot hold any more of those.';
  c.gold -= offer.price;
  addItem(c, mint && makesCopies(ITEMS[item]) ? mint(item) : item);
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
  const replaced = replacedWords(c, ability);
  if (replaced) return replaced;
  if (c.gold < offer.price) return `Lessons cost ${offer.price} gold; you have ${c.gold}.`;
  c.gold -= offer.price;
  learnAbility(c, ability);
  return undefined;
}

/** Takes up a mastery with its master, or trades `replace` for it. Returns why not. */
export function master(c: Character, npc: string, craft: CraftId, replace?: CraftId): string | undefined {
  if (!SHOPS[npc]?.masters?.includes(craft)) return 'They cannot make you a master of that.';
  return chooseMastery(c, craft, replace);
}

/** Reads a scroll: learns its ability and uses the scroll up. Returns why not. */
export function readScroll(c: Character, item: string): string | undefined {
  const ability = ITEMS[item]?.teaches;
  if (!ability || !ABILITIES[ability]) return 'The words have faded; nothing can be learned from it.';
  if (c.abilities.includes(ability)) return `You know ${ABILITIES[ability]!.name} already. Sell the scroll, or give it to a friend.`;
  const replaced = replacedWords(c, ability);
  if (replaced) return `${replaced} Sell the scroll, or give it to a friend.`;
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
