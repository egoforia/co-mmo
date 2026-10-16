import sharp from 'sharp';
import { CHARACTER_HEIGHT } from '@co-mmo/shared';

// Cuts painted walk pictures into frames and lines the frames up. Pictures
// arrive with the key colour already removed (removeKeyBackground). Figures
// are found as connected shapes, not by cutting at fixed lines, so a scarf
// reaching into the next figure's space stays with its owner, and bits of a
// neighbour never end up in a frame.

/** A transparent picture's pixels. */
interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

const toRaw = async (png: Buffer): Promise<Raw> => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};
const fromRaw = (r: Raw) => sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } }).png().toBuffer();

/** A box in pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One connected shape of solid pixels. */
interface Shape {
  pixels: number[];
  box: Box;
}

/** Solid enough to belong to a figure. */
const SOLID = 40;

/** Finds the connected shapes of solid pixels (touching sideways or diagonally). */
function shapes(img: Raw): Shape[] {
  const { data, width: w, height: h } = img;
  const label = new Int32Array(w * h).fill(-1);
  const found: Shape[] = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || data[start * 4 + 3]! <= SOLID) continue;
    const pixels = [start];
    label[start] = found.length;
    const box = { left: start % w, top: Math.floor(start / w), right: start % w, bottom: Math.floor(start / w) };
    for (let k = 0; k < pixels.length; k++) {
      const i = pixels[k]!;
      const x = i % w, y = (i - x) / w;
      box.left = Math.min(box.left, x); box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (label[n] !== -1 || data[n * 4 + 3]! <= SOLID) continue;
          label[n] = found.length;
          pixels.push(n);
        }
      }
    }
    found.push({ pixels, box });
  }
  return found;
}

/** Splits a shape in two across its narrowest row in its middle third; none when it is not tall enough to hold two figures. */
function splitAtWaist(shape: Shape, width: number): [Shape, Shape] | undefined {
  const { top, bottom } = shape.box;
  const height = bottom - top + 1;
  if (height < 40) return undefined;
  const rows = new Array(height).fill(0);
  for (const p of shape.pixels) rows[Math.floor(p / width) - top]++;
  let cut = -1;
  for (let y = Math.floor(height / 3); y < Math.ceil((height * 2) / 3); y++) if (cut < 0 || rows[y] < rows[cut]) cut = y;
  // Only a narrow neck is a place where two figures touch; a waist as wide as the body is one figure.
  const widths = rows.filter((n) => n > 0).sort((a, b) => a - b);
  if (rows[cut] > (widths[Math.floor(widths.length / 2)] ?? 0) * 0.35) return undefined;
  const line = top + cut;
  const halves = [shape.pixels.filter((p) => Math.floor(p / width) < line), shape.pixels.filter((p) => Math.floor(p / width) >= line)];
  if (!halves[0]!.length || !halves[1]!.length) return undefined;
  return halves.map((pixels) => ({ pixels, box: boxOf(pixels, width) })) as [Shape, Shape];
}

function boxOf(pixels: number[], width: number): Box {
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const p of pixels) {
    const x = p % width, y = (p - x) / width;
    box.left = Math.min(box.left, x); box.right = Math.max(box.right, x);
    box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
  }
  return box;
}

/** Gap between two boxes in pixels; 0 when they overlap. */
function gap(a: Box, b: Box): number {
  const dx = Math.max(0, a.left - b.right, b.left - a.right);
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  return Math.hypot(dx, dy);
}

const union = (a: Box, b: Box): Box => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) });

/** One figure cut from a picture. */
export interface CutFigure {
  /** Only this figure's pixels, trimmed to them. */
  png: Buffer;
  /** Where it sat in the picture. */
  box: Box;
  /** It runs off the picture's edge, so part of it is probably missing. */
  touchesEdge: boolean;
  /** It comes closer to another figure than `minGap`, so the two may share parts. */
  crowded: boolean;
}

export interface CutOptions {
  /** How many figures the picture should hold. */
  count: number;
  /** Shapes smaller than this share of the biggest figure are specks, and dropped. Default 0.002. */
  speck?: number;
  /** Loose shapes further than this share of the picture's width from every figure are dropped. Default 0.04. */
  reach?: number;
  /** Figures closer than this share of the picture's width count as crowded. Default 0.01. */
  minGap?: number;
  /** Drop loose shapes that run off the picture's edge: bits of a neighbour cut off when the picture was cropped. */
  dropEdgeBits?: boolean;
}

/**
 * Cuts a transparent picture into `count` figures, read in rows from the top,
 * left to right. The biggest shapes are the figures; each smaller shape joins
 * the nearest figure if it is close enough (a staff, a scarf tip, a dropped
 * foot), and specks are dropped. Fails, in plain words, when there are fewer
 * figures than asked for.
 */
export async function cutFigures(png: Buffer, options: CutOptions): Promise<CutFigure[]> {
  const img = await toRaw(png);
  const all = shapes(img).sort((a, b) => b.pixels.length - a.pixels.length);
  const biggest = all[0]?.pixels.length ?? 0;
  const solid = all.filter((s) => s.pixels.length >= biggest * (options.speck ?? 0.002));
  // A figure is a shape at least a fifth the size of the biggest one.
  let seeds = solid.slice(0, options.count).filter((s) => s.pixels.length >= biggest * 0.2);
  const rest = solid.filter((s) => !seeds.includes(s));
  // Figures in two rows can touch (a hat brim on the feet above): split the tallest at its narrowest waist until there are enough.
  while (seeds.length < options.count) {
    const tallest = seeds.reduce((t, s) => (s.box.bottom - s.box.top > t.box.bottom - t.box.top ? s : t), seeds[0]!);
    const parts = tallest && splitAtWaist(tallest, img.width);
    if (!parts) throw new Error(`Found ${seeds.length} figures in the picture, expected ${options.count}.`);
    seeds = [...seeds.filter((s) => s !== tallest), ...parts];
  }
  const reach = img.width * (options.reach ?? 0.04);
  const members = seeds.map((s) => [s]);
  const boxes = seeds.map((s) => s.box);
  const onEdge = (b: Box) => b.left === 0 || b.top === 0 || b.right === img.width - 1 || b.bottom === img.height - 1;
  for (const loose of rest) {
    if (options.dropEdgeBits && onEdge(loose.box)) continue;
    let best = -1, bestGap = Infinity;
    seeds.forEach((s, i) => {
      const g = gap(loose.box, s.box);
      if (g < bestGap) { bestGap = g; best = i; }
    });
    if (best < 0 || bestGap > reach) continue;
    members[best]!.push(loose);
    boxes[best] = union(boxes[best]!, loose.box);
  }
  const order = readingOrder(boxes);
  const minGap = img.width * (options.minGap ?? 0.01);
  return Promise.all(order.map(async (i) => {
    const box = boxes[i]!;
    const out: Raw = { width: box.right - box.left + 1, height: box.bottom - box.top + 1, data: Buffer.alloc(0) };
    out.data = Buffer.alloc(out.width * out.height * 4);
    for (const shape of members[i]!) {
      for (const p of shape.pixels) {
        const x = p % img.width, y = (p - x) / img.width;
        img.data.copy(out.data, ((y - box.top) * out.width + (x - box.left)) * 4, p * 4, p * 4 + 4);
      }
    }
    // Soft edge pixels next to the figure belong to it too.
    for (let y = box.top; y <= box.bottom; y++) {
      for (let x = box.left; x <= box.right; x++) {
        const o = ((y - box.top) * out.width + (x - box.left)) * 4;
        const a = img.data[(y * img.width + x) * 4 + 3]!;
        if (out.data[o + 3] || !a || a > SOLID) continue;
        if (nextToFigure(out, x - box.left, y - box.top)) img.data.copy(out.data, o, (y * img.width + x) * 4, (y * img.width + x) * 4 + 4);
      }
    }
    const touchesEdge = onEdge(box);
    const crowded = boxes.some((b, j) => j !== i && gap(b, box) < minGap);
    return { png: await fromRaw(out), box, touchesEdge, crowded };
  }));
}

/** How many figures a transparent picture holds: shapes at least a fifth the size of the biggest. */
export async function countFigures(png: Buffer): Promise<number> {
  const all = shapes(await toRaw(png));
  const biggest = Math.max(0, ...all.map((s) => s.pixels.length));
  return all.filter((s) => s.pixels.length >= biggest * 0.2).length;
}

function nextToFigure(r: Raw, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= r.width || ny >= r.height) continue;
      if (r.data[(ny * r.width + nx) * 4 + 3]! > SOLID) return true;
    }
  }
  return false;
}

/** Figure indexes in reading order: rows from the top (a new row starts below half a figure's height), then left to right. */
function readingOrder(boxes: Box[]): number[] {
  const mid = (b: Box) => (b.top + b.bottom) / 2;
  const heights = boxes.map((b) => b.bottom - b.top).sort((a, b) => a - b);
  const rowGap = (heights[Math.floor(heights.length / 2)] ?? 0) / 2;
  const byY = boxes.map((_, i) => i).sort((a, b) => mid(boxes[a]!) - mid(boxes[b]!));
  const rows: number[][] = [];
  for (const i of byY) {
    const row = rows.at(-1);
    if (row && mid(boxes[i]!) - mid(boxes[row[0]!]!) < rowGap) row.push(i);
    else rows.push([i]);
  }
  return rows.flatMap((row) => row.sort((a, b) => boxes[a]!.left - boxes[b]!.left));
}

/** Where a figure's feet are: the middle of its solid pixels in the bottom tenth. */
export async function feetCentre(png: Buffer): Promise<number> {
  const img = await toRaw(png);
  let sum = 0, n = 0;
  for (let y = Math.floor(img.height * 0.9); y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! > SOLID) { sum += x; n++; }
    }
  }
  return n ? sum / n : img.width / 2;
}

/** A look's frames lined up for the game. */
export interface NormalizedWalk {
  /** Each direction's frames side by side, one strip per direction, in the order given. */
  strips: Buffer[];
  frameWidth: number;
  frameHeight: number;
  scale: number;
}

/**
 * Lines up every frame of a look, across all its directions: one scale for
 * all (the median figure's height becomes `bodyHeight`, so the walker never
 * grows or shrinks when turning), feet centred in the frame and standing on
 * one baseline `margin` pixels above the bottom. Frames placed on one shared
 * canvas (as cut from a clip) keep their places within their direction. Frames are as wide and tall
 * as the widest and tallest figure needs, so nothing is cut off.
 */
export async function normalizeWalk(directions: Buffer[][], { bodyHeight = CHARACTER_HEIGHT, margin = 2 } = {}): Promise<NormalizedWalk> {
  const frames = await Promise.all(directions.map(async (frames) => {
    const sized = await Promise.all(frames.map(async (png) => {
      const meta = await sharp(png).metadata();
      return { png, width: meta.width!, height: meta.height!, feet: await feetCentre(png) };
    }));
    // Frames placed where they stood in the clip share one canvas: they keep their places, lined up
    // by the feet of the whole cycle, so the walker does not slide from frame to frame.
    const placed = sized.length > 1 && sized.every((f) => f.width === sized[0]!.width && f.height === sized[0]!.height);
    if (!placed) return sized.map((f) => ({ ...f, figure: f.height }));
    const feet = [...sized.map((f) => f.feet)].sort((a, b) => a - b)[Math.floor(sized.length / 2)]!;
    // The scale goes by the figure itself, not the canvas around the whole cycle, so every look keeps one size.
    return Promise.all(sized.map(async (f) => ({ ...f, feet, figure: (await sharp(f.png).trim().toBuffer({ resolveWithObject: true })).info.height })));
  }));
  const heights = frames.flat().map((f) => f.figure).sort((a, b) => a - b);
  const scale = bodyHeight / (heights[Math.floor(heights.length / 2)] ?? 1);
  const sized = frames.map((dir) => dir.map((f) => ({ ...f, w: Math.max(1, Math.round(f.width * scale)), h: Math.max(1, Math.round(f.height * scale)), feet: f.feet * scale })));
  const half = Math.max(...sized.flat().map((f) => Math.max(f.feet, f.w - f.feet)));
  const frameWidth = Math.ceil((2 * half + 2) / 2) * 2;
  const frameHeight = Math.max(...sized.flat().map((f) => f.h)) + margin;
  const strips = await Promise.all(sized.map(async (dir) => {
    const layers = await Promise.all(dir.map(async (f, i) => ({
      input: await sharp(f.png).resize(f.w, f.h, { kernel: 'lanczos3' }).png().toBuffer(),
      left: Math.round(i * frameWidth + frameWidth / 2 - f.feet),
      top: frameHeight - margin - f.h,
    })));
    return sharp({ create: { width: frameWidth * dir.length, height: frameHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(layers)
      .png()
      .toBuffer();
  }));
  return { strips, frameWidth, frameHeight, scale };
}
