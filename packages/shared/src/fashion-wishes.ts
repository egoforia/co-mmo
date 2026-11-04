import { EVERYWHERE_REGION } from './material-traits.ts';
import { RECIPES, type RecipeDef } from './kit.ts';
import { GARMENT_SLOTS, ITEMS, STYLES, type EquipSlot, type InventorySlot, type Rarity } from './rpg.ts';
import { STYLE_CHOICES } from './fashion.ts';
import { isCopyId } from './copies.ts';

// Wished garments (Region fashion plan, F4). A wished hat, coat, cloak or pair
// of boots belongs to one region's style and is made from that region's
// materials: the wish brings the garment and its recipe, both under the
// wish's id, so switching the wish off (a mod, like every wish) takes both
// out. A rare garment goes before the Stewards (wishes/cards.ts); unique
// pieces are never wished.
//
// STYLES is filled by fashion-styles.ts after this file loads, so everything
// here reads it when called, never at load.

/** Most materials a wished garment's recipe takes. */
export const MAX_GARMENT_MATERIALS = 3;

/** True for the four garment slots: head, body, cloak and feet. */
export function isGarmentSlot(slot: EquipSlot | undefined): boolean {
  return Boolean(slot && GARMENT_SLOTS.includes(slot));
}

/** The style a wish names, or one its words name ("a Windfelt scarf"), or undefined. */
export function wishedStyle(raw: unknown, words: string): string | undefined {
  if (typeof raw === 'string' && STYLE_CHOICES.some(([id]) => id === raw)) return raw;
  const lower = words.toLowerCase();
  return STYLE_CHOICES.find(([id]) => lower.includes(id))?.[0];
}

/** The style of the region a player stands in, for a garment wish that names none. */
export function regionStyle(regionId: string): string | undefined {
  return Object.entries(STYLES).find(([, s]) => s.region === regionId)?.[0];
}

/** True when a material may go into a garment of this style: its region's own, or the Sanctum's. */
export function fitsStyle(item: string, style: string): boolean {
  const homes = ITEMS[item]?.material?.homes ?? [];
  const region = STYLES[style]?.region;
  return Boolean(region) && (homes.includes(region!) || homes.includes(EVERYWHERE_REGION));
}

/**
 * A wished garment's recipe materials, cleaned: only that style's region's
 * materials (or the Sanctum's), at most three, 1 to 6 of each. When none of
 * them fit, it takes what the style's own common garment for that slot takes.
 */
export function garmentMaterials(raw: unknown, style: string, slot: EquipSlot): InventorySlot[] {
  const out: InventorySlot[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    const s = (m ?? {}) as Record<string, unknown>;
    const item = s.item;
    if (typeof item !== 'string' || isCopyId(item) || !fitsStyle(item, style) || out.some((x) => x.item === item)) continue;
    out.push({ item, qty: Math.max(1, Math.min(6, Math.round(Number(s.qty) || 2))) });
    if (out.length >= MAX_GARMENT_MATERIALS) break;
  }
  if (out.length) return out;
  const own = Object.values(RECIPES).find((r) => ITEMS[r.result.item]?.style === style && ITEMS[r.result.item]?.slot === slot && ITEMS[r.result.item]?.rarity === 'common');
  return own ? own.materials.map((m) => ({ ...m })) : [];
}

/** Craft level a wished garment's recipe needs, by rarity. */
const GARMENT_LEVEL: Partial<Record<Rarity, number>> = { common: 3, uncommon: 6, rare: 9 };

/** The recipe a garment wish brings: Leatherwork when its main material is hide, else Tailoring. */
export function garmentRecipe(id: string, materials: InventorySlot[], rarity: Rarity = 'common'): RecipeDef {
  const main = [...materials].sort((a, b) => b.qty - a.qty)[0];
  const craft = ITEMS[main?.item ?? '']?.material?.family === 'hide' ? 'leatherwork' : 'tailoring';
  return { craft, level: GARMENT_LEVEL[rarity] ?? 3, materials: materials.map((m) => ({ ...m })), result: { item: id, qty: 1 } };
}
