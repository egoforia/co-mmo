import { PLAYER_SPEED } from './constants.ts';
import { WALK_VIEWS, type WalkView } from './walk-rig.ts';

// Walks are painted as a short video from a look's view in each direction;
// the server keeps one cycle's frames as a strip and the client plays it at a
// rate matched to how fast the walker moves, so feet keep pace with the ground.

/**
 * How tall a person's or player's figure is drawn, hat and hair included,
 * standing or walking, so everyone stands the same size whatever sticks out
 * sideways (a wide hat, a flying scarf): pictures grow wider instead.
 */
export const CHARACTER_HEIGHT = 168;

/** Frames kept from one walk cycle when a body type does not say. */
export const WALK_FRAMES = 12;

/** Seconds one walk cycle takes at the player's speed when a body type does not say. */
export const WALK_CYCLE_SECONDS = 0.6;

/** The ways a walker can face: towards the viewer, right, away and left. */
export const WALK_DIRECTIONS = WALK_VIEWS;
export type WalkDirection = WalkView;

/** The approved player looks that have walks. */
export const WALKING_LOOKS = ['player-mara', 'player-ilya'] as const;

/** Art id of a look's walk strip for one direction. */
export function walkArt(look: string, direction: WalkDirection): string {
  return `${look}-walk-${direction}`;
}

/** Art id of a look's standing picture facing one direction, shown while it has no walk that way. */
export function walkStandArt(look: string, direction: WalkDirection): string {
  return `${look}-stand-${direction}`;
}

/** Every walk strip the game needs, for every walking look. */
export function walkArtIds(): string[] {
  return WALKING_LOOKS.flatMap((look) => WALK_DIRECTIONS.map((d) => walkArt(look, d)));
}

/**
 * Frames a second for a walk strip, so one cycle lasts `cycleSeconds` at the
 * player's speed and speeds up or slows down with the walker.
 */
export function walkFrameRate(frames = WALK_FRAMES, speed = PLAYER_SPEED, cycleSeconds = WALK_CYCLE_SECONDS): number {
  return (frames / cycleSeconds) * (speed / PLAYER_SPEED);
}

/**
 * Which way someone moving by (dx, dy) faces. Sideways wins on a diagonal,
 * so the walker turns the way the arrow keys point; standing still keeps the
 * way they faced before.
 */
export function walkDirection(dx: number, dy: number, before: WalkDirection = 'front'): WalkDirection {
  if (Math.abs(dx) > 1e-6) return dx > 0 ? 'right' : 'left';
  if (Math.abs(dy) > 1e-6) return dy > 0 ? 'front' : 'back';
  return before;
}
