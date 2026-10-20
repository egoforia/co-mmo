import type { Character } from './rpg.ts';
import { facingSide, type Facing } from './walk.ts';

// Held items (milestone 10): a player's painted look stays as it is, and the
// weapon they wear, or else their charm, is shown in their right hand, and
// an off-hand item such as a shield in their left. Where the
// hand is in each walk frame, and where each item is gripped, is found once
// by a vision model from the painted pictures, never guessed in code.

/** A point in a picture or one frame of a strip, as fractions of its width and height. */
export type ArtPoint = readonly [x: number, y: number];

/** Where things are in a painted picture, found by looking at it. */
export interface ArtPoints {
  /** A look's or walk strip's right hand (where a weapon goes), one per frame (a still picture has one); null where none shows. */
  hands?: (ArtPoint | null)[];
  /** The left hand (where a shield or charm goes), frame by frame like `hands`. */
  leftHands?: (ArtPoint | null)[];
  /** Where an item is held: its handle, strap or chain. */
  grip?: ArtPoint;
}

/** A held item's longest side, as a share of its holder's height. */
export const HELD_SIZE = 0.42;

/**
 * Whether an item in this hand is drawn behind the body: walking away, or
 * facing the way that puts the hand on the far side (the right hand facing
 * left, the left hand facing right). Turned halfway, as in the isometric
 * ways, the far hand is the one on the side the walker turns towards.
 */
export function heldBehind(facing: Facing, hand: 'right' | 'left'): boolean {
  return facing === 'back' || facingSide(facing) === (hand === 'right' ? 'left' : 'right');
}

/** Points by art id, as the server serves them. */
export type ArtPointsManifest = Record<string, ArtPoints>;

/** The item a player shows in their right hand: their weapon, else their charm. */
export function heldItem(character: Pick<Character, 'equipment'>): string | undefined {
  return character.equipment.weapon ?? character.equipment.charm;
}

/** The item a player shows in their left hand: a shield, torch or other off-hand item. */
export function offHandItem(character: Pick<Character, 'equipment'>): string | undefined {
  return character.equipment.offhand;
}
