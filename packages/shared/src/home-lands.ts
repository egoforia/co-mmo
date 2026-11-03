import type { BiomeId } from './biomes.ts';
import { SHOPS } from './kit.ts';
import { CREATURES, ITEMS, NPC_GREETINGS, NPC_NAMES, QUESTS } from './rpg.ts';
import { FROSTPEAK } from './home-lands/frostpeak.ts';
import { MUSHROOM_HOLLOW } from './home-lands/mushroom-hollow.ts';
import type { HomeLand } from './home-lands/types.ts';
import type { RegionMap } from './world.ts';

export type { HomeLand } from './home-lands/types.ts';

// The home lands the game ships with beyond the launch four: Frostpeak for
// the Falcon and Mushroom Hollow for the Cervid (gather and craft plan, step
// 1). Their regions are in WORLD_REGIONS (world.ts); each land's layout and
// content is one file in home-lands/, added to the shared tables here as the
// game loads, like the launch lands' (lands.ts).

/** Every shipped home land beyond the launch four. */
export const HOME_LANDS: HomeLand[] = [FROSTPEAK, MUSHROOM_HOLLOW];

/** The layout of a home land's biome, or undefined for any other biome. */
export function homeLandLayout(biome: BiomeId): ((map: RegionMap, c: number) => void) | undefined {
  return HOME_LANDS.find((l) => l.biome === biome)?.layout;
}

for (const land of HOME_LANDS) {
  Object.assign(CREATURES, land.creatures);
  Object.assign(ITEMS, land.items);
  Object.assign(QUESTS, land.quests);
  for (const [id, p] of Object.entries(land.people)) {
    NPC_NAMES[id] = p.name;
    NPC_GREETINGS[id] = p.greeting;
    if (p.shop) SHOPS[id] = p.shop;
  }
}
