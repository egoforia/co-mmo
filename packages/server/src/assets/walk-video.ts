import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { ISO_WAYS, heldBehind, isWalkDirection, type Facing, type IsoWay, type WalkDirection } from '@co-mmo/shared';
import { removeKeyBackground, removeKeySpill } from './postprocess.ts';
import { countFigures, cutFigures, type Box } from './walk-frames.ts';
import { KEY_COLOR } from './style.ts';
import { STYLE } from './style-profile.ts';

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
  // The walking looks carry nothing: their weapon or charm is drawn in hand by the game (held items).
};

const SEEN: Record<Facing, string> = {
  front: 'facing the viewer, seen from the front',
  right: 'facing right, seen exactly side-on: the face in profile points to the RIGHT edge of the picture and we see their left side',
  back: 'facing away from the viewer, seen from behind, the face hidden',
  left: 'facing left, seen exactly side-on: the face in profile points to the LEFT edge of the picture and we see their right side',
  // The isometric camera's ways: turned exactly halfway, which the model drifts away from unless told both ends.
  // "Turned to the left" reads as the figure's own left (the picture's right), so each is named by the
  // picture's corner and the nearer shoulder instead.
  'front-left': "in a three-quarter view from the front, facing the LOWER-LEFT corner of the picture: the nose, chest and toes point towards the viewer's left, exactly halfway between facing the viewer and a profile facing the left edge of the picture; their LEFT shoulder is nearer to us and their right shoulder further away",
  'front-right': "in a three-quarter view from the front, facing the LOWER-RIGHT corner of the picture: the nose, chest and toes point towards the viewer's right, exactly halfway between facing the viewer and a profile facing the right edge of the picture; their RIGHT shoulder is nearer to us and their left shoulder further away",
  'back-left': "in a three-quarter view from behind, facing the UPPER-LEFT corner of the picture: turned away from us and towards the viewer's left, exactly halfway between seen from behind and a profile facing the left edge of the picture; we see their back and the back of the head, the face hidden; their LEFT shoulder is nearer to us",
  'back-right': "in a three-quarter view from behind, facing the UPPER-RIGHT corner of the picture: turned away from us and towards the viewer's right, exactly halfway between seen from behind and a profile facing the right edge of the picture; we see their back and the back of the head, the face hidden; their RIGHT shoulder is nearer to us",
};

/** The mirror of each isometric way, which the image model kept painting instead. */
const WRONG_CORNER: Record<Exclude<Facing, WalkDirection>, string> = {
  'front-left': 'facing the lower-right corner',
  'front-right': 'facing the lower-left corner',
  'back-left': 'facing the upper-right corner',
  'back-right': 'facing the upper-left corner',
};

/**
 * Where each carried item shows in a view, item by item. Rules about "their
 * left side" in general fail; naming each item and saying in front of or
 * behind the body works.
 */
export function gearPlacement(gear: Carried[], direction: Facing): string {
  const where = (g: Carried): string => {
    if (g.side === 'back') return direction === 'back' || direction === 'back-left' || direction === 'back-right' ? `the ${g.item} is fully seen on the back` : `the ${g.item} peeks out behind the body`;
    if (direction === 'front') return `the ${g.item} is on the viewer's ${g.side === 'right' ? 'left' : 'right'}`;
    if (direction === 'back') return `the ${g.item} is on the viewer's ${g.side}`;
    // Turned halfway, the side turned towards the way they face is the far one, as the game draws held items.
    if (!isWalkDirection(direction)) {
      return heldBehind(direction, g.side)
        ? `the ${g.item} is on the far side, BEHIND the body, partly hidden`
        : `the ${g.item} is on the near side, IN FRONT of the body, fully visible`;
    }
    const near = (direction === 'right') === (g.side === 'left');
    return near
      ? `the ${g.item} is on the near side, IN FRONT of the body, fully visible`
      : `the ${g.item} is on the far side, BEHIND the body, mostly hidden`;
  };
  return gear.length ? `In this view: ${gear.map(where).join('; ')}.` : '';
}

/** The prompt for painting a look standing still facing one way, from its front-facing reference. */
export function viewPrompt(name: string, gear: Carried[], direction: Facing, references = 1): string {
  const from = references > 1
    ? `from the ${references} reference images alone (all of them show ${name}: take every detail from them, such as how clothes hang seen from different sides)`
    : 'from the reference image alone';
  return [
    STYLE.base,
    `Paint ${name} ${from}, full body, standing in a relaxed pose, ${SEEN[direction]}. Copy exactly how they look: face, hair, clothes, colours, proportions and what they carry.`,
    'Paint them in the style described above, even where the reference images are painted in another style.',
    gearPlacement(gear, direction),
    `Exactly one figure, centred, with wide empty margin all around. Background: one flat pure magenta (${STYLE.keyColor.hex}), with no floor or shadow. No magenta in the character.`,
    `Avoid: ${[...STYLE.negatives, 'second figure', 'turnaround sheet', 'cast shadow', ...(isWalkDirection(direction) ? [] : [WRONG_CORNER[direction]])].join(', ')}.`,
  ].filter(Boolean).join('\n');
}

/**
 * The prompt for painting a look standing in all four isometric ways at
 * once, side by side in ISO_WAYS order: painted together, the four keep one
 * look (one picture per way drifted in colours and details).
 */
export function waysSheetPrompt(name: string, gear: Carried[], references = 1): string {
  const from = references > 1 ? `from the ${references} reference images alone (all of them show ${name})` : 'from the reference image alone';
  return [
    STYLE.base,
    `Paint ${name} ${from}, four times side by side in one row, full body, standing in a relaxed pose, all four the same size and standing on the same line, evenly spaced with wide empty gaps so no two touch. From left to right:`,
    ...ISO_WAYS.map((way, i) => `${i + 1}. ${SEEN[way]}.${gear.length ? ` ${gearPlacement(gear, way)}` : ''}`),
    `All four are the same ${name}: copy exactly how they look in the reference (face, hair, clothes, colours, proportions and what they carry), the same in every view; only the way they face changes.`,
    'Paint them in the style described above, even where the reference images are painted in another style.',
    `Background: one flat pure magenta (${STYLE.keyColor.hex}) behind all four, with no floor, shadow, labels or numbers. No magenta in the character.`,
    `Avoid: ${[...STYLE.negatives, 'a fifth figure', 'figures touching or overlapping', 'labels', 'numbers', 'cast shadow'].join(', ')}.`,
  ].join('\n');
}

/** The four figures of a painted ways sheet, cut out, by the way each faces; fails, in plain words, unless there are exactly four. */
export async function waysFromSheet(painted: Buffer): Promise<Record<IsoWay, Buffer>> {
  const { png } = await removeKeyBackground(await sharp(painted).png().toBuffer(), undefined, { holes: true });
  const clean = await removeKeySpill(png);
  const count = await countFigures(clean);
  if (count !== ISO_WAYS.length) throw new Error(`The sheet shows ${count} figures instead of ${ISO_WAYS.length}.`);
  const figures = (await cutFigures(clean, { count: ISO_WAYS.length, dropEdgeBits: true })).sort((a, b) => a.box.left - b.box.left);
  return Object.fromEntries(ISO_WAYS.map((way, i) => [way, figures[i]!.png])) as Record<IsoWay, Buffer>;
}

/** The prompt that makes a standing picture walk in place and come back to the same pose. */
export function walkVideoPrompt(gear: Carried[], direction: Facing, body = 'two-legged'): string {
  // Clips walking away drifted into a diagonal three-quarter view, and side walks slid their feet, so each is spelled out.
  const facing = !isWalkDirection(direction)
    ? `${SEEN[direction]}: the body keeps exactly this three-quarter turn the whole time, never turning square to the camera or side-on, and a foot that touches the ground stays planted where it lands until it lifts again, with no sliding`
    : direction === 'front'
    ? 'towards the viewer, seen exactly from the front: the body stays square to the camera the whole time, never turning to a three-quarter view and never drifting sideways'
    : direction === 'back'
      ? 'away from the viewer, seen exactly from behind: the back stays square to the camera the whole time, never turning to a three-quarter view and never drifting sideways or diagonally'
      : `to the ${direction}, seen exactly side-on: a foot that touches the ground stays planted where it lands until it lifts again, with no sliding`;
  // A crawler has no arms to swing; its legs move in turns instead.
  const gait = body === 'two-legged' ? 'a brisk, cheerful walk with clear alternating steps and arms swinging' : 'a steady scuttle with its legs stepping in clear alternating sets';
  return [
    `${STYLE.animation} The character from the image walks in place ${facing}, like on a treadmill: ${gait}.`,
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
  return (await soleFigureAt(painted)).png;
}

/** The same, with where the figure sat in the picture. */
async function soleFigureAt(painted: Buffer): Promise<{ png: Buffer; box: Box }> {
  const { png } = await removeKeyBackground(await sharp(painted).png().toBuffer(), undefined, { holes: true });
  const clean = await removeKeySpill(png);
  const count = await countFigures(clean);
  if (count !== 1) throw new Error(`The picture shows ${count} figures instead of one.`);
  const [figure] = await cutFigures(clean, { count: 1, dropEdgeBits: true });
  return { png: figure!.png, box: figure!.box };
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

/**
 * One cycle of `count` walk frames cut out of a clip's frames: transparent,
 * trimmed figures, and the same figures `placed` where they stood in the
 * clip, all on one shared canvas. The camera is still, so a placed frame
 * keeps the feet where they really were; trimming each frame on its own and
 * lining frames up by their feet made the walker slide as the legs moved.
 */
export async function walkFromFrames(frames: Buffer[], count: number): Promise<{ figures: Buffer[]; placed: Buffer[]; cycle: Cycle }> {
  const small = await thumbs(frames);
  const difference = (a: number, b: number) => {
    let sum = 0;
    for (let k = 0; k < small[a]!.length; k++) sum += Math.abs(small[a]![k]! - small[b]![k]!);
    return sum / small[a]!.length;
  };
  const cycle = findCycle(frames.length, difference, count);
  const cut = await Promise.all(cycle.picks.map((i) => soleFigureAt(frames[i]!)));
  const all = cut.reduce((u, c) => ({ left: Math.min(u.left, c.box.left), top: Math.min(u.top, c.box.top), right: Math.max(u.right, c.box.right), bottom: Math.max(u.bottom, c.box.bottom) }), cut[0]!.box);
  // Each cut figure is exactly its box, so it goes back at the box's place.
  const placed = await Promise.all(cut.map((c) =>
    sharp({ create: { width: all.right - all.left + 1, height: all.bottom - all.top + 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: c.png, left: c.box.left - all.left, top: c.box.top - all.top }])
      .png()
      .toBuffer()));
  return { figures: cut.map((c) => c.png), placed, cycle };
}
