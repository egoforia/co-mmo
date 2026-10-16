import sharp from 'sharp';
import type { ArtPoint } from '@co-mmo/shared';
import { parseJsonObject, type ChatModel } from '../ai/chat.ts';

// Finding one point in a painted picture with a vision model: where a
// walker's free hand is in each walk frame, and where an item is gripped.
// Gemini answers points as [y, x] from 0 to 1000, its own convention.

const SYSTEM = [
  'You locate things in game sprites.',
  'Reply with JSON {"point": [y, x]}, y and x from 0 to 1000 across the picture (0,0 is the top left), or {"point": null} when it cannot be seen.',
].join('\n');

/**
 * What is asked for in a walker's picture or walk frame: the centre of the
 * character's own right hand, where a held item goes. Asking for "the free
 * hand" let the model pick either hand frame by frame, so the item jumped
 * between hands; so the question names the hand and says where it shows in
 * this view, since a model easily mixes up the character's right with the
 * picture's right.
 */
export function handQuestion(facing: 'front' | 'back' | 'left' | 'right'): string {
  const where = {
    front: "The character faces us, so their right hand is on the LEFT side of the picture.",
    back: "We see the character from behind, so their right hand is on the RIGHT side of the picture.",
    right: 'The character faces the right edge of the picture, so we see their right side: their right hand is the one nearer to us, in front of the body.',
    left: 'The character faces the left edge of the picture, so we see their left side: their right hand is on the far side, partly or wholly behind the body. If it is hidden, point to where it must be behind the body.',
  }[facing];
  return `the centre of the character's own RIGHT hand (not the left hand). ${where}`;
}

/** Bumped when the questions change, so every picture is looked at again. */
export const POINTS_VERSION = 2;
/** What is asked for in an item's picture. */
export const GRIP = 'where a hand would hold it: the middle of its handle, hilt, grip, strap or chain';

/**
 * The point, as fractions of the picture's width and height, and what
 * asking cost. Undefined when the model says it cannot see one or answers
 * nonsense; an error is thrown, so the caller can try again later.
 */
export async function findPoint(model: ChatModel, picture: Buffer, what: string): Promise<{ point?: ArtPoint; usd: number }> {
  // Enlarged and on soft grey, as the judge sees sprites: small frames point better when bigger.
  const meta = await sharp(picture).metadata();
  const shown = await sharp(picture)
    .flatten({ background: { r: 200, g: 200, b: 200 } })
    .resize({ width: Math.max(meta.width ?? 0, 512), kernel: 'nearest', withoutEnlargement: false })
    .png()
    .toBuffer();
  const result = await model.complete({
    system: SYSTEM,
    purpose: 'Finding hands',
    messages: [{ role: 'user', content: `Point to ${what}.`, images: [{ mimeType: 'image/png', data: shown }] }],
    json: true,
    // Room for thinking models, which spend output tokens before they answer.
    maxTokens: 2000,
  });
  const point = parseJsonObject(result.text)?.point;
  if (!Array.isArray(point) || point.length !== 2) return { usd: result.usd };
  const [y, x] = point.map(Number) as [number, number];
  if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)) return { usd: result.usd };
  return { point: [round(x / 1000), round(y / 1000)], usd: result.usd };
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
