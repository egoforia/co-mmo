import sharp from 'sharp';

// Pictures as plain numbers for the kit's sheet checks and repeats: RGB from
// 0 to 255 per pixel, rows from the top, held as doubles so sums, medians and
// limits come out as they did in the prototype these checks were proven on.

/** A picture, or a strip of one: w × h pixels, three numbers (RGB, 0..255) each. */
export interface Img {
  w: number;
  h: number;
  d: Float64Array;
}

/** A w × h picture of one colour (black when none is given). */
export function blank(w: number, h: number, rgb: readonly number[] = [0, 0, 0]): Img {
  const d = new Float64Array(w * h * 3);
  if (rgb.some((v) => v !== 0)) for (let i = 0; i < w * h; i++) d.set(rgb, i * 3);
  return { w, h, d };
}

/** Columns x0..x1 and rows y0..y1 (ends excluded), clipped to the picture like an array slice. */
export function crop(T: Img, x0: number, y0: number, x1: number, y1: number): Img {
  [x0, x1] = [Math.max(0, Math.min(T.w, x0)), Math.max(0, Math.min(T.w, x1))];
  [y0, y1] = [Math.max(0, Math.min(T.h, y0)), Math.max(0, Math.min(T.h, y1))];
  const [w, h] = [Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
  const d = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) d.set(T.d.subarray(((y0 + y) * T.w + x0) * 3, ((y0 + y) * T.w + x0 + w) * 3), y * w * 3);
  return { w, h, d };
}

/** Rows y0..y1, all columns. */
export const rowsOf = (T: Img, y0: number, y1: number): Img => crop(T, 0, y0, T.w, y1);

/** Rows become columns: what runs down the picture runs across it. */
export function transpose(T: Img): Img {
  const d = new Float64Array(T.d.length);
  for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) for (let c = 0; c < 3; c++) d[(x * T.h + y) * 3 + c] = T.d[(y * T.w + x) * 3 + c]!;
  return { w: T.h, h: T.w, d };
}

/** Columns slid n to the right, those pushed off the right edge coming back on the left. */
export function roll(T: Img, n: number): Img {
  const d = new Float64Array(T.d.length);
  const s = ((n % T.w) + T.w) % T.w;
  for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) for (let c = 0; c < 3; c++) d[(y * T.w + ((x + s) % T.w)) * 3 + c] = T.d[(y * T.w + x) * 3 + c]!;
  return { w: T.w, h: T.h, d };
}

/** Strips of one width, one above another. */
export function stack(strips: Img[]): Img {
  const w = strips[0]!.w;
  const h = strips.reduce((n, s) => n + s.h, 0);
  const d = new Float64Array(w * h * 3);
  let o = 0;
  for (const s of strips) {
    d.set(s.d, o);
    o += s.d.length;
  }
  return { w, h, d };
}

/** The picture laid ny times down and nx times across, as it shows once tiled. */
export function repeat(T: Img, ny: number, nx: number): Img {
  const [w, h] = [T.w * nx, T.h * ny];
  const d = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) d[(y * w + x) * 3 + c] = T.d[((y % T.h) * T.w + (x % T.w)) * 3 + c]!;
  return { w, h, d };
}

/** Colour distance between pixel i of a and pixel j of b. */
export function dpx(a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number): number {
  const x = a[i * 3]! - b[j * 3]!;
  const y = a[i * 3 + 1]! - b[j * 3 + 1]!;
  const z = a[i * 3 + 2]! - b[j * 3 + 2]!;
  return Math.sqrt(x * x + y * y + z * z);
}

/** Brightness of each pixel, 0..1. */
export function lum(T: Img): Float64Array {
  const out = new Float64Array(T.w * T.h);
  for (let i = 0; i < out.length; i++) out[i] = (T.d[i * 3]! * 0.299 + T.d[i * 3 + 1]! * 0.587 + T.d[i * 3 + 2]! * 0.114) / 255;
  return out;
}

/** Average brightness of each row (across = false) or each column (across = true). */
export function profile(L: Float64Array, w: number, h: number, across: boolean): Float64Array {
  const out = new Float64Array(across ? w : h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[across ? x : y] += L[y * w + x]!;
  for (let i = 0; i < out.length; i++) out[i]! /= across ? h : w;
  return out;
}

export function mean(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]!;
  return s / v.length;
}

/** The middle value (the mean of the middle two for an even count). */
export function median(v: ArrayLike<number>): number {
  const s = Float64Array.from(v).sort();
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** The q-th percentile, interpolating between the two nearest values. */
export function percentile(v: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(v).sort();
  const at = (q / 100) * (s.length - 1);
  const lo = Math.floor(at);
  return lo + 1 < s.length ? s[lo]! + (s[lo + 1]! - s[lo]!) * (at - lo) : s[lo]!;
}

/** The median colour of some pixels, channel by channel. */
export function medianColour(T: Img, pixels?: Iterable<number>): [number, number, number] {
  const idx = pixels ? Array.from(pixels) : Array.from({ length: T.w * T.h }, (_, i) => i);
  const ch = (c: number) => median(idx.map((i) => T.d[i * 3 + c]!));
  return [ch(0), ch(1), ch(2)];
}

/** Runs of set flags: [first, length] each. */
export function runs(flags: ArrayLike<boolean | number>): [number, number][] {
  const out: [number, number][] = [];
  let cur = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && cur < 0) cur = i;
    if (!flags[i] && cur >= 0) {
      out.push([cur, i - cur]);
      cur = -1;
    }
  }
  if (cur >= 0) out.push([cur, flags.length - cur]);
  return out;
}

/** Rounding with halves going to the even neighbour, as the prototype's rounding did. */
export function evenRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** A number written with some decimals, halves going to the even neighbour (as the prototype's messages wrote them). */
export function fixed(x: number, digits = 0): string {
  const k = 10 ** digits;
  const v = x * k;
  return Math.abs(v % 1) === 0.5 ? (evenRound(v) / k).toFixed(digits) : x.toFixed(digits);
}

/** The picture as bytes, clipped to 0..255; `round` rounds, else the fraction is dropped. A plain loop: a mapping function per value is many times slower on a whole sheet. */
function bytes(T: Img, round: boolean): Buffer {
  const out = Buffer.allocUnsafe(T.d.length);
  for (let i = 0; i < T.d.length; i++) {
    const v = round ? Math.round(T.d[i]!) : T.d[i]!;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/** Reads a picture file or bytes as RGB numbers. */
export async function readImg(source: string | Buffer): Promise<Img> {
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, d: Float64Array.from(data) };
}

/** A picture as numbers resized to w × h (Lanczos, as the prototype resized). */
export async function resized(T: Img, w: number, h: number): Promise<Img> {
  const data = await sharp(bytes(T, false), { raw: { width: T.w, height: T.h, channels: 3 } }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  return { w, h, d: Float64Array.from(data) };
}

/** A picture as PNG bytes. */
export async function png(T: Img): Promise<Buffer> {
  return sharp(bytes(T, true), { raw: { width: T.w, height: T.h, channels: 3 } }).png().toBuffer();
}
