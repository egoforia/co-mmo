import type { MaterialTrait } from './material-traits.ts';
import type { MaterialFamily } from './materials.ts';
import { RACES, type RaceId } from './races.ts';
import type { Bonus, ItemDef, Rarity, Stats } from './rpg.ts';

// Garment attributes (Region fashion plan, F2). A crafted copy's bonus is its
// base item's scaled by quality (copies.ts), plus two things the maker brings:
// a lean toward their people's two lifted attributes, sized by rarity, and
// the main material's trait, also sized by rarity. All of it follows from the
// copy's id, so it is worked out once, the same on server and browser, and
// never sent by the client.
//
// Only types come from rpg.ts and materials.ts: copies.ts reads this file
// while rpg.ts is still loading.

/** The people lean by rarity: [the leading attribute, the other one]. */
export const LEAN_BY_RARITY: Record<Rarity, [number, number]> = {
  common: [1, 0],
  uncommon: [1, 1],
  rare: [2, 1],
  epic: [2, 2],
  legendary: [3, 3],
};

/** How many times over a material trait counts, by rarity. */
export const TRAIT_STRENGTH: Record<Rarity, number> = { common: 1, uncommon: 1, rare: 2, epic: 2, legendary: 3 };

/** What each trait adds at strength 1. Percentages are of the thing they name. */
export const TRAIT_EFFECTS: Record<MaterialTrait, Bonus> = {
  sturdy: { armor: 1 },
  warding: { ward: 1 },
  warm: { regen: 5 },
  light: { dodge: 1 },
  supple: { haste: 1 },
  shimmering: { energyRegen: 3 },
};

/** The two attributes a people lifts, in the order its lean leads by default. */
export function liftedStats(people: RaceId): [keyof Stats, keyof Stats] {
  return Object.keys(RACES[people].lift) as [keyof Stats, keyof Stats];
}

/** True when `stat` is one the people lifts, so a maker may lean toward it. */
export function canLean(people: RaceId, stat: unknown): stat is keyof Stats {
  return liftedStats(people).includes(stat as keyof Stats);
}

/** A maker's people lean on a piece of this rarity; `lead` gets the larger share (their first lifted attribute when not said). */
export function peopleLean(people: RaceId, rarity: Rarity, lead?: keyof Stats): Bonus {
  const [a, b] = liftedStats(people);
  const [first, second] = lead === b ? [b, a] : [a, b];
  const [big, small] = LEAN_BY_RARITY[rarity];
  return { ...(big ? { [first]: big } : {}), ...(small ? { [second]: small } : {}) };
}

/** A material trait's bonus on a piece of this rarity. */
export function traitBonus(trait: MaterialTrait, rarity: Rarity): Bonus {
  const times = TRAIT_STRENGTH[rarity];
  return Object.fromEntries(Object.entries(TRAIT_EFFECTS[trait]).map(([k, v]) => [k, (v as number) * times])) as Bonus;
}

/** Two bonuses added together. */
export function addBonus(a: Bonus | undefined, b: Bonus | undefined): Bonus {
  const out: Bonus = { ...a };
  for (const [k, v] of Object.entries(b ?? {}) as [keyof Bonus, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** What each people works best (the plan's table): their families, and words in a material's name. */
const PREFERS: Record<RaceId, { families: MaterialFamily[]; words: RegExp }> = {
  ursine: { families: ['wood', 'hide'], words: /\b(bark|pelt|fur|hide)/i },
  scorpid: { families: [], words: /\b(linen|silk|cotton|flax|chitin|scarab|scale)/i },
  falcon: { families: ['feather'], words: /\b(wool|felt|feather|plume)/i },
  cervid: { families: ['herb'], words: /\b(mushroom|moss|fungus|spore|mycelium|truffle)/i },
  lutran: { families: [], words: /\b(shell|pearl|sea|coral|kelp|drift)/i },
};

/** Extra quality a maker gets working a material their people prefers. */
export const PREFERRED_MATERIAL_QUALITY = 10;

/** True when a people prefers to work this material (a head start for the maker, not the wearer). */
export function prefersMaterial(people: RaceId | undefined, material: ItemDef | undefined): boolean {
  if (!people || !material?.material) return false;
  const p = PREFERS[people];
  return p.families.includes(material.material.family) || p.words.test(material.name);
}

/**
 * The people of the shopkeepers who sell or make gear: what they sell leans
 * their way (always Common at standard quality, so a player tailor can do better).
 */
export const NPC_PEOPLES: Record<string, RaceId> = {
  marina: 'lutran',
  'old-bramble': 'ursine',
  'cactus-elder': 'scorpid',
  'mother-elena': 'cervid',
  ysolde: 'falcon',
  'mother-morel': 'cervid',
  'brother-tolle': 'ursine',
  'sultana-zahra': 'scorpid',
  'queen-nerissa': 'lutran',
  'sister-amala': 'falcon',
};

/** The region styles a garment wish may name, by id, with their region (fashion-styles.ts gives the rest). */
export const STYLE_CHOICES: readonly [id: string, label: string][] = [
  ['pilgrim', 'Pilgrim (the Sanctum)'],
  ['barkwarden', 'Barkwarden (Whispering Woods)'],
  ['pearlcoat', 'Pearlcoat (Sunlit Shore)'],
  ['sunwrap', 'Sunwrap (Mirage Desert)'],
  ['windfelt', 'Windfelt (Frostpeak)'],
  ['sporeweave', 'Sporeweave (Mushroom Hollow)'],
];
