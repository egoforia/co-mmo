// Body types for walking: a simple skeleton and its joint angles for each of
// the 8 steps of one walk. The server draws grey pose guides from them, which
// steer the image model when it paints a walk; players never see the guides.
// They are data, so a wish can add a body type.

/** Frames in one walk cycle. */
export const WALK_STEPS = 8;

/** The ways a walker can be seen walking: towards the viewer, right, away, left. */
export const WALK_VIEWS = ['front', 'right', 'back', 'left'] as const;
export type WalkView = (typeof WALK_VIEWS)[number];

/** A point on the body: x to the walker's own left, y up, z forward, in body units. */
export type RigPoint = readonly [x: number, y: number, z: number];

/** A body part that does not bend: a ball (head) or a capsule (torso, shell). */
export interface RigPart {
  id: string;
  from: RigPoint;
  /** A capsule's other end; a ball has none. */
  to?: RigPoint;
  radius: number;
  /** The part that faces forward (the head): guides mark its eyes so front and back views differ. */
  face?: boolean;
}

/** A leg or arm: two segments from an anchor, swung and bent per step. */
export interface RigLimb {
  id: string;
  anchor: RigPoint;
  lengths: readonly [upper: number, lower: number];
  /** Thickness of the limb. */
  radius: number;
  /** Degrees the limb splays outwards from straight down (a beetle's legs). */
  spread?: number;
  /** Degrees forward from straight down, per step. */
  swing: readonly number[];
  /** Degrees the lower segment folds back (legs) or forward (arms, `bendForward`), per step. */
  bend: readonly number[];
  bendForward?: boolean;
}

/** A kind of walker: its skeleton, its 8 steps, and how fast it walks. */
export interface BodyType {
  id: string;
  name: string;
  /** What the image model is told each step looks like. */
  steps: readonly string[];
  /** How far the body rises (+) or sinks (-) per step, in body units. */
  bob: readonly number[];
  parts: readonly RigPart[];
  limbs: readonly RigLimb[];
  /** Body units one whole cycle carries the walker forward. */
  stride: number;
  /** Frames a second at the game's normal walking speed. */
  fps: number;
}

/** Shifts a per-step track by half a cycle: the other side's leg or arm. */
const half = (track: readonly number[]) => track.map((_, i) => track[(i + WALK_STEPS / 2) % WALK_STEPS]!);
const scaled = (track: readonly number[], k: number) => track.map((v) => v * k);

// A storybook hero's left leg through one cycle: contact, down, passing, up
// while it carries the weight, then push off, lift, swing through, reach.
const LEG_SWING = [25, 15, 0, -15, -25, -10, 10, 25];
const LEG_BEND = [5, 20, 10, 5, 15, 50, 60, 25];
// Arms swing against the leg on the same side.
const ARM_SWING = scaled(LEG_SWING, -0.8);
const ARM_BEND = [15, 15, 15, 15, 15, 15, 15, 15];

// A six-legged walker moves three legs at a time (front and back on one side,
// middle on the other): lift, swing forward, touch down, then push back.
const TRIPOD_SWING = [-15, 0, 15, 10, 5, 0, -5, -10];
const TRIPOD_BEND = [40, 55, 20, 20, 20, 20, 20, 20];

/** The body types the game knows; wishes may add more. */
export const BODY_TYPES: Record<string, BodyType> = {
  'two-legged': {
    id: 'two-legged',
    name: 'Two-legged, 3 heads tall',
    steps: [
      'left foot forward, heel touching the ground, right foot behind, right arm forward',
      'body lowest, left foot flat taking the weight, right knee bent',
      'right leg swinging past the left leg, feet close together',
      'body highest, up on the left toe, right foot lifting forward',
      'right foot forward, heel touching the ground, left foot behind, left arm forward',
      'body lowest, right foot flat taking the weight, left knee bent',
      'left leg swinging past the right leg, feet close together',
      'body highest, up on the right toe, left foot lifting forward',
    ],
    bob: [0, -1.5, 0, 1.5, 0, -1.5, 0, 1.5],
    parts: [
      { id: 'torso', from: [0, 14, 0], to: [0, 25, 0], radius: 5.5 },
      { id: 'head', from: [0, 34, 0.5], radius: 9, face: true },
    ],
    limbs: [
      { id: 'left-leg', anchor: [3, 14, 0], lengths: [7, 7], radius: 2.4, swing: LEG_SWING, bend: LEG_BEND },
      { id: 'right-leg', anchor: [-3, 14, 0], lengths: [7, 7], radius: 2.4, swing: half(LEG_SWING), bend: half(LEG_BEND) },
      { id: 'left-arm', anchor: [6.5, 24, 0], lengths: [5, 5], radius: 1.8, swing: ARM_SWING, bend: ARM_BEND, bendForward: true },
      { id: 'right-arm', anchor: [-6.5, 24, 0], lengths: [5, 5], radius: 1.8, swing: half(ARM_SWING), bend: ARM_BEND, bendForward: true },
    ],
    stride: 24,
    fps: 10,
  },
  'six-legged': {
    id: 'six-legged',
    name: 'Six-legged crawler',
    steps: [
      'front-left, middle-right and back-left legs lifting, the other three planted',
      'those three legs swung forward in the air, body highest',
      'those three legs touching down ahead',
      'all six legs on the ground, body lowest',
      'front-right, middle-left and back-right legs lifting, the other three planted',
      'those three legs swung forward in the air, body highest',
      'those three legs touching down ahead',
      'all six legs on the ground, body lowest',
    ],
    bob: [0, 0.6, 0, -0.6, 0, 0.6, 0, -0.6],
    parts: [
      { id: 'shell', from: [0, 9, -6], to: [0, 9, 5], radius: 8 },
      { id: 'head', from: [0, 8, 11], radius: 4.5, face: true },
    ],
    limbs: [
      { id: 'front-left', anchor: [5, 6, 5], lengths: [5, 6], radius: 1.3, spread: 45, swing: TRIPOD_SWING, bend: TRIPOD_BEND },
      { id: 'middle-left', anchor: [6, 6, 0], lengths: [5, 6], radius: 1.3, spread: 50, swing: half(TRIPOD_SWING), bend: half(TRIPOD_BEND) },
      { id: 'back-left', anchor: [5, 6, -5], lengths: [5, 6], radius: 1.3, spread: 45, swing: TRIPOD_SWING, bend: TRIPOD_BEND },
      { id: 'front-right', anchor: [-5, 6, 5], lengths: [5, 6], radius: 1.3, spread: 45, swing: half(TRIPOD_SWING), bend: half(TRIPOD_BEND) },
      { id: 'middle-right', anchor: [-6, 6, 0], lengths: [5, 6], radius: 1.3, spread: 50, swing: TRIPOD_SWING, bend: TRIPOD_BEND },
      { id: 'back-right', anchor: [-5, 6, -5], lengths: [5, 6], radius: 1.3, spread: 45, swing: half(TRIPOD_SWING), bend: half(TRIPOD_BEND) },
    ],
    stride: 12,
    fps: 12,
  },
};

/** One posed limb: its three joints, from the anchor to the tip. */
export interface PosedLimb {
  id: string;
  joints: readonly [RigPoint, RigPoint, RigPoint];
  radius: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Where a segment of `length` ends, swung `swing` degrees forward and splayed `spread` degrees outwards. */
function reach(from: RigPoint, length: number, swing: number, spread: number, side: number): RigPoint {
  const out = Math.sin(rad(spread)) * length;
  const down = Math.cos(rad(spread)) * length;
  return [from[0] + side * out, from[1] - Math.cos(rad(swing)) * down, from[2] + Math.sin(rad(swing)) * down];
}

/** The body's parts and limbs at one step of its walk, in body units. */
export function poseAt(body: BodyType, step: number): { parts: RigPart[]; limbs: PosedLimb[] } {
  const i = ((step % WALK_STEPS) + WALK_STEPS) % WALK_STEPS;
  const lift = body.bob[i] ?? 0;
  const up = (p: RigPoint): RigPoint => [p[0], p[1] + lift, p[2]];
  const parts = body.parts.map((p) => ({ ...p, from: up(p.from), to: p.to && up(p.to) }));
  const limbs = body.limbs.map((limb) => {
    const side = Math.sign(limb.anchor[0]) || 1;
    const swing = limb.swing[i] ?? 0;
    const bend = (limb.bend[i] ?? 0) * (limb.bendForward ? 1 : -1);
    const spread = limb.spread ?? 0;
    const a = up(limb.anchor);
    const b = reach(a, limb.lengths[0], swing, spread, side);
    const c = reach(b, limb.lengths[1], swing + bend, spread, side);
    return { id: limb.id, joints: [a, b, c] as const, radius: limb.radius };
  });
  return { parts, limbs };
}

/** How much a top-down three-quarter view tilts depth into screen height. */
const TILT = 0.35;

/**
 * Where a body point lands on screen in a view, in body units (x right, y
 * down), and how near the viewer it is (bigger is nearer, drawn on top).
 */
export function project(p: RigPoint, view: WalkView): { x: number; y: number; depth: number } {
  const [x, y, z] = p;
  switch (view) {
    case 'front':
      return { x, y: -y + z * TILT, depth: z };
    case 'back':
      return { x: -x, y: -y - z * TILT, depth: -z };
    case 'right':
      return { x: z, y: -y + x * TILT, depth: x };
    case 'left':
      return { x: -z, y: -y - x * TILT, depth: -x };
  }
}
