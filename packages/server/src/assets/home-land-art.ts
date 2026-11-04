import { CREATURE_HEIGHTS, type CreatureSizeTier } from '@co-mmo/shared';
import type { KitAsset } from './kit.ts';
import { HOME_LAND_ANCHORS } from './home-land-anchors.ts';
import { CRAFT_TOOL_ANCHORS } from './craft-tool-anchors.ts';
import { GATHER_SPOT_ANCHORS } from './gather-spot-anchors.ts';
import { materialIconAnchors } from './material-icon-anchors.ts';
import { SKILL_ANCHORS } from './skill-anchors.ts';
import { wildKit } from './wild-kit.ts';

// The pictures Frostpeak and Mushroom Hollow need (gather and craft plan,
// step 1): their creatures and people (home-land-anchors.ts), and each biome's scenery kit
// (wild-kit.ts, the same kit a wished region of the biome uses). None ships
// with the game: each is painted the first time from the Art tab, where the
// Owner reviews the words before anything is paid for. Until one is, the game
// shows the Sanctum's ground or a stand-in walker in its place.

export { HOME_LAND_ANCHORS };

/** Frostpeak's and Mushroom Hollow's scenery: ground (paths too), water, two trees and a rock each. */
export function homeLandKit(): KitAsset[] {
  return [...wildKit('frostpeak'), ...wildKit('mushroom-hollow')];
}

/** Box a tiered walker is fitted into the first time it is painted: as tall as its tier, a little wider for the big ones. */
const TIER_BOX: Record<CreatureSizeTier, { width: number; height: number }> = {
  tiny: { width: 96, height: CREATURE_HEIGHTS.tiny },
  small: { width: 128, height: CREATURE_HEIGHTS.small },
  medium: { width: 128, height: CREATURE_HEIGHTS.medium },
  high: { width: 160, height: CREATURE_HEIGHTS.high },
  colossal: { width: 288, height: CREATURE_HEIGHTS.colossal },
};

/**
 * The size a home land picture is painted at the first time, or undefined
 * for any other picture: tiles and tools as the launch tiles and items, trees and rocks as the
 * launch kit's, people as tall as everyone, creatures by their height tier.
 */
export function homeLandBox(id: string): { width: number; height: number } | undefined {
  const kit = homeLandKit().find((a) => a.id === id);
  if (kit) return kit.kind === 'tile' || id.endsWith('-rock') ? { width: 128, height: 128 } : { width: 192, height: 256 };
  // The craft tools (step 4), at the launch items' size.
  if (CRAFT_TOOL_ANCHORS.some((a) => a.id === id)) return { width: 128, height: 128 };
  // Gathering spots (step 5), as the launch kit's rocks.
  if (GATHER_SPOT_ANCHORS.some((a) => a.id === id)) return { width: 128, height: 128 };
  // Material icons (step 6), as the launch items.
  if (materialIconAnchors().some((a) => a.id === id)) return { width: 128, height: 128 };
  const skill = SKILL_ANCHORS.find((a) => a.id === id);
  if (skill) return skill.kind === 'effect' ? { width: 128, height: 128 } : TIER_BOX[skill.tier ?? 'medium'];
  const anchor = HOME_LAND_ANCHORS.find((a) => a.id === id);
  if (!anchor) return undefined;
  return anchor.kind === 'npc' ? { width: 128, height: 192 } : TIER_BOX[anchor.tier ?? 'medium'];
}
