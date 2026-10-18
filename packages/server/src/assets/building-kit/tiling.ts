import { crop, dpx, evenRound, fixed, lum, mean, median, medianColour, percentile, profile, repeat, roll, rowsOf, runs, stack, transpose, type Img } from './pixels.ts';

// Making a painted texture repeat, and checking that it does. The image model
// paints a material flat once; these turn the painting into a tile without
// drawing anything.
//
// Two kinds of texture:
//  - Loose ones (plaster, wood grain) are joined along their cleanest cut, the
//    line where the two edges agree.
//  - Rows with offset joints (shingles, stones, boards with staggered ends)
//    are rebuilt from their own whole rows: each row is cut at two of its own
//    joints, so every shape stays whole, and rows are slid sideways so their
//    joints never line up. A free cut would slice shapes into slivers.
//
// Every tile is then judged: its wrap-around edges must look like the inside
// of the painting, and a rows texture must keep the painting's shape sizes,
// row heights and offset joints.

/** The worst short stretch along a seam: a notch a few pixels long shows even when the average is fine. */
export function worstStretch(d: ArrayLike<number>, n = 8): number {
  const len = d.length;
  if (len <= n) return mean(d);
  let s = 0;
  for (let i = 0; i < n; i++) s += d[i]!;
  let best = s;
  for (let i = 1; i < len; i++) {
    s += d[(i + n - 1) % len]! - d[i - 1]!;
    best = Math.max(best, s);
  }
  return best / n;
}

/** How a seam compares with the texture's own pixel-to-pixel steps, and the limits it must stay under to be invisible once tiled. */
export interface Seam {
  ok: boolean;
  mean: number;
  worst: number;
  lim: number;
}

/** The texture with what runs down it running across (axis 0), or as it is (axis 1). */
const across = (T: Img, axis: 0 | 1): Img => (axis === 1 ? T : transpose(T));

/** The wrap-around edge of a texture along an axis: left meeting right (1), or top meeting bottom (0). */
export function seam(T: Img, axis: 0 | 1): Seam {
  const { w, h, d } = across(T, axis);
  const jump = new Float64Array(h);
  let adj = 0;
  for (let y = 0; y < h; y++) {
    jump[y] = dpx(d, y * w, d, y * w + w - 1);
    for (let x = 0; x + 1 < w; x++) adj += dpx(d, y * w + x, d, y * w + x + 1);
  }
  adj /= h * (w - 1);
  const lim = Math.max(2.5 * adj, 8);
  const [m, worst] = [mean(jump), worstStretch(jump)];
  return { ok: m <= lim && worst <= 3 * lim, mean: m, worst, lim };
}

// ---- loose textures ----------------------------------------------------------------

/**
 * Joins the right edge onto the left along the cleanest cut (graph-cut
 * texture joining): the last k columns overlap the first k, and the join
 * switches from one to the other along the path where the two agree, free to
 * run sideways so it follows the painting's own lines. Returns the texture,
 * k columns narrower, and for every pair of pixels the cut separates how much
 * the switch shows there (the smaller of the two sides' mismatches).
 */
function seamJoin(A: Img, k: number): { out: Img; shows: number[] } {
  const { w, h, d } = A;
  const n = k + 1;
  const D = new Float64Array(h * k);
  const Q = new Float64Array(h * k);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < k; x++) {
      D[y * k + x] = dpx(d, y * w + x, d, y * w + w - k + x);
      Q[y * k + x] = D[y * k + x]! * D[y * k + x]!; // squared, so the cut avoids big jumps
    }
  }
  // the cost of switching in a row just before column i (0..k)
  const Hc = new Float64Array(h * n);
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < n; i++) Hc[y * n + i] = Math.min(Q[y * k + Math.max(i - 1, 0)]!, Q[y * k + Math.min(i, k - 1)]!);
  }
  const back = new Int32Array(h * n);
  let C = Hc.slice(0, n);
  const [S, v, fi, v2, m2, bi] = [new Float64Array(n), new Float64Array(n), new Int32Array(n), new Float64Array(n), new Float64Array(n), new Int32Array(n)];
  for (let y = 1; y < h; y++) {
    S[0] = 0; // the cost of running sideways between two rows
    for (let j = 0; j < k; j++) S[j + 1] = S[j]! + Math.min(Q[(y - 1) * k + j]!, Q[y * k + j]!);
    let m = Infinity;
    let f = 0;
    for (let i = 0; i < n; i++) {
      v[i] = C[i]! - S[i]!;
      m = Math.min(m, v[i]!);
      if (v[i] === m) f = i;
      fi[i] = f;
      v[i] = S[i]! + m; // F: arriving from the left
    }
    let m2v = Infinity;
    let b = n;
    for (let i = n - 1; i >= 0; i--) {
      v2[i] = C[i]! + S[i]!;
      m2v = Math.min(m2v, v2[i]!);
      m2[i] = m2v;
    }
    for (let i = n - 1; i >= 0; i--) {
      if (v2[i] === m2[i]) b = Math.min(b, i);
      bi[i] = b;
    }
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const [F, B] = [v[i]!, m2[i]! - S[i]!];
      back[y * n + i] = F <= B ? fi[i]! : bi[i]!;
      next[i] = Math.min(F, B) + Hc[y * n + i]!;
    }
    C = next;
  }
  const cut = new Int32Array(h);
  let best = 0;
  for (let i = 1; i < n; i++) if (C[i]! < C[best]!) best = i;
  cut[h - 1] = best;
  for (let y = h - 1; y > 0; y--) cut[y - 1] = back[y * n + cut[y]!]!;
  const out = crop(A, 0, 0, w - k, h);
  for (let y = 0; y < h; y++) out.d.set(d.subarray((y * w + w - k) * 3, (y * w + w - k + cut[y]!) * 3), y * (w - k) * 3);
  const Dp = (y: number, i: number) => D[y * k + Math.min(Math.max(i - 1, 0), k - 1)]!;
  const shows: number[] = [];
  for (let y = 0; y < h; y++) shows.push(Math.min(Dp(y, cut[y]!), Dp(y, cut[y]! + 1)));
  for (let y = 1; y < h; y++) {
    const [a, z] = [Math.min(cut[y - 1]!, cut[y]!), Math.max(cut[y - 1]!, cut[y]!)];
    for (let x = a; x < z; x++) shows.push(Math.min(D[(y - 1) * k + x]!, D[y * k + x]!));
  }
  return { out, shows };
}

/** Average colour distance between the texture and itself slid P columns along. */
function shifted(A: Img, P: number): number {
  let s = 0;
  for (let y = 0; y < A.h; y++) for (let x = 0; x + P < A.w; x++) s += dpx(A.d, y * A.w + x, A.d, y * A.w + x + P);
  return s / (A.h * (A.w - P));
}

/**
 * One direction of a loose texture made to repeat: unchanged if it already
 * joins itself; else cut to one exact repeat of its pattern when it clearly
 * repeats; else joined along its cleanest cut over the overlap that shows
 * least. Refused when none is clean (never cross-faded: fading leaves ghost
 * smudges at every repeat). Returns the texture, how, and whether it worked.
 */
export function makeSeamless(T: Img, axis: 0 | 1, freeCut = true): [Img, string, boolean] {
  const s = seam(T, axis);
  if (s.ok) return [T, 'joins itself', true];
  const A = across(T, axis);
  const w = A.w;
  const scores: [number, number][] = [];
  for (let P = Math.trunc(0.45 * w); P < Math.trunc(0.92 * w); P++) scores.push([shifted(A, P), P]);
  if (scores.length) {
    const [best, P] = scores.reduce((a, b) => (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a));
    if (best <= 0.6 * median(scores.map((x) => x[0]))) {
      const C = crop(A, 0, 0, P, A.h);
      if (seam(C, 1).ok) return [across(C, axis), `cut to one repeat (${P} of ${w} px)`, true];
    }
  }
  if (!freeCut) return [T, 'no exact repeat found, and a free cut would slice its shapes', false];
  const lim = s.lim;
  const step = Math.max(1, Math.trunc(w / 100));
  const attempt = (k: number) => {
    const { out, shows } = seamJoin(A, k);
    const [m, worst] = [mean(shows), worstStretch(shows)];
    return { score: Math.max(m / lim, worst / (3 * lim)) * (1 + (0.5 * k) / w), k, out, m, worst };
  };
  const tries: ReturnType<typeof attempt>[] = [];
  for (let k = Math.max(8, Math.trunc(0.06 * w)); k <= Math.trunc(0.5 * w); k += step) tries.push(attempt(k));
  for (const { k: k0 } of [...tries].sort((a, b) => a.score - b.score).slice(0, 2)) {
    // look closer round the two best overlaps
    for (let k = Math.max(8, k0 - step + 1); k < Math.min(Math.trunc(0.5 * w), k0 + step); k++) if (k !== k0) tries.push(attempt(k));
  }
  const t = tries.reduce((a, b) => (b.score < a.score ? b : a));
  const C = across(t.out, axis);
  const ok = t.m <= lim && t.worst <= 3 * lim && seam(C, axis).ok;
  return [C, `joined along its cleanest cut over ${t.k} of ${w} px (shows ${fixed(t.m, 1)} on average, ${fixed(t.worst, 1)} at worst; limits ${fixed(lim, 1)}/${fixed(3 * lim, 1)})`, ok];
}

// ---- rows with offset joints ----------------------------------------------------------

/** The row lines of a texture whose rows run left to right (mortar, shingle shadows, board joints). */
export interface RowLines {
  /** +1 when the lines are darker than the usual rows, -1 when lighter. */
  sign: 1 | -1;
  lim: number;
  /** Every run of line rows, edge runs included: [first row, height]. */
  bands: [number, number][];
  /** The runs inside the picture, not touching its edges. */
  inside: [number, number][];
  colour: [number, number, number] | null;
  /** The usual thickness of a line inside. */
  line: number;
}

/**
 * Finds the row lines: runs of rows clearly darker, or clearly lighter, than
 * the usual row, whichever stands out most. A line stands out by more than
 * the rows differ among themselves, or by at least half as much as the most
 * outstanding rows do (rows of two colours).
 */
export function rowLines(T: Img): RowLines {
  const h = T.h;
  const prof = profile(lum(T), T.w, h, false);
  const inner = prof.slice(Math.trunc(0.1 * h), Math.trunc(0.9 * h));
  const m = median(inner);
  const spread = 4 * 1.4826 * median(inner.map((x) => Math.abs(x - m)));
  const kinds = ([1, -1] as const).map((sign) => {
    const dev = prof.map((p) => sign * (p - m));
    const top = percentile(dev, 99);
    const lim = Math.max(0.04, Math.min(spread, 0.5 * top));
    return { sign, bands: runs(Array.from(dev, (x) => x > lim)), lim, top };
  });
  // the lines are the side (darker or lighter) with the strongest outliers, if it has any runs
  const [k0, k1] = [kinds[0]!, kinds[1]!];
  const [has0, has1] = [k0.bands.length > 0, k1.bands.length > 0];
  const pick = (has1 && !has0) || (has1 === has0 && k1.top > k0.top) ? k1 : k0;
  const inside = pick.bands.filter(([s, b]) => s > 0 && s + b < h);
  const rows = inside.map(([s, b]) => s + Math.floor(b / 2));
  const colour = rows.length ? medianColour(T, rows.flatMap((r) => Array.from({ length: T.w }, (_, x) => r * T.w + x))) : null;
  return { sign: pick.sign, lim: pick.lim, bands: pick.bands, inside, colour, line: inside.length ? median(inside.map(([, b]) => b)) : 0 };
}

/** How many rows a repeating texture has once tiled: its row lines, counted round the wrap. */
export function countRows(T: Img): number {
  const B = rowLines(T).bands;
  return B.length - (B.length >= 2 && B[0]![0] === 0 && B.at(-1)![0] + B.at(-1)![1] === T.h ? 1 : 0);
}

/**
 * The joints in the row between rows r0 and r1: narrow upright runs of line
 * colour (the gaps between shingles, stones or board ends). A run as wide as
 * a shape is a dark shape, not a joint. Returns [centre, width] each.
 */
export function joints(T: Img, st: RowLines, r0: number, r1: number): [number, number][] {
  if (r1 - r0 < 3 || !st.colour) return [];
  const w = T.w;
  const lw = Math.max(3, st.line);
  const C = new Float64Array(w * 3);
  for (let y = r0; y < r1; y++) for (let i = 0; i < w * 3; i++) C[i]! += T.d[y * w * 3 + i]!;
  for (let i = 0; i < w * 3; i++) C[i]! /= r1 - r0;
  const colp = Array.from({ length: w }, (_, x) => (C[x * 3]! * 0.299 + C[x * 3 + 1]! * 0.587 + C[x * 3 + 2]! * 0.114) / 255);
  const r = evenRound(3 * lw);
  const side = colp.map((_, x) => (colp[Math.max(0, x - r)]! + colp[Math.min(w - 1, x + r)]!) / 2);
  const shape = medianColour(rowsOf(T, r0, r1));
  const farness = dpx(shape, 0, st.colour, 0);
  const flags = colp.map((c, x) => st.sign * (c - side[x]!) > 0.75 * st.lim && dpx(C, x, st.colour!, 0) < 0.5 * farness);
  return runs(flags).filter(([, b]) => b <= 2 * lw + 2).map(([s, b]) => [s + b / 2, b]);
}

/** How uneven one row is: its pixels' average distance from its median colour. */
function unevenness(T: Img, y: number): number {
  const c = medianColour(T, Array.from({ length: T.w }, (_, x) => y * T.w + x));
  let s = 0;
  for (let x = 0; x < T.w; x++) s += dpx(T.d, y * T.w + x, c, 0);
  return s / T.w;
}

/**
 * The places in a line where the row above may end and the row below begin.
 * A line row whose marks sit under the joints of the row above belongs to
 * that row; one whose marks sit over the joints of the row below belongs to
 * it; a plain row to either, and the cut goes through the plainest rows. Rows
 * are later slid sideways, so every mark must move with its joint.
 */
function split(T: Img, s: number, b: number, JU: number[], JL: number[], lw: number): number[] {
  const near = Math.max(2, lw / 2);
  const mask = (J: number[]) => Array.from({ length: T.w }, (_, x) => J.some((j) => Math.abs(x - j) <= near));
  const [mU, mL] = [mask(JU), mask(JL)];
  const rest = mU.map((u, x) => !u && !mL[x]);
  const avg = (dev: number[], m: boolean[]) => mean(dev.filter((_, x) => m[x]));
  const [up, lo]: [boolean[], boolean[]] = [[], []];
  for (let r = s; r < s + b; r++) {
    const c = medianColour(T, Array.from({ length: T.w }, (_, x) => r * T.w + x));
    const dev = Array.from({ length: T.w }, (_, x) => dpx(T.d, r * T.w + x, c, 0));
    const base = rest.some(Boolean) ? avg(dev, rest) : mean(dev);
    const aU = mU.some(Boolean) ? Math.abs(avg(dev, mU) - base) : 0;
    const aL = mL.some(Boolean) ? Math.abs(avg(dev, mL) - base) : 0;
    up.push(aU > aL + 3);
    lo.push(aL > aU + 3);
  }
  const cost = (y: number) => lo.slice(0, y - s).filter(Boolean).length + up.slice(y - s).filter(Boolean).length;
  const plain = (y: number) => (y > 0 ? unevenness(T, y - 1) : 0) + (y < T.h ? unevenness(T, y) : 0);
  const ys = Array.from({ length: b + 1 }, (_, i) => s + i).map((y) => ({ y, c: cost(y), p: plain(y) }));
  ys.sort((a, z) => a.c - z.c || a.p - z.p);
  return ys.filter((q) => q.c === ys[0]!.c).map((q) => q.y); // every equally right place, plainest first
}

type Rows = [number, number];

/** The rows of the painting: each stretch of shapes between two lines with its joints, and where each line inside splits. */
function rowsLayout(T: Img, st: RowLines): { shapeRows: Rows[]; J: Map<Rows, number[]>; splits: [number[], number, number][] } {
  const lw = Math.max(3, st.line);
  const edges = [0, ...st.bands.flatMap(([s, b]) => [s, s + b]), T.h];
  const shapeRows: Rows[] = [];
  for (let i = 0; i < edges.length; i += 2) if (edges[i + 1]! > edges[i]!) shapeRows.push([edges[i]!, edges[i + 1]!]);
  const J = new Map(shapeRows.map((r) => [r, joints(T, st, r[0], r[1]).map(([c]) => c)] as const));
  const above = (s: number) => J.get(shapeRows.find((r) => r[1] === s)!) ?? [];
  const below = (e: number) => J.get(shapeRows.find((r) => r[0] === e)!) ?? [];
  const splits = st.inside.map(([s, b]) => [split(T, s, b, above(s), below(s + b), lw), s, b] as [number[], number, number]);
  return { shapeRows, J, splits };
}

/**
 * Cuts the texture into units of one row each, at the splits of its lines.
 * The tiled texture's top and bottom meet in a line made of the last line's
 * part above its split and the first line's part below it, which together
 * must be about as thick as the lines inside. Returns candidates (row ranges,
 * that wrap line's thickness), most rows first.
 */
function units(T: Img, st: RowLines, splits: [number[], number, number][], minRows: number): [Rows[], number][] {
  const B = st.bands;
  if (!splits.length) return [];
  const slack = Math.max(2, 0.35 * st.line);
  const firsts: [number, [number, number][]][] = splits.map(([ys, s, b], i) => [i, ys.map((y) => [y, s + b - y] as [number, number])]);
  if (B[0]![0] === 0) firsts.push([-1, [[0, B[0]![1]]]]);
  const lasts: [number, [number, number][]][] = splits.map(([ys, s], i) => [i, ys.map((y) => [y, y - s] as [number, number])]);
  if (B.at(-1)![0] + B.at(-1)![1] === T.h) lasts.push([splits.length, [[T.h, B.at(-1)![1]]]]);
  const out: { key: [number, number]; U: Rows[]; thick: number }[] = [];
  for (const [i, fa] of firsts) {
    for (const [j, la] of lasts) {
      if (j <= i || j - i < minRows) continue;
      let best: [number, number, number, number] | null = null;
      for (const [a, below] of fa) {
        for (const [z, above] of la) {
          const f: [number, number, number, number] = [Math.abs(below + above - st.line), a, z, below + above];
          if (!best || f[0] < best[0] || (f[0] === best[0] && (f[1] < best[1] || (f[1] === best[1] && (f[2] < best[2] || (f[2] === best[2] && f[3] < best[3])))))) best = f;
        }
      }
      const [off, a, z, thick] = best!;
      if (off > slack) continue;
      const ys = [a, ...Array.from({ length: j - i - 1 }, (_, n) => splits[i + 1 + n]![0][0]!), z];
      out.push({ key: [ys.length - 1, z - a], U: ys.slice(0, -1).map((y, n) => [y, ys[n + 1]!] as Rows), thick });
    }
  }
  out.sort((p, q) => q.key[0] - p.key[0] || q.key[1] - p.key[1]);
  return out.map((o) => [o.U, o.thick]);
}

/** A strip stretched to W columns by straight interpolation (used for at most a few percent). */
function resample(S: Img, W: number): Img {
  if (S.w === W) return crop(S, 0, 0, S.w, S.h);
  const out = new Float64Array(W * S.h * 3);
  for (let X = 0; X < W; X++) {
    const x = ((X + 0.5) * S.w) / W - 0.5;
    const i = Math.min(Math.max(Math.floor(x), 0), S.w - 1);
    const j = Math.min(i + 1, S.w - 1);
    const f = Math.min(Math.max(x - i, 0), 1);
    for (let y = 0; y < S.h; y++) for (let c = 0; c < 3; c++) out[(y * W + X) * 3 + c] = S.d[(y * S.w + i) * 3 + c]! * (1 - f) + S.d[(y * S.w + j) * 3 + c]! * f;
  }
  return { w: W, h: S.h, d: out };
}

/** The smallest distance, round a tile W wide, between any joint of one row and any of the next. */
function cycGap(A: number[], B: number[], W: number): number {
  if (!A.length || !B.length) return W;
  let best = Infinity;
  for (const a of A) {
    for (const b of B) {
      const d = (((a - b) % W) + W) % W;
      best = Math.min(best, d, W - d);
    }
  }
  return best;
}

/** Colour distances, pixel by pixel, between row ya of A and row yb of B. */
function rowGap(A: Img, ya: number, B: Img, yb: number): number[] {
  return Array.from({ length: A.w }, (_, x) => dpx(A.d, ya * A.w + x, B.d, yb * B.w + x));
}

/**
 * Where units meet in the tile (and round the wrap), the two rows that meet
 * must look much like the same rows of the painting where they met their own
 * neighbours: no much bigger jump, and no much worse stretch of it.
 */
function junctions(tile: Img, U: Rows[], T: Img, lim: number): string[] {
  const bad: string[] = [];
  let y = 0;
  U.forEach((u, i) => {
    const [up, lo] = [U.at(i - 1)![1] - 1, u[0]];
    const ref = [...(up + 1 < T.h ? [rowGap(T, up, T, up + 1)] : []), ...(lo > 0 ? [rowGap(T, lo - 1, T, lo)] : [])];
    const rm = ref.length ? mean(ref.map((r) => mean(r))) : 0;
    const rw = Math.max(0, ...ref.map((r) => worstStretch(r)));
    const j = rowGap(tile, (y - 1 + tile.h) % tile.h, tile, y);
    const [m, wv] = [mean(j), worstStretch(j)];
    if (m > 1.75 * rm + lim || wv > 1.35 * rw + 3 * lim) bad.push(`row ${y}: jump ${fixed(m)} (painted ${fixed(rm)}), worst ${fixed(wv)} (painted ${fixed(rw)})`);
    y += u[1] - u[0];
  });
  return bad;
}

/** Indices of values, smallest value first (equal values in order). */
const order = (v: ArrayLike<number>) => Array.from({ length: v.length }, (_, i) => i).sort((a, b) => v[a]! - v[b]! || a - b);

/**
 * Rebuilds a texture of rows with offset joints as a tile from its own whole
 * rows. Each unit (one row with its line) is cut at two of its joints the
 * same distance apart (the tile width, stretched by at most a few percent),
 * so the tile's edge falls in a joint and no shape is cut. A row without
 * joints is cut where its two ends match. Rows are then slid sideways so
 * their joints stay well away from those of the rows above and below.
 * Returns [tile, how] or [null, why].
 */
export function rowsTile(T: Img, minRows = 2, stretch = 0.03, judge = true, slide = true): [Img | null, string] {
  const st = rowLines(T);
  const { w, h } = T;
  const { shapeRows, J, splits } = rowsLayout(T, st);
  const cands = units(T, st, splits, minRows);
  if (!cands.length) return [null, `its row lines leave fewer than ${minRows} whole rows that can meet in a line once tiled`];
  const widths = shapeRows.flatMap((r) => J.get(r)!.slice(1).map((b, i) => b - J.get(r)![i]!));
  const [wmin, wmax] = widths.length ? [Math.min(...widths), Math.max(...widths)] : [0, w];
  const lim = Math.max(seam(T, 1).lim, 8);
  const why: string[] = [];
  for (const [U, wrapLine] of cands.slice(0, 4)) {
    const info = U.map(([a, z]) => {
      const Ju = shapeRows.filter((r) => a <= r[0] && r[0] < z).flatMap((r) => J.get(r)!).sort((p, q) => p - q);
      // how different two joints of this row normally are
      const cols = Ju.map((j) => evenRound(j));
      const pairs: number[][] = [];
      for (let i = 0; i < cols.length; i++) for (let k = i + 1; k < cols.length; k++) pairs.push(Array.from({ length: z - a }, (_, y) => dpx(T.d, (a + y) * w + cols[i]!, T.d, (a + y) * w + cols[k]!)));
      const ref: [number, number] = pairs.length ? [median(pairs.map((p) => mean(p))), median(pairs.map((p) => worstStretch(p)))] : [0, 0];
      return { a, z, J: Ju, ref };
    });
    type Unit = (typeof info)[number];
    type Win = [number, number, number, 'joints' | 'ends'];
    const cutOk = (u: Unit, pa: number, pb: number) => {
      const d = Array.from({ length: u.z - u.a }, (_, y) => dpx(T.d, (u.a + y) * w + pa, T.d, (u.a + y) * w + pb));
      return mean(d) <= 1.75 * u.ref[0] + lim && worstStretch(d) <= 1.35 * u.ref[1] + 3 * lim;
    };
    const window = (u: Unit, W: number): Win | null => {
      let best: Win | null = null;
      u.J.forEach((ja, i) => {
        // cut at two joints that look alike
        for (const jb of u.J.slice(i + 1)) {
          const dev = Math.abs(jb - ja - W) / W;
          const [pa, pb] = [evenRound(ja), evenRound(jb)];
          if (dev <= stretch && (!best || dev < best[0]) && cutOk(u, pa, pb)) best = [dev, pa, pb - pa, 'joints'];
        }
      });
      if (best) return best;
      // a row with no usable joints: cut where its ends match
      if (W >= w) return null;
      const S = rowsOf(T, u.a, u.z);
      const D = (y: number, p: number) => dpx(S.d, y * w + p, S.d, y * w + p + W);
      const avg = Array.from({ length: w - W }, (_, p) => {
        let s = 0;
        for (let y = 0; y < S.h; y++) s += D(y, p);
        return s / S.h;
      });
      const sl = seam(S, 1);
      const good: [number, number, number][] = [];
      for (const p of order(avg).slice(0, 60)) {
        // a straight step across a plain shape shows early: half the usual limits
        if (avg[p]! > 0.5 * sl.lim || worstStretch(Array.from({ length: S.h }, (_, y) => D(y, p))) > 1.5 * sl.lim) break;
        const nxt = u.J.filter((j) => j > p);
        const prv = u.J.filter((j) => j < p + W);
        const merged = (nxt.length ? Math.min(...nxt) - p : 0) + (prv.length ? p + W - Math.max(...prv) : 0);
        if (!u.J.length || (wmin * 0.7 <= merged && merged <= wmax * 1.35)) good.push([-u.J.filter((j) => p + 8 < j && j < p + W - 8).length, avg[p]!, p]); // keep the row's joints in
      }
      if (!good.length) return null;
      const g = good.reduce((x, y) => (y[0] < x[0] || (y[0] === x[0] && (y[1] < x[1] || (y[1] === x[1] && y[2] < x[2]))) ? y : x));
      return [0, g[2], W, 'ends'];
    };
    let choice: [number, number, Win[]] | null = null;
    for (let W = Math.trunc(0.95 * w); W > Math.trunc(0.4 * w); W -= 2) {
      const wins = info.map((u) => window(u, W));
      if (wins.every(Boolean)) {
        const dev = Math.max(...wins.map((x) => x![0]));
        const score = W / w - 3 * dev;
        if (!choice || score > choice[0]) choice = [score, W, wins as Win[]];
        if (dev <= 0.01) break;
      }
    }
    if (!choice) {
      why.push(`rows ${U[0]![0]} to ${U.at(-1)![1]}: no tile width fits two joints in every row`);
      continue;
    }
    const [, W, wins] = choice;
    // a cut between matching ends still counts as a joint when sliding, so such cuts never line up into one long seam
    const strips = info.map((u, i) => resample(crop(T, wins[i]![1], u.a, wins[i]![1] + wins[i]![2], u.z), W));
    const Js = info.map((u, i) => {
      const [, p, sep, how] = wins[i]!;
      return [...u.J.filter((j) => p <= j && j <= p + sep).map((j) => ((j - p) * W) / sep), ...(how === 'ends' ? [0] : [])];
    });
    const n = strips.length;
    const offs = new Array<number>(n).fill(0);
    for (let round = 0; round < (slide && n > 1 ? 4 : 0); round++) {
      // slide each row away from the joints above and below it
      for (let i = 1; i < n; i++) {
        const near = [...new Set([(i - 1 + n) % n, (i + 1) % n])];
        const gap = (o: number) => Math.min(...near.map((k) => cycGap(Js[i]!.map((j) => j + o), Js[k]!.map((j) => j + offs[k]!), W)));
        let best = 0;
        let key: [number, number] = [-Infinity, -Infinity];
        for (let o = 0; o < W; o += 2) {
          const kk: [number, number] = [gap(o), -Math.abs(o - offs[i]!)];
          if (kk[0] > key[0] || (kk[0] === key[0] && kk[1] > key[1])) [best, key] = [o, kk];
        }
        offs[i] = best;
      }
    }
    const tile = stack(strips.map((s, i) => roll(s, offs[i]!)));
    const bad = junctions(tile, U, T, lim);
    if (bad.length && judge) {
      why.push(`rows ${U[0]![0]} to ${U.at(-1)![1]}: where rows meet, ${bad.join('; ')}`);
      continue;
    }
    const gaps = Js.map((_, i) => cycGap(Js[i]!.map((j) => j + offs[i]!), Js[(i + 1) % n]!.map((j) => j + offs[(i + 1) % n]!), W));
    const nj = wins.filter((x) => x[3] === 'joints').length;
    const cuts = `${nj} cut at two joints${nj < n ? ` and ${n - nj} where their ends match` : ''}`;
    const most = Math.max(...wins.map((x) => x[0]));
    return [tile, `rebuilt from ${n} of its own rows (${U[0]![0]} to ${U.at(-1)![1]} of ${h} px), ${cuts}, to ${W} of ${w} px (stretched at most ${fixed(most * 100, 1)}%) and slid so joints stay at least ${fixed(Math.min(...gaps))} px apart (the line where tiles meet top to bottom is ${wrapLine} px, the ones inside ${fixed(st.line)} px)`];
  }
  return [null, why.join('; ')];
}

/** Shape widths between joints, row heights between lines, and the most rows a crack of lined-up joints runs through. */
export function shapes(T: Img, tiled = false): { widths: number[]; heights: number[]; crack: number } {
  if (tiled) T = repeat(T, 2, 2); // the rows and joints where tiles meet count too
  const st = rowLines(T);
  const cs = st.inside.map(([s, b]) => s + b / 2);
  const heights = cs.slice(1).map((c, i) => c - cs[i]!);
  const rows = st.inside.slice(1).map(([s1], i) => joints(T, st, st.inside[i]![0] + st.inside[i]![1], s1).map(([c]) => c));
  const widths = rows.flatMap((J) => J.slice(1).map((b, i) => b - J[i]!));
  const near = 0.1 * (widths.length ? median(widths) : T.w);
  let crack = 0;
  let prev: [number, number][] = [];
  for (const J of rows) {
    const cur = J.map((j) => [j, 1 + Math.max(0, ...prev.filter(([k]) => Math.abs(k - j) < near).map(([, n]) => n))] as [number, number]);
    crack = Math.max(crack, ...cur.map(([, n]) => n));
    prev = cur;
  }
  return { widths, heights, crack };
}

/** Whether a rows tile keeps the painting's shape sizes, row heights and offset joints. */
export interface ShapesKept {
  ok: boolean;
  problems: string[];
  tileRows: number;
  widths: [number, number] | null;
  paintedWidths: [number, number] | null;
}

/**
 * A rows tile must look like the painting it came from: no shape narrower or
 * wider than the painting has (slivers or merged shapes), no row shorter or
 * taller, and no crack of joints running straight down through more rows
 * than the painting has.
 */
export function shapesCheck(painted: Img, tile: Img): ShapesKept {
  const [P, Q] = [shapes(painted), shapes(tile, true)];
  const bad: string[] = [];
  const span = (v: number[]) => [Math.min(...v), Math.max(...v)] as const;
  if (P.widths.length && Q.widths.length) {
    const [lo, hi] = [0.7 * span(P.widths)[0], 1.35 * span(P.widths)[1]];
    const odd = Q.widths.filter((x) => !(lo <= x && x <= hi)).map(evenRound);
    if (odd.length) bad.push(`shapes [${odd.join(', ')}] px wide where the painting has ${fixed(span(P.widths)[0])} to ${fixed(span(P.widths)[1])} px`);
  }
  if (P.heights.length && Q.heights.length) {
    const [lo, hi] = [0.85 * span(P.heights)[0], 1.15 * span(P.heights)[1]];
    const odd = Q.heights.filter((x) => !(lo <= x && x <= hi)).map(evenRound);
    if (odd.length) bad.push(`rows [${odd.join(', ')}] px tall where the painting has ${fixed(span(P.heights)[0])} to ${fixed(span(P.heights)[1])} px`);
  }
  if (Q.crack > Math.max(P.crack, 2)) bad.push(`joints line up straight down through ${Q.crack} rows (in the painting at most ${Math.max(P.crack, 2)})`);
  if (P.heights.length && !Q.heights.length) bad.push('no rows found in the tile');
  return {
    ok: !bad.length,
    problems: bad,
    tileRows: countRows(tile),
    widths: Q.widths.length ? [evenRound(span(Q.widths)[0]), evenRound(span(Q.widths)[1])] : null,
    paintedWidths: P.widths.length ? [evenRound(span(P.widths)[0]), evenRound(span(P.widths)[1])] : null,
  };
}
