import sharp from 'sharp';

// Post-processing for generated images (Style Bible, Global rules: Background
// and Ground tiles). Providers return opaque images, so sprites are painted on
// a flat key colour that is removed here, and tiles are made seamless here.

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

async function toRaw(png: Buffer): Promise<Raw> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const fromRaw = (r: Raw) => sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } }).png().toBuffer();

/**
 * Makes the flat background transparent. The key is sampled from the image's
 * border (so a slightly-off magenta still works) and removed by flood fill from
 * the edges, so key-like colours inside the subject survive. Pixels on the
 * boundary get partial alpha with the key colour un-mixed, so edges stay soft.
 * `clean` is false when the border is not mostly one flat colour.
 * With `holes`, enclosed pockets of near-exact key colour (gaps between a
 * tree's branches) are removed too.
 */
export async function removeKeyBackground(
  png: Buffer,
  tolerance = 70,
  { holes = false }: { holes?: boolean } = {},
): Promise<{ png: Buffer; clean: boolean }> {
  const img = await toRaw(png);
  const { data, width: w, height: h } = img;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const key = [0, 1, 2].map((c) => median(border.map((i) => data[i * 4 + c])));
  const dist = (i: number) => Math.hypot(data[i * 4] - key[0], data[i * 4 + 1] - key[1], data[i * 4 + 2] - key[2]);

  const clean = border.filter((i) => dist(i) < tolerance).length / border.length > 0.9;

  // Flood fill the background from every border pixel close to the key.
  const bg = new Uint8Array(w * h);
  const stack = border.filter((i) => dist(i) < tolerance);
  for (const i of stack) bg[i] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (n < 0 || n >= w * h || bg[n] || dist(n) >= tolerance) continue;
      bg[n] = 1;
      stack.push(n);
    }
  }

  if (holes) fillHoles(bg, dist, w, h, tolerance * 0.6);

  for (let i = 0; i < w * h; i++) {
    if (bg[i]) {
      data[i * 4 + 3] = 0;
      continue;
    }
    if (!touches(bg, i, w, h, 2)) continue;
    // Edge pixel: treat it as a mix of subject and key, keep the subject part.
    const a = Math.min(1, Math.max(0, (dist(i) - 25) / 140));
    if (a <= 0.02) {
      data[i * 4 + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = clamp((data[i * 4 + c] - (1 - a) * key[c]) / a);
    }
    data[i * 4 + 3] = Math.round(a * 255);
  }
  return { png: await fromRaw(img), clean };
}

/** Marks enclosed runs of near-key pixels as background when big enough to be a gap, not a speck. */
function fillHoles(bg: Uint8Array, dist: (i: number) => number, w: number, h: number, tolerance: number, minSize = 24): void {
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (bg[start] || seen[start] || dist(start) >= tolerance) continue;
    const region = [start];
    seen[start] = 1;
    for (let k = 0; k < region.length; k++) {
      const i = region[k]!;
      const x = i % w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (n < 0 || n >= w * h || bg[n] || seen[n] || dist(n) >= tolerance) continue;
        seen[n] = 1;
        region.push(n);
      }
    }
    if (region.length >= minSize) for (const i of region) bg[i] = 1;
  }
}

/**
 * Makes a texture wrap on all four edges by image quilting: the tile's left
 * band is overlapped with its right band and cut along the path where the two
 * differ least, so the right edge flows into the left one; then the same for
 * top and bottom. The tile loses `overlap` of its width and height and is
 * scaled back to its size. Works best on evenly lit, evenly detailed ground.
 */
export async function makeSeamless(png: Buffer, overlap = 0.125): Promise<Buffer> {
  const img = await flattenLighting(png);
  const k = Math.round(img.width * overlap);
  const wrapped = transpose(wrapColumns(transpose(wrapColumns(img, k)), k));
  return sharp(await fromRaw(wrapped)).resize(img.width, img.height).png().toBuffer();
}

/**
 * Evens out light falloff across a tile (models like to add vignettes), by
 * dividing out a heavily blurred copy and restoring the average brightness.
 * Without this, repeated tiles show a grid of light and dark squares.
 */
async function flattenLighting(png: Buffer, strength = 0.85): Promise<Raw> {
  const img = await toRaw(png);
  const blurred = await toRaw(await sharp(png).blur(Math.max(1, img.width / 10)).png().toBuffer());
  const n = img.width * img.height;
  const mean = [0, 1, 2].map((c) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += blurred.data[i * 4 + c];
    return sum / n;
  });
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const gain = mean[c] / Math.max(1, blurred.data[i * 4 + c]);
      img.data[i * 4 + c] = clamp(img.data[i * 4 + c] * (1 + strength * (gain - 1)));
    }
  }
  return img;
}

/** Joins the right band onto the left band along a minimum-error vertical cut. */
function wrapColumns(img: Raw, k: number): Raw {
  const { data, width: w, height: h } = img;
  const px = (x: number, y: number) => (y * w + x) * 4;
  const err = (x: number, y: number) => {
    const i = px(x, y);
    const j = px(w - k + x, y);
    return (data[i] - data[j]) ** 2 + (data[i + 1] - data[j + 1]) ** 2 + (data[i + 2] - data[j + 2]) ** 2;
  };
  // Dynamic programming: cheapest top-to-bottom path through the overlap.
  const cost = new Float64Array(k * h);
  for (let x = 0; x < k; x++) cost[x] = err(x, 0);
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < k; x++) {
      let best = cost[(y - 1) * k + x];
      if (x > 0) best = Math.min(best, cost[(y - 1) * k + x - 1]);
      if (x < k - 1) best = Math.min(best, cost[(y - 1) * k + x + 1]);
      cost[y * k + x] = err(x, y) + best;
    }
  }
  const cut = new Int32Array(h);
  let x = 0;
  for (let i = 1; i < k; i++) if (cost[(h - 1) * k + i] < cost[(h - 1) * k + x]) x = i;
  for (let y = h - 1; y >= 0; y--) {
    cut[y] = x;
    if (y === 0) break;
    let next = x;
    for (const c of [x - 1, x + 1]) if (c >= 0 && c < k && cost[(y - 1) * k + c] < cost[(y - 1) * k + next]) next = c;
    x = next;
  }

  const nw = w - k;
  const out = Buffer.alloc(nw * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < nw; x++) {
      // Left of the cut comes from the right band, which is what the wrap meets.
      const from = x < k && x < cut[y] ? px(w - k + x, y) : px(x, y);
      data.copy(out, (y * nw + x) * 4, from, from + 4);
    }
  }
  return { data: out, width: nw, height: h };
}

function transpose(img: Raw): Raw {
  const { data, width: w, height: h } = img;
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.copy(out, (x * h + y) * 4, (y * w + x) * 4, (y * w + x) * 4 + 4);
  return { data: out, width: h, height: w };
}

/** A count × count repeat of a tile, for checking that it has no visible seams. */
export async function tileGrid(png: Buffer, count = 4, cell = 256): Promise<Buffer> {
  const tile = await sharp(png).resize(cell, cell).png().toBuffer();
  const composites = [];
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) composites.push({ input: tile, left: x * cell, top: y * cell });
  return sharp({ create: { width: cell * count, height: cell * count, channels: 4, background: '#000000' } })
    .composite(composites)
    .png()
    .toBuffer();
}

function touches(mask: Uint8Array, i: number, w: number, h: number, r: number): boolean {
  const x0 = i % w;
  const y0 = (i - x0) / w;
  for (let y = Math.max(0, y0 - r); y <= Math.min(h - 1, y0 + r); y++) {
    for (let x = Math.max(0, x0 - r); x <= Math.min(w - 1, x0 + r); x++) if (mask[y * w + x]) return true;
  }
  return false;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
