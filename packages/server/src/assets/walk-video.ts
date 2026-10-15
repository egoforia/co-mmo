import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { WalkDirection } from '@co-mmo/shared';
import { removeKeyBackground, removeKeySpill } from './postprocess.ts';
import { countFigures, cutFigures } from './walk-frames.ts';
import { BASE_PROMPT, KEY_COLOR, NEGATIVE_PROMPT } from './style.ts';

// Walks painted as video: the image model paints a look standing in each
// direction, a video model makes that picture walk in place and come back to
// it, and one walk cycle is cut out of the clip. Every frame comes from the
// same clip, so the walker keeps one look, one size and one grip on what they
// carry, which pictures painted one at a time never managed.

/** Size of the clip's frames; the walker stands in the middle. */
export const VIDEO_FRAME = { width: 1280, height: 720 };
const FIGURE_HEIGHT = 520;
const FOOT_MARGIN = 80;

/** Something a look carries, by the wearer's own side, so each view knows whether it is near or far. */
export interface Carried {
  item: string;
  side: 'right' | 'left' | 'back';
}

/** What the walking looks carry; a wished look adds its own line. */
export const LOOK_GEAR: Record<string, Carried[]> = {
  'player-mara': [{ item: 'crooked wooden staff with a sprouting leaf', side: 'right' }],
  'player-ilya': [{ item: 'short sword at the hip', side: 'left' }, { item: 'round shield', side: 'back' }],
};

const SEEN: Record<WalkDirection, string> = {
  front: 'facing the viewer, seen from the front',
  right: 'facing right, seen exactly side-on: the face in profile points to the RIGHT edge of the picture and we see their left side',
  back: 'facing away from the viewer, seen from behind, the face hidden',
  left: 'facing left, seen exactly side-on: the face in profile points to the LEFT edge of the picture and we see their right side',
};

/**
 * Where each carried item shows in a view, item by item. Rules about "their
 * left side" in general fail; naming each item and saying in front of or
 * behind the body works.
 */
export function gearPlacement(gear: Carried[], direction: WalkDirection): string {
  const where = (g: Carried): string => {
    if (g.side === 'back') return direction === 'back' ? `the ${g.item} is fully seen on the back` : `the ${g.item} peeks out behind the body`;
    if (direction === 'front') return `the ${g.item} is on the viewer's ${g.side === 'right' ? 'left' : 'right'}`;
    if (direction === 'back') return `the ${g.item} is on the viewer's ${g.side}`;
    const near = (direction === 'right') === (g.side === 'left');
    return near
      ? `the ${g.item} is on the near side, IN FRONT of the body, fully visible`
      : `the ${g.item} is on the far side, BEHIND the body, mostly hidden`;
  };
  return gear.length ? `In this view: ${gear.map(where).join('; ')}.` : '';
}

/** The prompt for painting a look standing still in one direction, from its front-facing reference. */
export function viewPrompt(name: string, gear: Carried[], direction: WalkDirection): string {
  return [
    BASE_PROMPT,
    `Paint ${name} from the reference image alone, full body, standing in a relaxed pose, ${SEEN[direction]}. Copy exactly how they look: face, hair, clothes, colours, proportions and what they carry.`,
    gearPlacement(gear, direction),
    `Exactly one figure, centred, with wide empty margin all around. Background: one flat pure magenta (${KEY_COLOR.hex}), with no floor or shadow. No magenta in the character.`,
    `Avoid: ${[...NEGATIVE_PROMPT, 'second figure', 'turnaround sheet', 'cast shadow'].join(', ')}.`,
  ].filter(Boolean).join('\n');
}

/** The prompt that makes a standing picture walk in place and come back to the same pose. */
export function walkVideoPrompt(gear: Carried[], direction: WalkDirection, body = 'two-legged'): string {
  const facing = direction === 'front' ? 'towards the viewer' : direction === 'back' ? 'away from the viewer' : `to the ${direction}, seen exactly side-on`;
  // A crawler has no arms to swing; its legs move in turns instead.
  const gait = body === 'two-legged' ? 'a brisk, cheerful walk with clear alternating steps and arms swinging' : 'a steady scuttle with its legs stepping in clear alternating sets';
  return [
    `2D hand-painted storybook game character animation. The character from the image walks in place ${facing}, like on a treadmill: ${gait}.`,
    gear.length ? `Everything they carry stays in the same hand and on the same side of the body as in the image, held steady at the same angle. ${gearPlacement(gear, direction)}` : '',
    'The camera is completely still: no zoom, no pan. The character stays in the centre of the picture at the same size and never turns.',
    'The background stays one flat, even, pure magenta colour the whole time, with no floor, shadow, scenery or lighting change. Only this one character, no one else. No text. Keep the painted look of the image.',
  ].filter(Boolean).join(' ');
}

/**
 * The one figure in a picture painted on magenta, cut out and trimmed. Bits
 * of a neighbour at the picture's edge are dropped; a second whole figure
 * fails, in plain words, since a video would animate it too.
 */
export async function soleFigure(painted: Buffer): Promise<Buffer> {
  const { png } = await removeKeyBackground(await sharp(painted).png().toBuffer(), undefined, { holes: true });
  const clean = await removeKeySpill(png);
  const count = await countFigures(clean);
  if (count !== 1) throw new Error(`The picture shows ${count} figures instead of one.`);
  const [figure] = await cutFigures(clean, { count: 1, dropEdgeBits: true });
  return figure!.png;
}

/** The clip's first and last picture: the figure standing in the middle of a magenta frame. */
export async function startFrame(figure: Buffer): Promise<Buffer> {
  const sized = await sharp(figure).resize({ height: FIGURE_HEIGHT }).png().toBuffer();
  const { width = 0 } = await sharp(sized).metadata();
  return sharp({ create: { ...VIDEO_FRAME, channels: 3, background: KEY_COLOR.hex } })
    .composite([{ input: sized, left: Math.round((VIDEO_FRAME.width - width) / 2), top: VIDEO_FRAME.height - FIGURE_HEIGHT - FOOT_MARGIN }])
    .removeAlpha()
    .png()
    .toBuffer();
}

/** Every frame of an MP4 as a PNG, in order, using ffmpeg. */
export async function videoFrames(mp4: Buffer): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), 'walk-'));
  try {
    await writeFile(join(dir, 'clip.mp4'), mp4);
    await promisify(execFile)('ffmpeg', ['-loglevel', 'error', '-i', join(dir, 'clip.mp4'), join(dir, 'f%04d.png')]).catch((err: NodeJS.ErrnoException) => {
      throw new Error(err.code === 'ENOENT' ? 'ffmpeg is not installed, so walks cannot be cut from video.' : `ffmpeg could not read the clip: ${err.message}`);
    });
    const names = (await readdir(dir)).filter((n) => n.endsWith('.png')).sort();
    return Promise.all(names.map((n) => readFile(join(dir, n))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface Cycle {
  /** Frames one whole cycle takes in the clip. */
  period: number;
  /** The clip frame the cycle starts on. */
  start: number;
  /** The clip frames kept, evenly spaced through the cycle. */
  picks: number[];
}

/**
 * Finds one walk cycle in a clip of `total` frames: the gap after which the
 * pictures come back the closest (`difference` between two frames), skipping
 * the still pose at both ends, then `count` frames spread evenly through it.
 */
export function findCycle(total: number, difference: (a: number, b: number) => number, count: number, { skip = 24, shortest = 12, longest = 48 } = {}): Cycle {
  const lo = Math.min(skip, Math.floor(total / 4)), hi = total - lo;
  let period = shortest, best = Infinity;
  for (let p = shortest; p <= Math.min(longest, hi - lo - 1); p++) {
    let sum = 0, n = 0;
    for (let i = lo; i + p < hi; i += 2) { sum += difference(i, i + p); n++; }
    if (n && sum / n < best) { best = sum / n; period = p; }
  }
  let start = lo, closest = Infinity;
  for (let i = lo; i + period < hi; i++) {
    const d = difference(i, i + period);
    if (d < closest) { closest = d; start = i; }
  }
  return { period, start, picks: Array.from({ length: count }, (_, k) => start + Math.round((k * period) / count)) };
}

/** Small grey pictures of the middle of each frame, where the walker is, for comparing frames cheaply. */
async function thumbs(frames: Buffer[]): Promise<Buffer[]> {
  return Promise.all(frames.map(async (f) => {
    const { width = 0, height = 0 } = await sharp(f).metadata();
    const middle = { left: Math.round(width / 4), top: 0, width: Math.round(width / 2), height };
    return sharp(f).extract(middle).resize(64, 72, { fit: 'fill' }).greyscale().raw().toBuffer();
  }));
}

/** One cycle of `count` walk frames cut out of a clip's frames: transparent, trimmed figures. */
export async function walkFromFrames(frames: Buffer[], count: number): Promise<{ figures: Buffer[]; cycle: Cycle }> {
  const small = await thumbs(frames);
  const difference = (a: number, b: number) => {
    let sum = 0;
    for (let k = 0; k < small[a]!.length; k++) sum += Math.abs(small[a]![k]! - small[b]![k]!);
    return sum / small[a]!.length;
  };
  const cycle = findCycle(frames.length, difference, count);
  const figures = await Promise.all(cycle.picks.map((i) => soleFigure(frames[i]!)));
  return { figures, cycle };
}
