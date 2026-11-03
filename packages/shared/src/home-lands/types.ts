import type { BiomeId } from '../biomes.ts';
import type { ShopDef } from '../kit.ts';
import type { CreatureDef, ItemDef, QuestDef } from '../rpg.ts';
import type { RegionMap } from '../world.ts';

/**
 * A home land the game ships with beyond the launch four (the gather and
 * craft plan, step 1): how its map is laid out and what lives there, in the
 * same shapes as the launch lands' content (lands.ts).
 */
export interface HomeLand {
  biome: BiomeId;
  /** Lays the land out around its middle tile `c`; run by generateRegion. */
  layout: (map: RegionMap, c: number) => void;
  creatures: Record<string, CreatureDef>;
  items: Record<string, ItemDef>;
  people: Record<string, { name: string; greeting: string; shop?: ShopDef }>;
  quests: Record<string, QuestDef>;
}
