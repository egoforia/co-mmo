import type { CraftId } from './crafts.ts';
import { RECIPES, SHOPS, type RecipeDef } from './kit.ts';
import { ITEMS, STYLES, type Bonus, type EquipSlot, type ItemDef, type Rarity, type StyleDef } from './rpg.ts';

// The six region styles (Region fashion plan, F3). Each region has a named
// line of four common garments (head, body, cloak, feet) made from its own
// materials, sold at home by its tailor; rare garments mix two or three
// regions; three unique pieces already made from boss key items belong to a
// style too. Three or more pieces of one style worn together give its
// full-style bonus, anywhere (rpg.ts fullStyles).
//
// Every garment has its own picture (`item-<id>`), painted from the Art tab;
// until then it shows a stand-in, a picture like it. Characters never change.

/** The six styles, by id. */
export const REGION_STYLES: Record<string, StyleDef> = {
  pilgrim: { name: 'Pilgrim', region: 'sanctum', feel: 'plain undyed linen robes, rope sashes and sandals, rose-dyed trims', bonus: { healing: 10 }, tailor: 'mother-elena' },
  barkwarden: { name: 'Barkwarden', region: 'woods', feel: 'heavy layered coats of pelt and bark plates', bonus: { armor: 3 }, tailor: 'old-bramble' },
  pearlcoat: { name: 'Pearlcoat', region: 'shore', feel: 'mother-of-pearl vests, sea cotton and shell beads', bonus: { ward: 3 }, tailor: 'marina' },
  sunwrap: { name: 'Sunwrap', region: 'desert', feel: 'wrapped pale linen, chitin plates and veils', bonus: { shorter: 10 }, tailor: 'cactus-elder' },
  windfelt: { name: 'Windfelt', region: 'frostpeak', feel: 'light wool cloaks, fur-lined hoods and felt boots', bonus: { dodge: 3 }, tailor: 'ysolde' },
  sporeweave: { name: 'Sporeweave', region: 'mushroom-hollow', feel: 'mossy mushroom-fibre robes, cap hats and softly glowing trims', bonus: { energyRegen: 10 }, tailor: 'mother-morel' },
};
Object.assign(STYLES, REGION_STYLES);

/** The picture each slot borrows until a garment's own is painted. */
const STAND_INS: Record<EquipSlot, string> = {
  head: 'item-mushroom-hat', body: 'item-traveller-coat', cloak: 'item-pelt-cloak', feet: 'item-wolf-pelt',
  weapon: 'item-wooden-sword', offhand: 'item-temple-lantern', charm: 'item-scarab-charm',
};

/** What a common garment is worth in each slot; rare ones are worth four times as much. */
const VALUE: Partial<Record<EquipSlot, number>> = { head: 12, body: 24, cloak: 16, feet: 12 };

/** One garment's data: its name, slot, bonus and words. */
type Piece = [id: string, name: string, slot: EquipSlot, bonus: Bonus, description: string];

const garment = (style: string, rarity: Rarity, [, name, slot, bonus, description]: Piece, standIn?: string): ItemDef => ({
  name, kind: 'equipment', art: '', standIn: standIn ?? STAND_INS[slot], slot, rarity, bonus, description,
  value: (VALUE[slot] ?? 12) * (rarity === 'rare' ? 4 : 1), style,
});

/** One recipe: its craft, level and materials. */
type Making = [craft: CraftId, level: number, materials: [string, number][]];

/** Every style's four common garments and how each is made, from that region's materials (the Sanctum's count anywhere). */
const COMMON: Record<string, [Piece, Making][]> = {
  pilgrim: [
    [['pilgrim-hood', "Pilgrim's Hood", 'head', { ward: 1 }, 'A soft hood of blessed linen with a rose-dyed hem. Pilgrims pull it up to pray.'], ['tailoring', 1, [['flax', 3]]]],
    [['pilgrim-robe', "Pilgrim's Robe", 'body', { armor: 1, ward: 2 }, 'A plain linen robe tied with a rope sash. It smells faintly of candle wax and sage.'], ['tailoring', 2, [['flax', 4], ['temple-sage', 1]]]],
    [['pilgrim-mantle', "Pilgrim's Mantle", 'cloak', { ward: 1, spirit: 1 }, 'A long linen mantle, rose-dyed at the edges, worn on the road to the shrine.'], ['tailoring', 3, [['flax', 4], ['moth-dust', 1]]]],
    [['pilgrim-sandals', "Pilgrim's Sandals", 'feet', { armor: 1 }, 'Rope-soled sandals that have walked every road to the Sanctum.'], ['tailoring', 1, [['flax', 2], ['oak-branch', 1]]]],
  ],
  barkwarden: [
    [['barkwarden-helm', 'Barkwarden Helm', 'head', { armor: 2 }, 'A cap of thorn-wolf pelt sewn over a shell of bark. It creaks like an old tree.'], ['leatherwork', 3, [['wolf-pelt', 2], ['heartwood', 1]]]],
    [['barkwarden-coat', 'Barkwarden Coat', 'body', { armor: 6 }, 'A heavy coat of layered pelts with plates of golem bark down the front. Little gets through it.'], ['leatherwork', 5, [['wolf-pelt', 4], ['heartwood', 2]]]],
    [['barkwarden-mantle', 'Barkwarden Mantle', 'cloak', { armor: 2 }, 'A thick thorn-wolf pelt worn over the shoulders, the thorns still in it.'], ['leatherwork', 4, [['wolf-pelt', 3], ['woods-moss', 1]]]],
    [['barkwarden-boots', 'Barkwarden Boots', 'feet', { armor: 1 }, 'Pelt boots bound with bark strips. They leave deep, slow tracks.'], ['leatherwork', 3, [['wolf-pelt', 2], ['iron-ore', 1]]]],
  ],
  pearlcoat: [
    [['pearl-circlet', 'Pearl Circlet', 'head', { ward: 1 }, 'A thin band of sea cotton threaded with small pearls.'], ['tailoring', 3, [['sea-cotton', 2], ['pearl', 1]]]],
    [['pearlcoat-vest', 'Pearlcoat Vest', 'body', { armor: 2, ward: 3 }, 'A sea-cotton vest scaled with mother-of-pearl. It shimmers like a calm tide.'], ['tailoring', 5, [['sea-cotton', 4], ['crab-shell', 2], ['pearl', 1]]]],
    [['pearlcoat-cape', 'Pearlcoat Cape', 'cloak', { ward: 2 }, 'A short sea-green cape edged with shell beads that click in the wind.'], ['tailoring', 4, [['sea-cotton', 3], ['crab-shell', 1]]]],
    [['shellstep-sandals', 'Shellstep Sandals', 'feet', { armor: 1 }, 'Sandals soled with crab shell, good on wet rocks.'], ['tailoring', 2, [['sea-cotton', 2], ['crab-shell', 1]]]],
  ],
  sunwrap: [
    [['sunwrap-veil', 'Sunwrap Veil', 'head', { armor: 1 }, 'A pale linen veil that keeps the sand out of your eyes and the sun off your face.'], ['tailoring', 3, [['ancient-linen', 1], ['desert-cotton', 2]]]],
    [['sunwrap-robes', 'Sunwrap Robes', 'body', { armor: 3, ward: 1 }, 'Long wrapped robes of ancient linen with scarab-shell plates at the chest.'], ['tailoring', 5, [['desert-cotton', 3], ['ancient-linen', 2], ['scarab-shell', 1]]]],
    [['sunwrap-shawl', 'Sunwrap Shawl', 'cloak', { armor: 1, ward: 1 }, 'A wide cotton shawl the colour of the dunes at noon.'], ['tailoring', 4, [['desert-cotton', 3], ['amber', 1]]]],
    [['sunwrap-wraps', 'Sunwrap Foot Wraps', 'feet', { armor: 1 }, 'Strips of cotton wound tight around the feet. The sand never burns through.'], ['tailoring', 2, [['desert-cotton', 2], ['goat-horn', 1]]]],
  ],
  windfelt: [
    [['windfelt-hood', 'Windfelt Hood', 'head', { armor: 1 }, 'A felt hood lined with snow-hare fur. Falcons wear them pushed back.'], ['tailoring', 4, [['mountain-wool', 2], ['snow-hare-fur', 1]]]],
    [['windfelt-tunic', 'Windfelt Tunic', 'body', { armor: 3 }, 'A close felted tunic, warm but light enough to run in.'], ['tailoring', 6, [['mountain-wool', 4], ['snow-hare-fur', 1]]]],
    [['windfelt-cloak', 'Windfelt Cloak', 'cloak', { armor: 1, agility: 1 }, 'A light grey wool cloak that catches the mountain wind like a wing.'], ['tailoring', 5, [['mountain-wool', 3], ['frost-pine', 1]]]],
    [['windfelt-boots', 'Windfelt Boots', 'feet', { armor: 1 }, 'Soft felt boots with a fur cuff. They make no sound on snow.'], ['leatherwork', 4, [['snow-hare-fur', 2], ['mountain-wool', 1]]]],
  ],
  sporeweave: [
    [['sporeweave-cap', 'Sporeweave Cap', 'head', { ward: 1 }, 'A broad cap woven of mushroom fibre. Its brim glows faintly at dusk.'], ['tailoring', 4, [['mushroom-fibre', 2], ['spore-dust', 1]]]],
    [['sporeweave-robe', 'Sporeweave Robe', 'body', { armor: 2, ward: 2 }, 'A mossy robe of mushroom fibre with living trims that glow when you breathe slow.'], ['tailoring', 6, [['mushroom-fibre', 4], ['spore-dust', 1]]]],
    [['sporeweave-mantle', 'Sporeweave Mantle', 'cloak', { ward: 1, wit: 1 }, 'A soft mantle of woven fibre, dusted with spores that shimmer as you move.'], ['tailoring', 5, [['mushroom-fibre', 3], ['shelf-fungus', 1]]]],
    [['sporeweave-slippers', 'Sporeweave Slippers', 'feet', { armor: 1 }, 'Spongy slippers of shelf fungus and fibre, quiet on any floor.'], ['tailoring', 3, [['mushroom-fibre', 2], ['shelf-fungus', 1]]]],
  ],
};

/** Rare garments: one style lined or trimmed with another region's best, from two or three regions. */
const RARE: [string, Piece, Making][] = [
  ['windfelt', ['sea-lined-cloak', 'Sea-Lined Windfelt Cloak', 'cloak', { armor: 2, agility: 2, ward: 1 }, 'A Windfelt cloak lined with sea cotton and fastened with a pearl. Light as spray.'], ['tailoring', 9, [['mountain-wool', 3], ['sea-cotton', 2], ['pearl', 1]]]],
  ['windfelt', ['gullwing-hood', 'Gullwing Hood', 'head', { armor: 2, agility: 2 }, 'A felt hood crested with gull feathers. Whoever wears it seems always about to fly.'], ['tailoring', 8, [['mountain-wool', 2], ['gull-feather', 3]]]],
  ['barkwarden', ['wyrmplate-coat', 'Wyrmplate Barkwarden Coat', 'body', { armor: 9, vigor: 2 }, 'A Barkwarden coat with wyrm scales riveted over the bark plates.'], ['leatherwork', 10, [['wolf-pelt', 3], ['wyrm-scale', 2], ['heartwood', 1]]]],
  ['barkwarden', ['rootstep-boots', 'Rootstep Boots', 'feet', { armor: 3, might: 1 }, 'Pelt boots soled with shelf fungus. They grip like roots.'], ['leatherwork', 8, [['wolf-pelt', 2], ['shelf-fungus', 2], ['iron-ore', 1]]]],
  ['pearlcoat', ['glowpearl-vest', 'Glowpearl Vest', 'body', { armor: 3, ward: 5 }, 'A Pearlcoat vest set with glowcap chitin that lights the pearls from beneath.'], ['tailoring', 10, [['sea-cotton', 3], ['glowcap-chitin', 2], ['pearl', 1]]]],
  ['sunwrap', ['frostglass-veil', 'Frostglass Veil', 'head', { armor: 2, ward: 2 }, 'A Sunwrap veil sewn with ice crystal beads that never melt, even in the dunes.'], ['tailoring', 9, [['desert-cotton', 2], ['ancient-linen', 1], ['ice-crystal', 1]]]],
  ['sporeweave', ['snowmoss-slippers', 'Snowmoss Slippers', 'feet', { armor: 2, wit: 1, vigor: 1 }, 'Sporeweave slippers lined with snow-hare fur. Warm feet, quiet mind.'], ['tailoring', 8, [['mushroom-fibre', 3], ['snow-hare-fur', 2]]]],
  ['pilgrim', ['amber-pilgrim-mantle', 'Amber Pilgrim Mantle', 'cloak', { ward: 3, spirit: 2 }, 'A Pilgrim\'s mantle clasped with desert amber and hemmed with pearls.'], ['tailoring', 9, [['flax', 3], ['amber', 2], ['pearl', 1]]]],
];

/** The unique pieces (recipes.ts) that belong to a style and count toward its bonus. */
const UNIQUE_STYLES: Record<string, string> = { 'roc-plume-mantle': 'windfelt', 'rootless-crown': 'sporeweave', 'wyrmscale-hauberk': 'sunwrap' };

/** Every garment the styles add, by id. */
export const GARMENTS: Record<string, ItemDef> = {};
/** Every recipe for them, by id (the same as the garment's). */
export const GARMENT_RECIPES: Record<string, RecipeDef> = {};

const recipe = (id: string, [craft, level, materials]: Making): RecipeDef => ({
  craft, level, materials: materials.map(([item, qty]) => ({ item, qty })), result: { item: id, qty: 1 },
});

for (const [style, pieces] of Object.entries(COMMON)) {
  for (const [piece, making] of pieces) {
    GARMENTS[piece[0]] = garment(style, 'common', piece);
    GARMENT_RECIPES[piece[0]] = recipe(piece[0], making);
  }
}
for (const [style, piece, making] of RARE) {
  GARMENTS[piece[0]] = garment(style, 'rare', piece);
  GARMENT_RECIPES[piece[0]] = recipe(piece[0], making);
}
for (const [id, def] of Object.entries(GARMENTS)) def.art = `item-${id}`;

Object.assign(ITEMS, GARMENTS);
Object.assign(RECIPES, GARMENT_RECIPES);
for (const [id, style] of Object.entries(UNIQUE_STYLES)) if (ITEMS[id]) ITEMS[id]!.style = style;

/** Each home tailor sells their style's four common garments at about half again their worth. */
for (const [style, def] of Object.entries(REGION_STYLES)) {
  const shop = SHOPS[def.tailor];
  if (!shop) continue;
  for (const [piece] of COMMON[style]!) {
    if (!shop.sells.some((s) => s.item === piece[0])) shop.sells.push({ item: piece[0], price: Math.round(GARMENTS[piece[0]]!.value! * 1.5) });
  }
}

/** The garments of one style, by id. */
export function styleGarments(style: string): string[] {
  return Object.entries(ITEMS).filter(([, d]) => d.style === style).map(([id]) => id);
}

/** A style in plain words for a garment's card, like "Windfelt, from Frostpeak. Three pieces: +3% dodge." */
export function styleWords(def: ItemDef | undefined, regionName: (id: string) => string = (id) => id): string {
  const style = def?.style ? STYLES[def.style] : undefined;
  if (!style) return '';
  return `${style.name} style, from ${regionName(style.region)}. Three pieces worn: ${styleBonusWords(def!.style!)}.`;
}

/** A style's full-style bonus in plain words, like "+3% dodge". */
export function styleBonusWords(styleId: string): string {
  const bonus = STYLES[styleId]?.bonus ?? {};
  const k = Object.keys(bonus)[0] as keyof Bonus;
  const v = bonus[k]!;
  const words: Partial<Record<keyof Bonus, string>> = {
    healing: `+${v}% healing received`, armor: `+${v} Armor`, ward: `+${v} Ward`, shorter: `harmful statuses ${v}% shorter`, dodge: `+${v}% dodge`, energyRegen: `+${v}% Energy regeneration`,
  };
  return words[k] ?? `+${v} ${k}`;
}
