import sharp from 'sharp';

// Cutting a painted subject out of its plain backdrop. Image models are asked
// for flat magenta, but each paints it a little differently: lighter or
// pinker, with a soft gradient, or with fine grain. So the backdrop is never
// taken as an exact colour. It is measured from the picture's own border as a
// smooth colour field, and pixels are compared with it the way the eye does
// (CIELAB), with a tolerance set by how even that border is. That keeps
// subjects in colours close to the backdrop (dusty rose on a pinkish
// background) instead of eating them.

/** What the cut found and did. */
export interface KeyCut {
  png: Buffer;
  /** False when the border is not mostly one plain backdrop (scenery, a floor, noise). */
  clean: boolean;
  /** The backdrop's average colour as painted, for clearing its spill afterwards. */
  key: { r: number; g: number; b: number };
}

type Field = (x: number, y: number) => number;

/** sRGB channel (0-255) to linear light, looked up rather than computed per pixel. */
const LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** One pixel's CIELAB colour (D65), written into `out` at `o`. */
function toLab(r: number, g: number, b: number, out: Float32Array, o: number): void {
  const R = LINEAR[r]!, G = LINEAR[g]!, B = LINEAR[b]!;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const fy = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const fz = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

/** Least-squares fit of v = a + bx + cy + dx² + ey² + fxy: a backdrop's slow gradient or vignette. */
function fitField(points: number[], value: (i: number) => number, w: number, h: number): Field {
  const n = 6;
  const m = Array.from({ length: n }, () => new Float64Array(n + 1));
  const terms = new Float64Array(n);
  for (const i of points) {
    const x = (i % w) / w, y = Math.floor(i / w) / h;
    terms.set([1, x, y, x * x, y * y, x * y]);
    const v = value(i);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) m[r]![c]! += terms[r]! * terms[c]!;
      m[r]![n]! += terms[r]! * v;
    }
  }
  for (let r = 0; r < n; r++) m[r]![r]! += 1e-6;
  for (let r = 0; r < n; r++) {
    let p = r;
    for (let k = r + 1; k < n; k++) if (Math.abs(m[k]![r]!) > Math.abs(m[p]![r]!)) p = k;
    [m[r], m[p]] = [m[p]!, m[r]!];
    for (let k = 0; k < n; k++) {
      if (k === r) continue;
      const f = m[k]![r]! / m[r]![r]!;
      for (let c = r; c <= n; c++) m[k]![c]! -= f * m[r]![c]!;
    }
  }
  const a = m.map((row, r) => row[n]! / row[r]!);
  return (x, y) => a[0]! + a[1]! * x + a[2]! * y + a[3]! * x * x + a[4]! * y * y + a[5]! * x * y;
}

/** The pixels in a band a few pixels deep around the picture's edge (every third one is enough). */
function borderBand(w: number, h: number): number[] {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.01));
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBand = x < band || y < band || x >= w - band || y >= h - band;
      if (inBand && (x + y) % 3 === 0) out.push(y * w + x);
    }
  }
  return out;
}

/**
 * The least CIELAB distance still counted as backdrop. Models paint a vivid
 * backdrop unevenly (a lighter patch, a faint halo or ground shadow in the
 * backdrop's own colour), so it is about what the old fixed RGB cut allowed.
 * A pale or grey backdrop (old anchors on cream) gets less, since white robes
 * and marble sit right next to it.
 */
const MIN_TOLERANCE = { vivid: 25, dull: 16 };

/** A strongly coloured key, far from white, grey and black: only then can pockets of it inside a subject be told from the subject. */
const vivid = (key: { r: number; g: number; b: number }) => Math.max(key.r, key.g, key.b) - Math.min(key.r, key.g, key.b) > 100;

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Makes the plain backdrop transparent, whatever colour it was painted.
 * The backdrop is modelled from the border (so off-key, graded or grainy
 * backdrops work) and removed by flood fill from the edges, so backdrop-like
 * colours inside the subject survive. With `holes`, enclosed pockets of
 * backdrop (gaps between branches, inside a bowstring) go too, when the
 * backdrop is vivid. Edge pixels are un-mixed into subject colour plus alpha.
 * `maxTolerance` caps how far (in CIELAB) a pixel may be from the backdrop and
 * still count as backdrop.
 */
export async function removeKeyBackground(
  png: Buffer,
  maxTolerance = 40,
  { holes = false }: { holes?: boolean } = {},
): Promise<KeyCut> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, size = w * h;
  const lab = new Float32Array(size * 3);
  for (let i = 0; i < size; i++) toLab(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, lab, i * 3);

  // Fit the backdrop to the border, then fit again without the border pixels
  // that disagree most (a subject touching the edge, a floor).
  const border = borderBand(w, h);
  const fitLab = (pts: number[]) => [0, 1, 2].map((c) => fitField(pts, (i) => lab[i * 3 + c]!, w, h));
  const distTo = (field: Field[]) => (i: number) => {
    const x = (i % w) / w, y = Math.floor(i / w) / h;
    return Math.hypot(lab[i * 3]! - field[0]!(x, y), lab[i * 3 + 1]! - field[1]!(x, y), lab[i * 3 + 2]! - field[2]!(x, y));
  };
  const first = distTo(fitLab(border));
  const firstDists = border.map(first).sort((a, b) => a - b);
  const cutoff = firstDists[Math.floor(firstDists.length * 0.8)]! * 1.5 + 2;
  const backdrop = border.filter((i) => first(i) <= cutoff);
  const field = fitLab(backdrop);
  const dist = distTo(field);

  // The backdrop's own unevenness sets how far a pixel may stray and still be backdrop.
  const spread = backdrop.map(dist).sort((a, b) => a - b);
  const noise = spread[Math.floor(spread.length * 0.95)] ?? 0;
  const mean = (c: number) => backdrop.reduce((s, i) => s + data[i * 4 + c]!, 0) / Math.max(1, backdrop.length);
  const key = { r: clamp(mean(0)), g: clamp(mean(1)), b: clamp(mean(2)) };
  const tolerance = Math.min(maxTolerance, Math.max(vivid(key) ? MIN_TOLERANCE.vivid : MIN_TOLERANCE.dull, noise * 2.2));

  // Distances, softened over 3x3 so single grains of a noisy backdrop do not stop the fill.
  const d = new Float32Array(size);
  for (let y = 0; y < h; y++) {
    const yn = y / h;
    for (let x = 0; x < w; x++) {
      const xn = x / w, i = y * w + x, o = i * 3;
      const dl = lab[o]! - field[0]!(xn, yn), da = lab[o + 1]! - field[1]!(xn, yn), db = lab[o + 2]! - field[2]!(xn, yn);
      d[i] = Math.sqrt(dl * dl + da * da + db * db);
    }
  }
  const soft = boxSoften(d, w, h);
  // Flood fill the backdrop from every border pixel that matches it.
  const bg = new Uint8Array(size);
  const stack: number[] = [];
  let edgePixels = 0;
  const seed = (i: number) => {
    edgePixels++;
    if (soft[i]! < tolerance && !bg[i]) { bg[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  const clean = stack.length / edgePixels > 0.9;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (n < 0 || n >= size || bg[n] || soft[n]! >= tolerance) continue;
      bg[n] = 1;
      stack.push(n);
    }
  }

  // The backdrop's colour as painted (sRGB), for un-mixing edges and reporting the key.
  const rgb = [0, 1, 2].map((c) => fitField(backdrop, (i) => data[i * 4 + c]!, w, h));

  if (holes && vivid(key)) fillHoles(bg, soft, w, h, tolerance * 0.6, Math.max(24, Math.round(size / 20000)));

  unmixEdges(data, bg, rgb, w, h);
  return { png: await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer(), clean, key };
}

/** Each distance lowered to at most 1.1x its 3x3 neighbourhood's mean (two running sums, not nine reads). */
function boxSoften(d: Float32Array, w: number, h: number): Float32Array {
  const rows = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      rows[i] = d[i]! + (x > 0 ? d[i - 1]! : 0) + (x < w - 1 ? d[i + 1]! : 0);
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = 1 + (y > 0 ? 1 : 0) + (y < h - 1 ? 1 : 0);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const nx = 1 + (x > 0 ? 1 : 0) + (x < w - 1 ? 1 : 0);
      const sum = rows[i]! + (y > 0 ? rows[i - w]! : 0) + (y < h - 1 ? rows[i + w]! : 0);
      out[i] = Math.min(d[i]!, (sum / (nx * ny)) * 1.1);
    }
  }
  return out;
}

/** Marks enclosed runs of near-backdrop pixels as backdrop when big enough to be a gap, not a speck. */
function fillHoles(bg: Uint8Array, dist: Float32Array, w: number, h: number, tolerance: number, minSize: number): void {
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (bg[start] || seen[start] || dist[start]! >= tolerance) continue;
    const region = [start];
    seen[start] = 1;
    for (let k = 0; k < region.length; k++) {
      const i = region[k]!;
      const x = i % w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (n < 0 || n >= w * h || bg[n] || seen[n] || dist[n]! >= tolerance) continue;
        seen[n] = 1;
        region.push(n);
      }
    }
    if (region.length >= minSize) for (const i of region) bg[i] = 1;
  }
}

/**
 * Clears the backdrop and softens the subject's rim. A rim pixel is read as a
 * blend of the nearest solid subject colour and the backdrop behind it: its
 * share of subject becomes its alpha and the backdrop's share is taken out of
 * its colour. A rim pixel that matches neither (a dark seam the model drew)
 * stays as painted.
 */
function unmixEdges(data: Buffer, bg: Uint8Array, backdrop: Field[], w: number, h: number): void {
  const size = w * h;
  const rim = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (!bg[i]) continue;
    const x = i % w, y = Math.floor(i / w);
    const boundary = (x > 0 && !bg[i - 1]) || (x < w - 1 && !bg[i + 1]) || (y > 0 && !bg[i - w]) || (y < h - 1 && !bg[i + w]);
    if (!boundary) continue;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) rim[yy * w + xx] = 1;
      }
    }
  }
  const painted = Buffer.from(data);
  for (let i = 0; i < size; i++) {
    if (bg[i]) { data[i * 4 + 3] = 0; continue; }
    if (!rim[i]) continue;
    const x = i % w, y = Math.floor(i / w);
    const B = [0, 1, 2].map((c) => backdrop[c]!(x / w, y / h));
    let F: number[] | undefined;
    let best = Infinity;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (bg[j] || rim[j] || dx * dx + dy * dy >= best) continue;
        best = dx * dx + dy * dy;
        F = [painted[j * 4]!, painted[j * 4 + 1]!, painted[j * 4 + 2]!];
      }
    }
    const P = [painted[i * 4]!, painted[i * 4 + 1]!, painted[i * 4 + 2]!];
    const subject = F ?? P;
    const toSubject = subject.map((v, c) => v - B[c]!);
    const toPixel = P.map((v, c) => v - B[c]!);
    const length2 = toSubject.reduce((s, v) => s + v * v, 0);
    let a = length2 > 400 ? toPixel.reduce((s, v, c) => s + v * toSubject[c]!, 0) / length2 : 1;
    a = Math.min(1, Math.max(0, a));
    if (Math.hypot(...toPixel.map((v, c) => v - a * toSubject[c]!)) > 60) a = 1;
    if (a < 0.06) { data[i * 4 + 3] = 0; continue; }
    if (a < 0.98) for (let c = 0; c < 3; c++) data[i * 4 + c] = clamp((P[c]! - (1 - a) * B[c]!) / a);
    data[i * 4 + 3] = Math.round(a * 255);
  }
}

const MAGENTA = { r: 255, g: 0, b: 255 };

/** The channels a backdrop is strong and weak in, when it is one saturated hue; undefined for a dull or mixed one. */
function pureChannels(key: { r: number; g: number; b: number }): { strong: number[]; weak: number[] } | undefined {
  const k = [key.r, key.g, key.b];
  const mid = (Math.max(...k) + Math.min(...k)) / 2;
  const strong = [0, 1, 2].filter((c) => k[c]! >= mid);
  const weak = [0, 1, 2].filter((c) => k[c]! < mid);
  if (!weak.length || Math.min(...strong.map((c) => k[c]!)) - Math.max(...weak.map((c) => k[c]!)) < 150) return undefined;
  return { strong, weak };
}

/**
 * Clears the backdrop colour that bleeds into soft glows (a lantern's halo
 * painted over the backdrop): pixels leaning far more towards the backdrop's
 * strong channels than anything in a subject turn transparent, and milder
 * ones lose the cast. Give it the `key` the cut found. Only a saturated key
 * (pure magenta, pure green) is far enough from every subject colour to be
 * cleared this way; for a dull one (a dusty pink some models paint) it
 * clears magenta, the colour that was asked for, as it always has.
 */
export async function removeKeySpill(png: Buffer, threshold = 70, key = MAGENTA): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { strong, weak } = pureChannels(key) ?? pureChannels(MAGENTA)!;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const high = Math.min(...strong.map((c) => data[i + c]!));
    const low = Math.max(...weak.map((c) => data[i + c]!));
    const spill = high - low;
    if (spill >= threshold) data[i + 3] = 0;
    else if (spill > threshold / 2) {
      // Pull the strong channels back towards the weak ones, which the backdrop has little of.
      const keep = low + threshold / 2;
      for (const c of strong) data[i + c] = Math.min(data[i + c]!, keep);
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
