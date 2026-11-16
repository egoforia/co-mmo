import sharp from 'sharp';

// Post-processing for generated images (Style Bible, Global rules: Background
// and Ground tiles). Providers return opaque images, so sprites are painted on
// a flat key colour that is removed here, and tiles are made seamless here.
// The cut itself lives in postprocess/key-cut.ts.

export { removeKeyBackground, removeKeySpill, type KeyCut } from './postprocess/key-cut.ts';

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

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Turns a painting into true pixel art: shrinks it to `width` x `height` art
 * pixels, keeps at most `colours` colours with hard (on or off) transparency,
 * then scales each art pixel up to a `scale`-pixel square.
 */
export async function pixelate(png: Buffer, width: number, height: number, scale: number, colours = 24): Promise<Buffer> {
  const small = await toRaw(await sharp(png).resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer());
  for (let i = 3; i < small.data.length; i += 4) small.data[i] = small.data[i]! >= 128 ? 255 : 0;
  const quantized = await sharp(await fromRaw(small)).png({ palette: true, colours, dither: 0 }).toBuffer();
  return sharp(quantized).ensureAlpha().resize(width * scale, height * scale, { kernel: 'nearest' }).png().toBuffer();
}

/** Crops the empty rows above and below a sprite, keeping its full width so its middle stays its middle. */
export async function trimRows(png: Buffer): Promise<Buffer> {
  const img = await toRaw(png);
  const { data, width: w, height: h } = img;
  const filled = (y: number) => {
    for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]! > 8) return true;
    return false;
  };
  let top = 0;
  while (top < h - 1 && !filled(top)) top++;
  let bottom = h - 1;
  while (bottom > top && !filled(bottom)) bottom--;
  return sharp(png).extract({ left: 0, top, width: w, height: bottom - top + 1 }).png().toBuffer();
}
