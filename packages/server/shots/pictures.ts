// Picture work for the shot runner: checks a machine can make on a screenshot
// (a page that drew nothing, magenta left from an unfinished painting), a
// close-up crop around the player for looking at small things, a contact
// sheet, and before/after/difference pictures for comparisons. These are
// tools for agents reviewing changes; nothing here is shown to players.

import sharp from 'sharp';

/** A picture's pixels as RGB bytes. */
interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

async function raw(file: string | Buffer): Promise<Raw> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Share of the picture that must be magenta before it is a finding (a few stray pixels are edge blending). */
const MAGENTA_SHARE = 0.0005;
/** Below this spread of brightness the picture is one flat colour. */
const FLAT_SPREAD = 4;

/** What a machine can tell is wrong with a screenshot, in plain words; empty when nothing is. */
export async function pictureProblems(file: string): Promise<string[]> {
  const { data, width, height } = await raw(file);
  const problems: string[] = [];
  let magenta = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  let sum = 0, sumSq = 0;
  for (let i = 0, p = 0; i < data.length; i += 3, p++) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const lum = (r + g + b) / 3;
    sum += lum;
    sumSq += lum * lum;
    if (r > 200 && b > 200 && g < 70) {
      magenta++;
      const x = p % width, y = Math.floor(p / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const n = width * height;
  const spread = Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
  if (spread < FLAT_SPREAD) problems.push('The picture is almost one flat colour: the game may not have drawn.');
  if (magenta / n > MAGENTA_SHARE) {
    problems.push(`${magenta} magenta pixels between (${minX},${minY}) and (${maxX},${maxY}): a painting's background was not cut away.`);
  }
  return problems;
}

/** A close-up around the middle of the screen (where the camera keeps the player), enlarged 2x without smoothing. */
export async function closeUp(file: string, out: string, size = { width: 400, height: 300 }): Promise<void> {
  const meta = await sharp(file).metadata();
  const w = Math.min(size.width, meta.width!), h = Math.min(size.height, meta.height!);
  // The player's feet are at the middle; most of them is above it.
  const left = Math.round((meta.width! - w) / 2);
  const top = Math.max(0, Math.round(meta.height! / 2 - h * 0.65));
  await sharp(file).extract({ left, top, width: w, height: Math.min(h, meta.height! - top) }).resize({ width: w * 2, kernel: 'nearest' }).png().toFile(out);
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A strip of text as a picture, for labels on sheets. */
function label(text: string, width: number, height = 28, colour = '#ffffff'): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#1d1f24"/>` +
      `<text x="8" y="${height - 9}" font-family="sans-serif" font-size="16" fill="${colour}">${escape(text)}</text></svg>`,
  );
}

/** Every shot small, in a grid with its name, on one picture. */
export async function contactSheet(shots: { name: string; file: string }[], out: string, columns = 4, thumb = 400): Promise<void> {
  const tiles = await Promise.all(
    shots.map(async ({ name, file }) => {
      const pic = await sharp(file).resize({ width: thumb, height: Math.round(thumb * 0.625), fit: 'contain', background: '#000000' }).png().toBuffer();
      return { pic, name };
    }),
  );
  const cellH = Math.round(thumb * 0.625) + 28;
  const rows = Math.ceil(tiles.length / columns);
  const parts = tiles.flatMap(({ pic, name }, i) => {
    const left = (i % columns) * (thumb + 8), top = Math.floor(i / columns) * (cellH + 8);
    return [
      { input: pic, left, top },
      { input: label(name, thumb), left, top: top + cellH - 28 },
    ];
  });
  await sharp({ create: { width: columns * (thumb + 8) - 8, height: Math.max(1, rows * (cellH + 8) - 8), channels: 3, background: '#0f1013' } })
    .composite(parts)
    .png()
    .toFile(out);
}

/** A pixel counts as changed when a channel moved more than this (small shifts are lighting noise and scaling). */
const CHANGED = 32;

/** How two shots differ: the share of pixels that changed, and where. */
export interface Difference {
  /** 0-1 share of pixels that changed. */
  changed: number;
  /** The box around the changes, when there are any. */
  box?: { x: number; y: number; width: number; height: number };
  /** The pictures were different sizes (the after one was compared at the before one's size). */
  resized: boolean;
}

/** The share of pixels that changed between two pictures of the same size (1 when the sizes differ). */
export async function changedShare(before: Buffer, after: Buffer): Promise<number> {
  const a = await raw(before), b = await raw(after);
  if (a.width !== b.width || a.height !== b.height) return 1;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 3) {
    if (Math.max(Math.abs(a.data[i]! - b.data[i]!), Math.abs(a.data[i + 1]! - b.data[i + 1]!), Math.abs(a.data[i + 2]! - b.data[i + 2]!)) > CHANGED) changed++;
  }
  return changed / (a.width * a.height);
}

/** Before | after | difference side by side, saved to `out`; returns how much changed. */
export async function compare(before: string, after: string, out: string): Promise<Difference> {
  const a = await raw(before);
  const resized = await sharp(after).metadata().then((m) => m.width !== a.width || m.height !== a.height);
  const bBuf = resized ? await sharp(after).resize(a.width, a.height, { fit: 'fill' }).toBuffer() : await sharp(after).toBuffer();
  const b = await raw(bBuf);
  const diff = Buffer.alloc(a.data.length);
  let changed = 0;
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
  for (let i = 0, p = 0; i < a.data.length; i += 3, p++) {
    const d = Math.max(Math.abs(a.data[i]! - b.data[i]!), Math.abs(a.data[i + 1]! - b.data[i + 1]!), Math.abs(a.data[i + 2]! - b.data[i + 2]!));
    if (d > CHANGED) {
      changed++;
      diff[i] = 255; diff[i + 1] = 40; diff[i + 2] = 40;
      const x = p % a.width, y = Math.floor(p / a.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    } else {
      // The after picture, grey and dim, so the red changes stand out where they are.
      const grey = Math.round(((b.data[i]! + b.data[i + 1]! + b.data[i + 2]!) / 3) * 0.35);
      diff[i] = grey; diff[i + 1] = grey; diff[i + 2] = grey;
    }
  }
  const { width, height } = a;
  const diffPng = await sharp(diff, { raw: { width, height, channels: 3 } }).png().toBuffer();
  await sharp({ create: { width: width * 3 + 16, height: height + 28, channels: 3, background: '#0f1013' } })
    .composite([
      { input: label('before', width), left: 0, top: 0 },
      { input: label(resized ? 'after (resized to match)' : 'after', width), left: width + 8, top: 0 },
      { input: label('changed pixels in red', width, 28, '#ff8080'), left: width * 2 + 16, top: 0 },
      { input: await sharp(before).png().toBuffer(), left: 0, top: 28 },
      { input: bBuf, left: width + 8, top: 28 },
      { input: diffPng, left: width * 2 + 16, top: 28 },
    ])
    .png()
    .toFile(out);
  return {
    changed: changed / (width * height),
    ...(changed ? { box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } } : {}),
    resized,
  };
}
