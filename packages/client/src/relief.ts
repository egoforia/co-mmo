// Working out a normal map from a painted picture: plain arithmetic on its
// pixels, kept apart from Phaser so it can run in a worker and be tested on
// its own. See normal-maps.ts for how the maps reach the light.

/** How far in from its outline a picture rounds off, in pixels. */
const ROUND = 6;
/** How much the outline's rounding tilts the surface. */
const RELIEF = 3;
/** How much light and dark paint tilts the surface. */
const DETAIL = 1.2;

/** Index `i` kept within 0..len-1, wrapping round for seamless tiles. */
function edge(i: number, len: number, wrap: boolean): number {
  if (i >= 0 && i < len) return i;
  return wrap ? ((i % len) + len) % len : i < 0 ? 0 : len - 1;
}

/** Blurs `len` values of `v`, `step` apart from `first`, with a box of radius `r`, through `tmp`. */
function blurLine(v: Float32Array, first: number, step: number, len: number, r: number, wrap: boolean, tmp: Float32Array): void {
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += v[first + edge(i, len, wrap) * step]!;
  const scale = 1 / (2 * r + 1);
  for (let i = 0; i < len; i++) {
    tmp[i] = sum * scale;
    sum += v[first + edge(i + r + 1, len, wrap) * step]! - v[first + edge(i - r, len, wrap) * step]!;
  }
  for (let i = 0; i < len; i++) v[first + i * step] = tmp[i]!;
}

/** Blurs `v` (w by h) in place with a box of radius `r`, rows then columns, `wrap` for seamless tiles. */
function boxBlur(v: Float32Array, w: number, h: number, r: number, wrap: boolean): void {
  const tmp = new Float32Array(Math.max(w, h));
  for (let y = 0; y < h; y++) blurLine(v, y * w, 1, w, r, wrap, tmp);
  for (let x = 0; x < w; x++) blurLine(v, x, w, h, r, wrap, tmp);
}

/**
 * A normal map for an RGBA picture `w` by `h`, as RGBA: red is how much a
 * pixel faces right, green how much it faces up the picture, blue how much
 * it faces us. Fully opaque pictures (ground tiles) wrap at their edges so
 * their maps stay seamless too.
 */
export function normalMapOf(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const n = w * h;
  const shape = new Float32Array(n);
  const paint = new Float32Array(n);
  let opaque = true;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const a = rgba[o + 3]! / 255;
    if (a < 1) opaque = false;
    shape[i] = a;
    paint[i] = ((rgba[o]! * 0.3 + rgba[o + 1]! * 0.59 + rgba[o + 2]! * 0.11) / 255) * a;
  }
  // Twice over makes the rounding smooth, like a pillow rather than a bevel.
  boxBlur(shape, w, h, ROUND, opaque);
  boxBlur(shape, w, h, ROUND, opaque);
  boxBlur(paint, w, h, 1, opaque);
  const height = shape;
  for (let i = 0; i < n; i++) height[i] = shape[i]! * RELIEF + paint[i]! * DETAIL;
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < h; y++) {
    const up = edge(y - 1, h, opaque) * w;
    const down = edge(y + 1, h, opaque) * w;
    for (let x = 0; x < w; x++) {
      const dx = height[y * w + edge(x + 1, w, opaque)]! - height[y * w + edge(x - 1, w, opaque)]!;
      const dy = height[down + x]! - height[up + x]!;
      // Rising to the right faces left; rising down the picture faces up it.
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * w + x) * 4;
      out[o] = (-dx / len) * 127.5 + 127.5;
      out[o + 1] = (dy / len) * 127.5 + 127.5;
      out[o + 2] = (1 / len) * 127.5 + 127.5;
      out[o + 3] = 255;
    }
  }
  return out;
}
