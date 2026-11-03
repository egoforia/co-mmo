import sharp from 'sharp';
import type { ArtPoint, Facing } from '@co-mmo/shared';
import { parseJsonObject, type ChatModel } from '../ai/chat.ts';

// Finding one point in a painted picture with a vision model: where a
// walker's free hand is in each walk frame, and where an item is gripped.
// Gemini answers points as [y, x] from 0 to 1000, its own convention.

const SYSTEM = [
  'You locate things in game sprites.',
  'Reply with JSON {"point": [y, x]}, y and x from 0 to 1000 across the picture (0,0 is the top left), or {"point": null} when it cannot be seen.',
].join('\n');

/**
 * Finds both of the character's hands in a walker's picture or walk frame:
 * the right hand holds a weapon, the left a shield or charm. Models mix up
 * the character's right with the picture's, and asked for "the right hand"
 * they point at whichever hand is in front; so the hands are asked for by
 * where they are in the picture and told apart from those. Turned halfway,
 * as in the isometric ways, they are near and far: turned to the right, the
 * right hand is the near one. A look's own picture faces us, so its hands
 * are the picture's left and right, the right hand on the picture's left.
 */
export async function findHands(model: ChatModel, picture: Buffer, facing: HandView, question = HAND_QUESTIONS[facing]): Promise<BothHands & { usd: number }> {
  const result = await model.complete({
    system: handSystem(facing),
    purpose: 'Finding hands',
    messages: [{ role: 'user', content: question, images: [{ mimeType: 'image/png', data: await enlarged(picture) }] }],
    json: true,
    maxTokens: 2000,
  });
  const answer = parseJsonObject(result.text);
  const right = pointOf(answer?.[RIGHT_HAND_KEY[facing]]);
  const left = pointOf(answer?.[LEFT_HAND_KEY[facing]]);
  return { ...(right ? { right } : {}), ...(left ? { left } : {}), usd: result.usd };
}

/** The character's two hands in one picture, where they were found. */
export interface BothHands {
  right?: ArtPoint;
  left?: ArtPoint;
}

/**
 * Both hands through a walk, frame by frame. Walks are turned halfway, where
 * the hands cross in front of and behind the body as it walks, so each
 * frame's answer is kept as it is: never swapped to match its neighbours.
 */
export function steadyHands(frames: BothHands[]): { right: (ArtPoint | null)[]; left: (ArtPoint | null)[] } {
  return { right: frames.map((f) => f.right ?? null), left: frames.map((f) => f.left ?? null) };
}

/**
 * Hands found in one walk, as they would be in the walk turned to the other
 * side (front-left and front-right): turning is a mirror
 * across the picture, and each hand stays the same hand. Frames are matched
 * by their place in the step, so walks of different lengths still line up.
 */
export function mirroredHands(hands: readonly (ArtPoint | null)[] | undefined, frames: number): (ArtPoint | null)[] {
  if (!hands?.length) return Array.from({ length: frames }, () => null);
  return Array.from({ length: frames }, (_, i) => {
    const hand = hands[Math.floor((i * hands.length) / frames)];
    return hand ? [round(1 - hand[0]), hand[1]] : null;
  });
}

export type { Facing };

/** What a hand question is asked about: a walk or standing picture turned one way, or a look's own picture, which faces us. */
export type HandView = Facing | 'look';

/** Every hand question, in the order God's View lists them. */
export const HAND_VIEWS: readonly HandView[] = ['look', 'front-left', 'front-right', 'back-left', 'back-right'];

/** Turned halfway, both hands may show; the far one is partly behind the body. */
const HALFWAY = 'Point to both of the character\'s hands. The character is turned halfway between facing straight at us (or away) and side-on. "near" is the hand on the side nearer to us; "far" is the hand on the far side, partly behind the body: if it is hidden, point to where it must be behind the body. Look at the arms, not the legs.';

/** The usual question for a look's picture and each way a walker faces; the Owner can word them differently in God's View. */
export const HAND_QUESTIONS: Record<HandView, string> = {
  look: 'Point to both of the character\'s hands. "left" is the hand on the LEFT side of the picture, "right" the hand on the RIGHT side of the picture. Look at the arms, not the legs: follow each arm from the shoulder down to its hand, even when it swings in front of the body.',
  'front-left': HALFWAY,
  'front-right': HALFWAY,
  'back-left': HALFWAY,
  'back-right': HALFWAY,
};

/** The answers that are the character's own right and left hands, for each way it faces: turned to the left, the right hand is the far one. */
export const RIGHT_HAND_KEY: Record<HandView, string> = { look: 'left', 'front-left': 'far', 'front-right': 'near', 'back-left': 'far', 'back-right': 'near' };
export const LEFT_HAND_KEY: Record<HandView, string> = { look: 'right', 'front-left': 'near', 'front-right': 'far', 'back-left': 'near', 'back-right': 'far' };

/** The fixed part of a hand question: the shape of the answer. */
export function handSystem(facing: HandView): string {
  return [
    'You locate things in game sprites.',
    `Reply with JSON ${facing === 'look' ? '{"left": [y, x], "right": [y, x]}' : '{"near": [y, x], "far": [y, x]}'}, y and x from 0 to 1000 across the picture (0,0 is the top left); null for a hand you cannot place.`,
  ].join('\n');
}

/** Bumped when the questions change, so every picture is looked at again. */
export const POINTS_VERSION = 4;
/** What is asked for in an item's picture. */
export const GRIP = 'where a hand would hold it: the middle of its handle, hilt, grip, strap or chain';

/**
 * The point, as fractions of the picture's width and height, and what
 * asking cost. Undefined when the model says it cannot see one or answers
 * nonsense; an error is thrown, so the caller can try again later.
 */
export async function findPoint(model: ChatModel, picture: Buffer, what: string): Promise<{ point?: ArtPoint; usd: number }> {
  const shown = await enlarged(picture);
  const result = await model.complete({
    system: SYSTEM,
    purpose: 'Finding hands',
    messages: [{ role: 'user', content: `Point to ${what}.`, images: [{ mimeType: 'image/png', data: shown }] }],
    json: true,
    // Room for thinking models, which spend output tokens before they answer.
    maxTokens: 2000,
  });
  const point = pointOf(parseJsonObject(result.text)?.point);
  return { ...(point ? { point } : {}), usd: result.usd };
}

/** Enlarged and on soft grey, as the judge sees sprites: small frames point better when bigger. */
async function enlarged(picture: Buffer): Promise<Buffer> {
  const meta = await sharp(picture).metadata();
  return sharp(picture)
    .flatten({ background: { r: 200, g: 200, b: 200 } })
    .resize({ width: Math.max(meta.width ?? 0, 512), kernel: 'nearest', withoutEnlargement: false })
    .png()
    .toBuffer();
}

/** A model's [y, x] out of 1000 as fractions [x, y], or undefined when it is not a point on the picture. */
function pointOf(point: unknown): ArtPoint | undefined {
  if (!Array.isArray(point) || point.length !== 2) return undefined;
  const [y, x] = point.map(Number) as [number, number];
  if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)) return undefined;
  return [round(x / 1000), round(y / 1000)];
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** The frames of a walk strip laid side by side, each its own picture. */
export async function stripFrames(strip: Buffer, frames: number): Promise<Buffer[]> {
  const { width = 0, height = 0 } = await sharp(strip).metadata();
  const w = Math.floor(width / frames);
  return Promise.all(Array.from({ length: frames }, (_, i) => sharp(strip).extract({ left: i * w, top: 0, width: w, height }).png().toBuffer()));
}
