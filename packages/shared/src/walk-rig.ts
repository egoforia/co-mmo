// Body types for walking: how many frames a painted walk keeps and how long
// one cycle takes. They are data, so a wish can add a body type.

/** A kind of walker: how smooth and how fast its walk is. */
export interface BodyType {
  id: string;
  name: string;
  /** Frames kept from a painted walk cycle, the animation's smoothness. */
  frames: number;
  /** Seconds one whole cycle takes at the player's walking speed. */
  cycleSeconds: number;
}

/** The body types the game knows; wishes may add more. */
export const BODY_TYPES: Record<string, BodyType> = {
  'two-legged': { id: 'two-legged', name: 'Two-legged, 3 heads tall', frames: 12, cycleSeconds: 0.6 },
  'six-legged': { id: 'six-legged', name: 'Six-legged crawler', frames: 12, cycleSeconds: 0.5 },
};
