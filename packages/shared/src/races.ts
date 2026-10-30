// The five beastfolk peoples (docs/races.md). A people shapes a Wishbearer's
// body and story and lifts two attributes by one; it never limits which
// Calling they take. Plain data: a new people needs a body for the animation
// pipeline, so it is an Engine wish, never wished content.

import type { Stats } from './rpg.ts';

export type RaceId = 'ursine' | 'scorpid' | 'falcon' | 'cervid' | 'lutran';

/**
 * A people's small, situational trait. A closed list the server knows how to
 * apply; the effects arrive with the systems they touch (statuses, ranged
 * reach, healing, the minimap).
 */
export type RaceTrait = 'hibernal' | 'chitin' | 'keen-eye' | 'mycelial-sense' | 'tideborn';

export interface RaceDef {
  id: RaceId;
  name: string;
  /** Their animal, for the painter: the people decides the body, the look wish the rest. */
  animal: string;
  /**
   * The approved anchor that is their body (assets/anchors, with walks in all
   * four isometric ways): worn until a player's own look is painted, and sent
   * to the image model as the first reference when it is.
   */
  body: string;
  /** Where their families' stories come from. */
  home: string;
  /** +1 to two attributes that are never neighbours on the pentagon. */
  lift: Partial<Stats>;
  trait: RaceTrait;
  traitName: string;
  /** The trait in plain words, for the creation screen and character sheet. */
  traitText: string;
  /** One line for the creation screen. */
  blurb: string;
}

export const RACES: Record<RaceId, RaceDef> = {
  ursine: {
    id: 'ursine', name: 'Ursine', animal: 'bear', body: 'bramble-ursine', home: 'Whispering Woods',
    lift: { might: 1, spirit: 1 }, trait: 'hibernal', traitName: 'Hibernal',
    traitText: 'You heal 25% faster when out of a fight.',
    blurb: 'Sturdy bearfolk of the Whispering Woods, who sleep deep and heal well.',
  },
  scorpid: {
    id: 'scorpid', name: 'Scorpid', animal: 'scorpion', body: 'dune-scorpid', home: 'Mirage Desert',
    lift: { agility: 1, vigor: 1 }, trait: 'chitin', traitName: 'Chitin',
    traitText: 'Poison and bleeding last half as long on you.',
    blurb: 'Patient, chitin-plated scorpionfolk of the Mirage Desert. They fear no venom.',
  },
  falcon: {
    id: 'falcon', name: 'Falcon', animal: 'falcon', body: 'zephyr-falcon', home: 'Sky Ruins and Frostpeak',
    lift: { agility: 1, spirit: 1 }, trait: 'keen-eye', traitName: 'Keen Eye',
    traitText: 'Your ranged attacks and skills reach one tile further, and you spot hidden things from further away.',
    blurb: 'Lean, watchful birdfolk of the high cliffs, who see every danger coming.',
  },
  cervid: {
    id: 'cervid', name: 'Cervid', animal: 'deer', body: 'sylvan-cervid', home: 'Mushroom Hollow',
    lift: { wit: 1, vigor: 1 }, trait: 'mycelial-sense', traitName: 'Mycelial Sense',
    traitText: 'Healing on you is 10% stronger, and herbs and materials nearby show on your map.',
    blurb: 'Serene deerfolk of Mushroom Hollow, with velvet antlers, who hear the land.',
  },
  lutran: {
    id: 'lutran', name: 'Lutran', animal: 'otter', body: 'tide-lutran', home: 'Sunlit Shore',
    lift: { might: 1, wit: 1 }, trait: 'tideborn', traitName: 'Tideborn',
    traitText: 'You move 10% faster on shore sand and in shallow water.',
    blurb: 'Curious, buoyant otterfolk of the Sunlit Shore, who are never bored.',
  },
};

/** The peoples in the order the creation screen shows them. */
export const RACE_IDS: readonly RaceId[] = ['ursine', 'scorpid', 'falcon', 'cervid', 'lutran'];

/** Whether a value names one of the peoples. */
export function isRace(v: unknown): v is RaceId {
  return typeof v === 'string' && Object.hasOwn(RACES, v);
}
