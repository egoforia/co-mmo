import sharp from 'sharp';

// Free checks on a painted walk, run before any paid vision check: they catch
// repeated poses, figures that grow or shrink, frames facing the wrong way,
// missing or extra parts, and left-over key colour. Frames are transparent,
// trimmed figures (from cutFigures); the reference is the matching view of
// the look's character sheet.

/** Side of the small square every comparison shrinks a figure to. */
const GRID = 48;

/** A figure shrunk to GRID x GRID, keeping its shape: red, green, blue, solidity, 0 to 1. */
async function thumb(png: Buffer, part?: 'top'): Promise<Float32Array> {
  let img = sharp(png).ensureAlpha();
  if (part === 'top') {
    const { height = 0, width = 0 } = await sharp(png).metadata();
    img = sharp(await sharp(png).extract({ left: 0, top: 0, width, height: Math.max(1, Math.round(height * 0.6)) }).png().toBuffer()).ensureAlpha();
  }
  const { data } = await img.resize(GRID, GRID, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true });
  return Float32Array.from(data, (v) => v / 255);
}

/** How different two thumbs are, 0 (same) to 1: shape and colour where either is solid. */
function difference(a: Float32Array, b: Float32Array, mirrorB = false): number {
  let sum = 0, n = 0;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const i = (y * GRID + x) * 4;
      const j = (y * GRID + (mirrorB ? GRID - 1 - x : x)) * 4;
      const sa = a[i + 3]!, sb = b[j + 3]!;
      if (sa < 0.1 && sb < 0.1) continue;
      const colour = (Math.abs(a[i]! - b[j]!) + Math.abs(a[i + 1]! - b[j + 1]!) + Math.abs(a[i + 2]! - b[j + 2]!)) / 3;
      sum += Math.abs(sa - sb) * 0.6 + Math.min(sa, sb) * colour * 0.4;
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Share of each colour family among a figure's solid pixels: 12 hues, then dark, grey and light. */
async function colourMix(png: Buffer): Promise<number[]> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Array(15).fill(0);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]! / 255, g = data[i + 1]! / 255, b = data[i + 2]! / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 2, chroma = max - min;
    let bin: number;
    if (chroma < 0.12) bin = light < 0.25 ? 12 : light > 0.8 ? 14 : 13;
    else {
      const hue = max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
      bin = Math.floor(hue * 2) % 12;
    }
    bins[bin]++;
    n++;
  }
  return bins.map((c) => (n ? c / n : 0));
}

/** The magenta the sprites are painted on, left in the figure. */
async function keyShare(png: Buffer): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let key = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    n++;
    if (data[i]! > 190 && data[i + 2]! > 190 && data[i + 1]! < 90) key++;
  }
  return n ? key / n : 0;
}

/** What the checks found, in plain words, and the numbers behind them. */
export interface WalkCheck {
  /** One line per problem, naming the frames (counted from 1). */
  problems: string[];
  /** Frames (counted from 1) that should be repainted. */
  badFrames: number[];
  /** How many of the frames are clearly different poses. */
  distinctPoses: number;
}

export interface CheckOptions {
  /** Below this difference two frames count as the same pose. Default 0.05. */
  samePose?: number;
  /** A frame this much taller or shorter than the median is wrong. Default 0.15. */
  heightRange?: number;
  /** A colour family whose share differs from the reference by this much is a missing or extra part. Default 0.1. */
  colourShift?: number;
  /** Share of key colour left in a figure that counts as a problem. Default 0.01. */
  keyLeft?: number;
}

/**
 * Checks one direction's frames against the matching reference view. Facing
 * is judged on the top 60% of the figure (head and body, not the striding
 * legs): a frame that matches the mirrored reference better than the
 * reference itself faces the wrong way.
 */
export async function checkWalk(frames: Buffer[], reference: Buffer, options: CheckOptions = {}): Promise<WalkCheck> {
  const samePose = options.samePose ?? 0.05;
  const problems: string[] = [];
  const bad = new Set<number>();
  const n = frames.length;
  const thumbs = await Promise.all(frames.map((f) => thumb(f)));

  // Repeated poses: any two frames that are nearly the same picture.
  const same = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!same.has(j) && difference(thumbs[i]!, thumbs[j]!) < samePose) same.set(j, i);
    }
  }
  for (const [j, i] of same) {
    problems.push(`Frame ${j + 1} repeats frame ${i + 1}.`);
    bad.add(j + 1);
  }

  // Size: the walker should stay one size from frame to frame.
  const sizes = await Promise.all(frames.map(async (f) => (await sharp(f).metadata()).height ?? 0));
  const median = [...sizes].sort((a, b) => a - b)[Math.floor(n / 2)] ?? 0;
  const range = options.heightRange ?? 0.15;
  sizes.forEach((h, i) => {
    if (Math.abs(h - median) > median * range) {
      problems.push(`Frame ${i + 1} is ${h > median ? 'taller' : 'shorter'} than the others.`);
      bad.add(i + 1);
    }
  });

  // Facing, against the reference and its mirror.
  const ref = await thumb(reference, 'top');
  for (let i = 0; i < n; i++) {
    const top = await thumb(frames[i]!, 'top');
    const straight = difference(top, ref), mirrored = difference(top, ref, true);
    if (mirrored < straight * 0.85) {
      problems.push(`Frame ${i + 1} seems to face the other way.`);
      bad.add(i + 1);
    }
  }

  // Missing or extra parts: a colour family much more or less common than in the reference.
  const refMix = await colourMix(reference);
  const shift = options.colourShift ?? 0.1;
  for (let i = 0; i < n; i++) {
    const mix = await colourMix(frames[i]!);
    const worst = mix.reduce((w, v, k) => (Math.abs(v - refMix[k]!) > Math.abs(w.d) ? { k, d: v - refMix[k]! } : w), { k: -1, d: 0 });
    if (Math.abs(worst.d) > shift) {
      problems.push(`Frame ${i + 1} has ${worst.d > 0 ? 'more' : 'less'} ${FAMILY[worst.k]} than the reference, so a part may be ${worst.d > 0 ? 'extra' : 'missing'}.`);
      bad.add(i + 1);
    }
  }

  // Key colour the background removal left behind.
  const keyLeft = options.keyLeft ?? 0.01;
  for (let i = 0; i < n; i++) {
    if ((await keyShare(frames[i]!)) > keyLeft) {
      problems.push(`Frame ${i + 1} still shows some magenta background.`);
      bad.add(i + 1);
    }
  }

  return { problems, badFrames: [...bad].sort((a, b) => a - b), distinctPoses: n - same.size };
}

const FAMILY = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky blue', 'blue', 'purple', 'magenta', 'pink', 'dark shades', 'grey', 'light shades'];
