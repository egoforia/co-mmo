import { CRAFT_IDS, toolId, type CraftId } from './crafts.ts';
import { RECIPES, type RecipeDef, type RecipeTier } from './kit.ts';
import { ITEMS, type ItemDef } from './rpg.ts';

// The starting recipes (gather and craft plan, step 6): the tools of every
// craft, common recipes that use each land's own materials (gathered ones
// most of all), rare ones that mix two or three lands, and five unique
// pieces, each needing a key item from a boss and a master to make it. Wishes
// add more (content.ts); a wished common recipe is a Minor wish, and rare and
// unique ones go before the Stewards (wishes/cards.ts).

const r = (craft: CraftId, level: number, result: string, materials: [string, number][], name?: string, qty = 1): RecipeDef => ({
  ...(name ? { name } : {}),
  craft,
  level,
  materials: materials.map(([item, n]) => ({ item, qty: n })),
  result: { item: result, qty },
});

/**
 * Every craft's tools, made by Smithing: a copper head on an oak handle
 * (common), an iron one on frost pine (rare), and a master's of silver and
 * gold on shelf fungus (rare, past level 10, so only a master smith).
 */
const TOOL_RECIPES: Record<string, RecipeDef> = Object.fromEntries(CRAFT_IDS.flatMap((k) => [
  [toolId(k, 1), r('smithing', 1, toolId(k, 1), [['copper-ore', 2], ['oak-branch', 1]])],
  [toolId(k, 2), r('smithing', 7, toolId(k, 2), [['iron-ore', 3], ['frost-pine', 2]])],
  [toolId(k, 3), r('smithing', 14, toolId(k, 3), [['silver-ore', 2], ['gold-ore', 2], ['shelf-fungus', 2]])],
]));

/** Common and rare recipes for the gear the lands already know, from each land's materials. */
const LAND_RECIPES: Record<string, RecipeDef> = {
  // The Sanctum: its materials count in any land.
  'oak-sword': r('woodcarving', 1, 'wooden-sword', [['oak-branch', 3]], 'Oak Practice Sword'),
  'flax-coat': r('tailoring', 1, 'traveller-coat', [['flax', 4]], 'Linen Traveller\'s Coat'),
  'sage-tonic': r('herbalism', 2, 'tonic', [['temple-sage', 2]], 'Sage Tonic'),
  'sage-incense': r('herbalism', 4, 'warding-incense', [['temple-sage', 3], ['amber', 1]], 'Sage and Amber Incense'),
  // The Woods.
  'oak-club': r('woodcarving', 8, 'golem-club', [['heartwood', 3], ['iron-ore', 2]], 'Ironbound Heartwood Club'),
  'moss-tonic': r('herbalism', 3, 'tonic', [['woods-moss', 2]], 'Moss Tonic', 2),
  // The Shore.
  'sea-cotton-coat': r('tailoring', 2, 'traveller-coat', [['sea-cotton', 4]], 'Sea Cotton Coat'),
  'driftwood-lantern': r('woodcarving', 3, 'temple-lantern', [['driftwood', 3], ['crab-shell', 1]], 'Driftwood Lantern'),
  // The Desert.
  'desert-cotton-coat': r('tailoring', 2, 'traveller-coat', [['desert-cotton', 4]], 'Desert Cotton Coat'),
  'amber-amulet': r('jewellery', 8, 'sunstone-amulet', [['amber', 3], ['gold-ore', 1]], 'Amber Sun Amulet'),
  // Frostpeak.
  'wool-coat': r('tailoring', 3, 'traveller-coat', [['mountain-wool', 4]], 'Mountain Wool Coat'),
  'hare-cloak': r('leatherwork', 3, 'pelt-cloak', [['snow-hare-fur', 4]], 'Snow Hare Cloak'),
  'snowbell-tonic': r('herbalism', 2, 'tonic', [['snowbell', 2]], 'Snowbell Tonic'),
  // Mushroom Hollow.
  'fibre-cap': r('tailoring', 2, 'mushroom-hat', [['mushroom-fibre', 3]], 'Woven Fibre Cap'),
  'truffle-tonic': r('herbalism', 4, 'tonic', [['cave-truffle', 1]], 'Truffle Tonic', 2),
  'chitin-mail': r('smithing', 6, 'shell-mail', [['glowcap-chitin', 4]], 'Glowcap Chitin Mail'),
  // Rare: two or three lands.
  'coral-spear': r('smithing', 9, 'coral-spear', [['driftwood', 2], ['pearl', 1], ['iron-ore', 2]]),
  'ice-charm': r('jewellery', 9, 'scarab-charm', [['ice-crystal', 2], ['hollow-amethyst', 1], ['silver-ore', 1]], 'Frost and Amethyst Charm'),
};

const unique = (name: string, standIn: string, description: string, rest: Omit<ItemDef, 'name' | 'kind' | 'art' | 'description'>): ItemDef => ({
  // Its own picture (`item-<id>`, set below) once painted; until then a picture like it.
  name, kind: 'equipment', art: '', standIn, description, unique: true, ...rest,
});

/** The pieces only unique recipes make: one of a kind, bound to whoever first wears each. */
export const UNIQUE_ITEMS: Record<string, ItemDef> = {
  'roc-plume-mantle': unique('Roc Plume Mantle', 'item-pelt-cloak', 'A mantle of mountain wool trimmed with a single plume of the Hoarfrost Roc. The wind seems to lift whoever wears it.', {
    slot: 'cloak', rarity: 'epic', bonus: { armor: 7, agility: 3 }, value: 260,
  }),
  'rootless-crown': unique('Crown of the Rootless King', 'item-mushroom-hat', 'A circlet of living mycelium set with amethyst. It whispers what the ground used to say.', {
    slot: 'head', rarity: 'epic', bonus: { armor: 2, spirit: 4, wit: 3 }, value: 260,
  }),
  'demonhorn-bow': unique('Demonhorn Bow', 'held-bow', 'A bow of heartwood with limbs of demon horn. Its string hums with abyssal heat.', {
    slot: 'weapon', weapon: 'bow', rarity: 'legendary', bonus: { attack: 11, agility: 3 }, value: 400,
  }),
  'wyrmscale-hauberk': unique('Wyrmscale Hauberk', 'item-shell-mail', 'Overlapping wyrm scales riveted with gold and silver. Fire slides off it like rain.', {
    slot: 'body', rarity: 'epic', bonus: { armor: 9, might: 2, ward: 2 }, value: 300,
  }),
  'relic-blade': unique('Relicbound Blade', 'item-wooden-sword', 'A silver sword forged around the Sanctum Relic. It glows faintly in the dark.', {
    slot: 'weapon', weapon: 'sword', rarity: 'legendary', bonus: { attack: 12, spirit: 3 }, value: 400,
  }),
};
for (const [id, def] of Object.entries(UNIQUE_ITEMS)) def.art = `item-${id}`;

/** One unique recipe per big boss: its key item, other lands' best, and a master's hand. */
const UNIQUE_RECIPES: Record<string, RecipeDef> = {
  'roc-plume-mantle': { ...r('tailoring', 15, 'roc-plume-mantle', [['roc-plume', 1], ['mountain-wool', 4], ['gull-feather', 2]]), tier: 'unique' },
  'rootless-crown': { ...r('jewellery', 15, 'rootless-crown', [['kings-mycelium', 1], ['hollow-amethyst', 2], ['spore-dust', 3]]), tier: 'unique' },
  'demonhorn-bow': { ...r('fletching', 18, 'demonhorn-bow', [['demon-horn', 1], ['heartwood', 2], ['gull-feather', 4]]), tier: 'unique' },
  // The wyrm and the relic are not tier 3 materials, so these say they are unique.
  'wyrmscale-hauberk': { ...r('smithing', 16, 'wyrmscale-hauberk', [['wyrm-scale', 4], ['gold-ore', 2], ['silver-ore', 2]]), tier: 'unique' },
  'relic-blade': { ...r('smithing', 18, 'relic-blade', [['sanctum-relic', 1], ['silver-ore', 4], ['acacia-wood', 2]]), tier: 'unique' },
};

/** Every starting recipe added here, by id. */
export const STARTING_RECIPES: Record<string, RecipeDef> = { ...TOOL_RECIPES, ...LAND_RECIPES, ...UNIQUE_RECIPES };

Object.assign(ITEMS, UNIQUE_ITEMS);
Object.assign(RECIPES, STARTING_RECIPES);

/** A tier in plain words for the crafting book. */
export function recipeTierWords(tier: RecipeTier): string {
  return tier === 'unique' ? 'Unique: a master\'s work' : tier === 'rare' ? 'Rare: materials from more than one land' : 'Common';
}
