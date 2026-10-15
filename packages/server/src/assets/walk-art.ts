import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { WALKING_LOOKS, WALK_DIRECTIONS, WALK_FRAMES, walkArt, type ArtEntry, type WalkDirection } from '@co-mmo/shared';
import { ANCHORS } from './anchors.ts';
import { removeKeyBackground, removeKeySpill } from './postprocess.ts';
import type { GeneratedImage, ImageProvider } from './provider.ts';
import { ASSET_SIZES, BASE_PROMPT, KEY_COLOR, NEGATIVE_PROMPT } from './style.ts';

// Paints the hero's walk with the image model chosen in God's View: one
// sheet of eight frames per direction, painted from the approved look so the
// hero stays the same person. The game copy is one strip, frame after frame.

/** One walk sheet to paint. */
export interface WalkArtJob {
  id: string;
  /** The approved look it is painted from, sent as the reference. */
  look: string;
  direction: WalkDirection;
  prompt: string;
}

/** The painted sheet's layout: frames read left to right, then the next row. */
export const SHEET_COLUMNS = 4;
export const SHEET_ROWS = 2;

/** How each direction is seen. */
const VIEWS: Record<WalkDirection, string> = {
  front: 'walking towards the viewer, face and front of the body seen',
  right: 'walking to the right, seen side-on in profile facing right',
  left: 'walking to the left, seen side-on in profile facing left',
  back: 'walking away from the viewer, back of the body seen, face hidden',
};

/** The walk sheets every walking look needs, front first. */
export function walkArtJobs(): WalkArtJob[] {
  return WALKING_LOOKS.flatMap((look) => {
    const anchor = ANCHORS.find((a) => a.id === look);
    const who = anchor ? `${anchor.name}: ${anchor.silhouetteHook}; ${anchor.details?.join(', ') ?? ''}` : 'the hero';
    return WALK_DIRECTIONS.map((direction) => ({
      id: walkArt(look, direction),
      look,
      direction,
      prompt: [
        BASE_PROMPT,
        `The reference image is the hero, ${who}. Paint this same character, with the same clothes, colours and proportions, small and 3 heads tall.`,
        `A walk cycle sprite sheet: exactly ${WALK_FRAMES} frames of one smooth looping walk, arranged in a grid of ${SHEET_COLUMNS} columns and ${SHEET_ROWS} rows, read left to right, then the next row.`,
        `Every frame is the character ${VIEWS[direction]}, in three-quarter top-down view, the same size in every frame, the whole body inside its own cell with empty margin around it, feet at the same height.`,
        'Legs and arms swing step by step through the cycle: contact, passing, contact with the other foot, passing. No lines or borders between the frames.',
        `Background: one flat solid pure magenta (${KEY_COLOR.hex}) filling everything behind the character, with no floor, gradient, glow or shadow on it. No magenta anywhere in the character.`,
        `Avoid: ${[...NEGATIVE_PROMPT, 'grid lines', 'frame numbers', 'cast shadow', 'background scenery'].join(', ')}.`,
      ].join('\n'),
    }));
  });
}

/** Paints one walk sheet: asks the provider with the look as reference, keeps the raw image, writes the game copy. */
export async function paintWalkArt(
  job: WalkArtJob,
  provider: ImageProvider,
  dirs: { anchorDir: string; rawDir: string; outDir: string },
): Promise<{ image: GeneratedImage; entry: ArtEntry }> {
  const references: GeneratedImage[] = [];
  for (const path of [resolve(dirs.anchorDir, 'raw', `${job.look}.png`), resolve(dirs.anchorDir, `${job.look}.png`)]) {
    const data = await readFile(path).catch(() => undefined);
    if (!data) continue;
    references.push({ mimeType: 'image/png', data });
    break;
  }
  const image = await provider.generate({ prompt: job.prompt, references, aspectRatio: '16:9', size: '1K' });
  await mkdir(dirs.rawDir, { recursive: true });
  await writeFile(resolve(dirs.rawDir, `${job.id}.png`), await sharp(image.data).png().toBuffer());
  return { image, entry: await processWalkArt(job, image.data, dirs.outDir) };
}

/**
 * Turns a painted sheet into the game copy: the background removed, each of
 * the eight cells trimmed, all scaled alike to the player's size and set side
 * by side with the feet on the bottom row, so the hero neither grows nor
 * jumps between frames.
 */
export async function processWalkArt(job: WalkArtJob, raw: Buffer, outDir: string): Promise<ArtEntry> {
  const { png: keyed } = await removeKeyBackground(await sharp(raw).png().toBuffer(), undefined, { holes: true });
  const clean = await removeKeySpill(keyed);
  const { width = 0, height = 0 } = await sharp(clean).metadata();
  const cellW = Math.floor(width / SHEET_COLUMNS);
  const cellH = Math.floor(height / SHEET_ROWS);
  const frames: { data: Buffer; width: number; height: number }[] = [];
  for (let i = 0; i < WALK_FRAMES; i++) {
    const cell = await sharp(clean)
      .extract({ left: (i % SHEET_COLUMNS) * cellW, top: Math.floor(i / SHEET_COLUMNS) * cellH, width: cellW, height: cellH })
      .png()
      .toBuffer();
    const { data: alpha } = await sharp(cell).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    if (!alpha.some((a) => a > 8)) throw new Error(`frame ${i + 1} of ${job.id} is empty`);
    const trimmed = await sharp(cell).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
    frames.push({ data: trimmed.data, width: trimmed.info.width, height: trimmed.info.height });
  }
  const box = ASSET_SIZES.player;
  const scale = Math.min(box.width / Math.max(...frames.map((f) => f.width)), box.height / Math.max(...frames.map((f) => f.height)));
  const composites = await Promise.all(frames.map(async (f, i) => {
    const w = Math.max(1, Math.round(f.width * scale));
    const h = Math.max(1, Math.round(f.height * scale));
    const input = await sharp(f.data).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
    return { input, left: i * box.width + Math.floor((box.width - w) / 2), top: box.height - h };
  }));
  const out = await sharp({ create: { width: box.width * WALK_FRAMES, height: box.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png()
    .toBuffer();
  const file = `${job.id}.png`;
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, file), out);
  return { file: `art/${file}`, kind: 'walk', width: box.width * WALK_FRAMES, height: box.height };
}
