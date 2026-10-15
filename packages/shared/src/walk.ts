// The hero walks in four directions, eight painted frames each. The server
// paints each direction's frames as one sheet from the hero's approved look;
// the client plays the sheet for the way the hero is walking.

/** Frames in one direction's walk, painted left to right in one strip. */
export const WALK_FRAMES = 8;

/** Frames shown each second while walking. */
export const WALK_FPS = 10;

/** The ways a hero can walk: towards the viewer, right, left and away. */
export const WALK_DIRECTIONS = ['front', 'right', 'left', 'back'] as const;
export type WalkDirection = (typeof WALK_DIRECTIONS)[number];

/** The approved player looks that have walk sheets. */
export const WALKING_LOOKS = ['player-mara', 'player-ilya'] as const;

/** Art id of a look's walk sheet for one direction. */
export function walkArt(look: string, direction: WalkDirection): string {
  return `${look}-walk-${direction}`;
}

/** Every walk sheet the game needs, for every walking look. */
export function walkArtIds(): string[] {
  return WALKING_LOOKS.flatMap((look) => WALK_DIRECTIONS.map((d) => walkArt(look, d)));
}

/**
 * Which way someone moving by (dx, dy) faces. Sideways wins on a diagonal,
 * so the hero turns the way the arrow keys point; standing still keeps the
 * way they faced before.
 */
export function walkDirection(dx: number, dy: number, before: WalkDirection = 'front'): WalkDirection {
  if (Math.abs(dx) > 1e-6) return dx > 0 ? 'right' : 'left';
  if (Math.abs(dy) > 1e-6) return dy > 0 ? 'front' : 'back';
  return before;
}
