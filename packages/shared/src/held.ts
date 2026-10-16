import type { Character } from './rpg.ts';

// Held items (milestone 10): a player's painted look stays as it is, and the
// weapon they wear, or else their charm, is shown in their hand. Where the
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

/** Points by art id, as the server serves them. */
export type ArtPointsManifest = Record<string, ArtPoints>;

/** The item a player shows in their hand: their weapon, else their charm. */
export function heldItem(character: Pick<Character, 'equipment'>): string | undefined {
  return character.equipment.weapon ?? character.equipment.charm;
}
