import { ITEMS, type ItemDef } from './rpg.ts';
import { regionDef } from './world.ts';

// Materials as data (gather and craft plan, step 2). Every material says what
// family it belongs to (which craft works it, step 4), where it comes from,
// how it is found, how hard it is to work, and the trait it lends what is
// made from it (the fashion plan's material trait). Recipe tiers (step 6)
// read the home regions: a common recipe uses one region's materials.

/** What a material is, which decides the craft that works it. */
export type MaterialFamily = 'wood' | 'hide' | 'fibre' | 'ore' | 'plate' | 'feather' | 'herb' | 'gem' | 'bone' | 'wishstuff';
export const MATERIAL_FAMILIES: readonly MaterialFamily[] = ['wood', 'hide', 'fibre', 'ore', 'plate', 'feather', 'herb', 'gem', 'bone', 'wishstuff'];

/** How a material is found: from a gathering spot, a creature, a quest, or only from a boss. */
export type MaterialSource = 'gathered' | 'creature' | 'quest' | 'boss';
export const MATERIAL_SOURCES: readonly MaterialSource[] = ['gathered', 'creature', 'quest', 'boss'];

/** 1 anyone can work, 2 takes practice, 3 needs a mastery. */
export type MaterialTier = 1 | 2 | 3;

export { MATERIAL_TRAITS, type MaterialTrait } from './material-traits.ts';
import { EVERYWHERE_REGION, MATERIAL_TRAITS, type MaterialTrait } from './material-traits.ts';


/** A material's data, on its ItemDef as `material`. */
export interface MaterialInfo {
  family: MaterialFamily;
  /** The regions it comes from, by id. The Sanctum's materials count as every region's. */
  homes: string[];
  source: MaterialSource;
  tier: MaterialTier;
  /** At most one; none for a plain material. */
  traits: MaterialTrait[];
}

export { EVERYWHERE_REGION } from './material-traits.ts';

/** Highest tier a wished material can have: tier 3 comes only from bosses, quests and masters. */
export const MAX_WISHED_MATERIAL_TIER: MaterialTier = 2;

/** What a shop pays twice over for a wished material of each tier. */
export const WISHED_MATERIAL_VALUE: Record<MaterialTier, number> = { 1: 6, 2: 15, 3: 40 };

/** Every material item, by id. */
export function materials(): [string, ItemDef & { material: MaterialInfo }][] {
  return Object.entries(ITEMS).filter((e): e is [string, ItemDef & { material: MaterialInfo }] => e[1].kind === 'material' && Boolean(e[1].material));
}

/** The materials that come from a region, its own and not the Sanctum's. */
export function regionMaterials(regionId: string): string[] {
  return materials().filter(([, d]) => d.material.homes.includes(regionId)).map(([id]) => id);
}

/** The regions a material counts as coming from; empty for an item with no material data. */
export function materialHomes(itemId: string): string[] {
  return ITEMS[itemId]?.material?.homes ?? [];
}

const FAMILY_NAMES: Record<MaterialFamily, string> = {
  wood: 'Wood', hide: 'Hide', fibre: 'Fibre', ore: 'Ore', plate: 'Plate', feather: 'Feather', herb: 'Herb', gem: 'Gem', bone: 'Bone and horn', wishstuff: 'Wishstuff',
};
const TIER_WORDS: Record<MaterialTier, string> = { 1: 'common', 2: 'fine', 3: 'masterwork' };

/** A material in plain words for an item's card, like "Hide, common, warm. From Frostpeak." */
export function materialWords(def: ItemDef): string {
  const m = def.material;
  if (!m) return '';
  const homes = m.homes.map((id) => regionDef(id)?.name ?? id);
  const where = m.homes.includes(EVERYWHERE_REGION) ? 'Counts as every land\'s.' : homes.length ? `From ${homes.join(' and ')}.` : '';
  return `${[FAMILY_NAMES[m.family], TIER_WORDS[m.tier], ...m.traits].join(', ')}.${where ? ` ${where}` : ''}`;
}

/** Words that name each family, for a wished material that does not say. */
const FAMILY_WORDS: [MaterialFamily, RegExp][] = [
  ['wishstuff', /\b(dust|wish|essence|spark|ember salt|spore)/i],
  ['feather', /\b(feather|plume|quill|down)\b/i],
  ['hide', /\b(pelt|hide|fur|leather|skin)\b/i],
  ['fibre', /\b(wool|linen|silk|cotton|flax|thread|fibre|fiber|felt|cloth|yarn)\b/i],
  ['ore', /\b(ore|iron|copper|silver|gold|metal|ingot|nugget)\b/i],
  ['plate', /\b(shell|scale|chitin|carapace|plate)\b/i],
  ['gem', /\b(gem|pearl|crystal|jewel|stone|amber|ruby|sapphire)\b/i],
  ['bone', /\b(bone|horn|fang|tooth|tusk|claw|antler)\b/i],
  ['wood', /\b(wood|bark|branch|log|root|plank|twig)\b/i],
];

/** The family a material's name and words point to; herb when nothing does. */
export function materialFamilyFromWords(words: string): MaterialFamily {
  return FAMILY_WORDS.find(([, re]) => re.test(words))?.[0] ?? 'herb';
}

/**
 * A wished material's data, cleaned: a family (from its words when missing),
 * tier 1 or 2, at most one trait, home regions that exist (the Sanctum when
 * none do). Wished materials drop from creatures.
 */
export function cleanMaterial(raw: unknown, words: string): MaterialInfo {
  const d = (raw ?? {}) as Record<string, unknown>;
  const family = MATERIAL_FAMILIES.find((f) => f === d.family) ?? materialFamilyFromWords(words);
  const tier = Math.max(1, Math.min(MAX_WISHED_MATERIAL_TIER, Math.round(Number(d.tier) || 1))) as MaterialTier;
  const traits = (Array.isArray(d.traits) ? d.traits : [d.trait]).filter((t): t is MaterialTrait => MATERIAL_TRAITS.includes(t as MaterialTrait)).slice(0, 1);
  const homes = (Array.isArray(d.homes) ? d.homes : []).filter((h): h is string => typeof h === 'string' && Boolean(regionDef(h))).slice(0, 3);
  return { family, homes: homes.length ? [...new Set(homes)] : [EVERYWHERE_REGION], source: 'creature', tier, traits };
}
