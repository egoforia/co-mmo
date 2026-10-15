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

/** What is asked for in a walker's picture: the hand an item can be put in. */
export const HAND = "the centre of the character's free hand (the hand not holding anything); if both hands hold something or neither is free, the hand nearest the viewer";
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
