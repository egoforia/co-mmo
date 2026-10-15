import sharp from 'sharp';
import { parseJsonObject, type ChatModel } from '../ai/chat.ts';

// The automated style check (design doc, Art style: "5. Automated style
// check"). Free checks on the pixels run first; then, when a judge model is
// set, a vision model compares the picture with the anchors and the wish.
// A picture that fails is painted again with what went wrong; the design
// doc's image-embedding similarity is left to the judge, which sees the
// anchors itself.

/** What the style check made of one picture. */
export interface StyleVerdict {
  pass: boolean;
  /** What went wrong, in plain words, when it failed. */
  why?: string;
  /** What the judge cost, in US dollars (0 when only free checks ran). */
  usd: number;
}

/** Shares of a picture's pixels, used by the free checks. */
export interface PixelStats {
  /** Of the whole picture: how much is subject (not cut-out background). */
  subject: number;
  /** Of the picture's outer edge: how much is subject (a subject cut off by the frame). */
  edge: number;
  /** Of the subject: leftover magenta from the background. */
  magenta: number;
  /** Of the subject: near pure black, near pure white, and neon (Style Bible: none of these). */
  black: number;
  white: number;
  neon: number;
}

/** Counts what the free checks look at in a cut-out picture (transparent background). */
export async function pixelStats(png: Buffer): Promise<PixelStats> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let subject = 0, edge = 0, edges = 0, magenta = 0, black = 0, white = 0, neon = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const solid = data[i + 3]! > 128;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        edges++;
        if (solid) edge++;
      }
      if (!solid) continue;
      subject++;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (r > 200 && b > 200 && g < 90) magenta++;
      if (max < 18) black++;
      if (min > 245) white++;
      if (max > 245 && (max - min) / max > 0.9) neon++;
    }
  }
  const of = (n: number, total: number) => (total ? n / total : 0);
  return { subject: of(subject, w * h), edge: of(edge, edges), magenta: of(magenta, subject), black: of(black, subject), white: of(white, subject), neon: of(neon, subject) };
}

/**
 * Format and palette checks that cost nothing: the background came out plain
 * and was cut away, the subject is whole and fills enough of the frame, and
 * its colours keep to the Style Bible (no large areas of pure black, pure
 * white or neon). Limits are loose on purpose: they catch broken pictures,
 * not taste, which is the judge's job.
 */
export async function freeChecks(cutOut: Buffer, plainBackground: boolean): Promise<{ pass: boolean; why?: string }> {
  if (!plainBackground) return { pass: false, why: 'the background was not one plain colour, so it could not be cut away cleanly' };
  const s = await pixelStats(cutOut);
  if (s.subject < 0.02) return { pass: false, why: 'the picture came out nearly empty' };
  if (s.subject > 0.9) return { pass: false, why: 'the subject fills the whole frame with no background around it' };
  if (s.edge > 0.05) return { pass: false, why: 'the subject is cut off by the edge of the picture' };
  if (s.magenta > 0.02) return { pass: false, why: 'magenta from the background is left inside the subject' };
  if (s.black > 0.3) return { pass: false, why: 'large areas are pure black, which the Style Bible rules out' };
  if (s.white > 0.3) return { pass: false, why: 'large areas are pure white, which the Style Bible rules out' };
  if (s.neon > 0.25) return { pass: false, why: 'the colours are neon bright, which the Style Bible rules out' };
  return { pass: true };
}

/** What the judge is told: lenient on taste, strict on the things that break the game's look. */
export const JUDGE_SYSTEM = [
  'You check game art for a hand-painted 2D fantasy RPG.',
  'The first pictures are approved reference sprites that set the style. The last picture is a new sprite to check.',
  'Answer two questions about the new sprite:',
  '1. subject: does it show the thing described (its kind and its most recognisable feature)? Small differences in detail are fine.',
  '2. style: does it look like it belongs with the references: hand-painted with soft brush shading, warm light, the same kind of view and outline?',
  'Fail style only for clear problems: a photo or 3D render look, anime cel shading, flat vector art, writing or letters, several subjects or a sprite sheet, or scenery behind the subject.',
  'Reply with JSON: {"subject": true or false, "style": true or false, "problem": "one short plain sentence, empty when both are true"}.',
].join('\n');

/**
 * Asks a vision model whether a picture shows its subject in the anchors'
 * style. A model that cannot answer passes the picture: the check must
 * never stop a wish from getting its art.
 */
export async function judgePicture(
  model: ChatModel,
  picture: Buffer,
  references: Buffer[],
  subject: string,
): Promise<StyleVerdict> {
  // Transparent pixels read as black to some models; show the sprite on a soft grey, as the references are.
  const flat = (png: Buffer) => sharp(png).flatten({ background: { r: 200, g: 200, b: 200 } }).png().toBuffer();
  const images = [...(await Promise.all(references.map(flat))), await flat(picture)].map((data) => ({ mimeType: 'image/png', data }));
  try {
    const result = await model.complete({
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: `The new sprite should show: ${subject}`, images }],
      json: true,
      // Room for thinking models, which spend output tokens before they answer.
      maxTokens: 2000,
    });
    const answer = parseJsonObject(result.text);
    if (!answer) return { pass: true, usd: result.usd };
    const pass = answer.subject !== false && answer.style !== false;
    const problem = typeof answer.problem === 'string' ? answer.problem.trim().replace(/[.!]+$/, '').slice(0, 200) : '';
    const why = pass ? undefined : problem || (answer.subject === false ? 'it does not show what was wished for' : 'it does not match the game\'s painted style');
    return { pass, ...(why ? { why: why.charAt(0).toLowerCase() + why.slice(1) } : {}), usd: result.usd };
  } catch (err) {
    console.error('The style check could not ask its judge:', (err as Error).message);
    return { pass: true, usd: 0 };
  }
}

/** The line added to a prompt when painting again after a failed check. */
export function retryNote(why: string): string {
  return `An earlier attempt was turned down because ${why}. Paint it again and avoid that.`;
}
