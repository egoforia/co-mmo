// The traits a material lends what is made from it, apart from materials.ts so
// crafted copies (copies.ts) can read them without loading the world.

/**
 * What a material lends the thing made from it (Region fashion plan): sturdy
 * Armor, warding Ward, warm health regeneration, light dodge, supple attack
 * speed, shimmering Energy regeneration. The numbers come with fashion.
 */
export type MaterialTrait = 'sturdy' | 'warding' | 'warm' | 'light' | 'supple' | 'shimmering';
export const MATERIAL_TRAITS: readonly MaterialTrait[] = ['sturdy', 'warding', 'warm', 'light', 'supple', 'shimmering'];

/** The region whose materials count as every region's (the crossroads); here so recipes (kit.ts) can read it without loading the world. */
export const EVERYWHERE_REGION = 'sanctum';
