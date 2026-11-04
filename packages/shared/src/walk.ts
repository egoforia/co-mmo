import { PLAYER_SPEED } from './constants.ts';

// Walks are painted as a short video from a look's view in each direction;
// the server keeps one cycle's frames as a strip and the client plays it at a
// rate matched to how fast the walker moves, so feet keep pace with the ground.

/**
 * How tall a person's or player's figure is drawn, hat and hair included,
 * standing or walking, so everyone stands the same size whatever sticks out
 * sideways (a wide hat, a flying scarf): pictures grow wider instead.
 */
export const CHARACTER_HEIGHT = 168;

/**
 * Canonical height tiers for creatures relative to player CHARACTER_HEIGHT (168px),
 * from docs/art-pipeline.md and Style Bible v3.
 */
export const CREATURE_HEIGHTS = {
  tiny: 64,
  small: 112,
  medium: 168,
  high: 224,
  colossal: 320,
} as const;
export type CreatureSizeTier = keyof typeof CREATURE_HEIGHTS;

/** Frames kept from one walk cycle when a body type does not say. */
export const WALK_FRAMES = 12;

/** Seconds one walk cycle takes at the player's speed when a body type does not say. */
export const WALK_CYCLE_SECONDS = 0.6;

/**
 * The ways a walker faces in the isometric camera (the camera plan of
 * 2026-10-18): turned halfway between the front or back and a side, which
 * lines them up with the grid. Front-left faces south, front-right east,
 * back-left west and back-right north. Walks are painted as video, which
 * is made for them only when the Owner asks in the Art tab, so until then
 * a walker glides in their standing pictures.
 */
export const ISO_WAYS = ['front-left', 'front-right', 'back-left', 'back-right'] as const;
export type IsoWay = (typeof ISO_WAYS)[number];

/**
 * Clockwise rotational turntable order used by diffusion turnaround models:
 * Col 0: front-left (-135°), Col 1: front-right (-45°), Col 2: back-right (+45°), Col 3: back-left (+135°).
 */
export const TURNTABLE_WAYS = ['front-left', 'front-right', 'back-right', 'back-left'] as const;

/**
 * Every way a walker faces, walks and is painted standing: the isometric
 * ways. The top-down ways (front, right, back, left) were retired with the
 * isometric camera (the Owner, 2026-11-03).
 */
export const FACINGS = ISO_WAYS;
export type Facing = IsoWay;

/** The grid step each isometric way faces along. */
export const ISO_WAY_STEPS: Record<IsoWay, { dx: number; dy: number }> = {
  'front-left': { dx: 0, dy: 1 },
  'front-right': { dx: 1, dy: 0 },
  'back-left': { dx: -1, dy: 0 },
  'back-right': { dx: 0, dy: -1 },
};

/** True for any way a walker can face. */
export function isFacing(facing: string): facing is Facing {
  return (FACINGS as readonly string[]).includes(facing);
}

/** Which side of the picture a walker facing this way looks towards. */
export function facingSide(facing: Facing): 'left' | 'right' {
  return facing.endsWith('-left') ? 'left' : 'right';
}

/** The way a walker faces after turning to the other side: an isometric way's mirror image. */
export const TURNED: Record<Facing, Facing> = { 'front-left': 'front-right', 'front-right': 'front-left', 'back-left': 'back-right', 'back-right': 'back-left' };

/** The approved player looks that have walks. */
export const WALKING_LOOKS = ['player-mara', 'player-ilya'] as const;

/** Art id of a look's walk strip for one way, once its walk is made. */
export function walkArt(look: string, direction: Facing): string {
  return `${look}-walk-${direction}`;
}

/** Art id of a look's standing picture facing one way, shown while it has no walk that way. */
export function walkStandArt(look: string, direction: Facing): string {
  return `${look}-stand-${direction}`;
}

/** The moving pictures a walker has one of for each way it faces. */
export type Moving = 'walk' | 'run' | 'attack' | 'stand';

/** An animated strip kind that a walker can play across the four isometric ways. */
export type AnimationKind = 'walk' | 'run' | 'attack';

export interface AnimationKindDef {
  id: AnimationKind;
  label: string;
  field: 'walks' | 'runs' | 'attacks';
  defaultFrames: number;
  defaultCycleSeconds: number;
}

/** Registry of all walker animation strip kinds, so UI and server tools stay extensible. */
export const ANIMATION_KINDS: readonly AnimationKindDef[] = [
  { id: 'walk', label: 'Walk', field: 'walks', defaultFrames: WALK_FRAMES, defaultCycleSeconds: WALK_CYCLE_SECONDS },
  { id: 'run', label: 'Run', field: 'runs', defaultFrames: 10, defaultCycleSeconds: 0.67 },
  { id: 'attack', label: 'Attack', field: 'attacks', defaultFrames: 12, defaultCycleSeconds: 0.8 },
] as const;

/** Art id of a walker's animation strip (`walk`, `run`, `attack`) for one isometric way. */
export function animationArt(look: string, kind: AnimationKind, direction: Facing): string {
  return `${look}-${kind}-${direction}`;
}

const MOVING = /^(.+?)-(walk|run|attack|stand)-(.+)$/;

/**
 * Whose walk, run, attack or standing picture an art id is, and which way it
 * faces: `bramble-ursine-run-back-left` is bramble-ursine's run facing
 * back-left. None for any other art id, or one facing a retired way.
 */
export function movingArt(id: string): { look: string; noun: Moving; facing: Facing } | undefined {
  const m = MOVING.exec(id);
  return m && isFacing(m[3]!) ? { look: m[1]!, noun: m[2] as Moving, facing: m[3] } : undefined;
}

/**
 * True for a walk, run, attack or standing picture facing a way no walker
 * faces any more (`player-mara-walk-front`): painted for the top-down
 * camera, kept on disk but no longer shown or looked at.
 */
export function isRetiredArt(id: string): boolean {
  return MOVING.test(id) && !movingArt(id);
}

/**
 * Frames a second for a walk strip, so one cycle lasts `cycleSeconds` at the
 * player's speed and speeds up or slows down with the walker.
 */
export function walkFrameRate(frames = WALK_FRAMES, speed = PLAYER_SPEED, cycleSeconds = WALK_CYCLE_SECONDS): number {
  return (frames / cycleSeconds) * (speed / PLAYER_SPEED);
}
