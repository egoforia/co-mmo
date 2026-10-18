import { crop, dpx, evenRound, lum, mean, median, profile, resized, runs, type Img } from './pixels.ts';
import { GREEN, MAGENTA, MARGIN, SHEET, fillConvex, shapePoly, type SheetLayout, type SheetRegion } from './sheet.ts';
import { makeSeamless, rowsTile, seam, shapesCheck } from './tiling.ts';

// The free checks a painted sheet must pass before any building uses it: each
// shape painted in its place, filled, with no spill, no baked light, even, no
// frame, and (for repeating textures) a tile that repeats cleanly. A shape
// painted a few pixels off its place is read where it was painted, at its
// exact layout size. Fitted textures keep every pixel of their shape: edges
// are refilled from just inside, never stretched, so a door's picture still
// matches the door's outline exactly.

/** One check on one painted texture, with what it measured. */
export type TextureCheck = { ok: boolean } & Record<string, unknown>;

/** Every check on one painted texture, and whether it may be used. */
export interface TextureReport {
  ok: boolean;
  checks: Record<string, TextureCheck>;
  /** Which painting it was taken from, when several were checked. */
  painting?: string;
}

/** A painted sheet read against its layout. */
export interface CheckedSheet {
  report: Record<string, TextureReport>;
  /** Each texture's pixels as it will be used: a tile for repeating ones. */
  textures: Record<string, Img>;
  /** What one tile covers in kit units, for repeating textures. */
  tiles: Record<string, [number, number]>;
}

/** Most brightness change a texture may have from one side to the other: light belongs to the game. */
export const SLOPE = 0.12;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Square-window maximum (grow) or minimum (shrink) of a mask, radius g, the window cut short at the edges. Counted along rows then columns, so it stays quick for a wide window. */
function rank(m: Uint8Array, w: number, h: number, g: number, grow: boolean): Uint8Array {
  const pass = (src: Uint8Array, n: number, lines: number, step: number, next: number) => {
    const out = new Uint8Array(src.length);
    const sum = new Int32Array(n + 1);
    for (let l = 0; l < lines; l++) {
      for (let i = 0; i < n; i++) sum[i + 1] = sum[i]! + src[l * next + i * step]!;
      for (let i = 0; i < n; i++) {
        const [lo, hi] = [Math.max(0, i - g), Math.min(n - 1, i + g)];
        const ones = sum[hi + 1]! - sum[lo]!;
        out[l * next + i * step] = (grow ? ones > 0 : ones === hi - lo + 1) ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(m, w, h, 1, w), h, w, w, 1);
}

/** A shape's pixels on a W × H sheet, grown (or shrunk) by some pixels. Drawn only round the shape, so it stays quick on a large sheet. */
export function shapeMask(r: SheetRegion, W: number, H: number, grow = 0): Uint8Array {
  const [x, y, w, h] = r.box;
  const p = Math.abs(grow) + 4;
  const [X0, Y0, X1, Y1] = [Math.max(0, x - p), Math.max(0, y - p), Math.min(W, x + w + p), Math.min(H, y + h + p)];
  const [lw, lh] = [X1 - X0, Y1 - Y0];
  let m: Uint8Array = new Uint8Array(lw * lh);
  fillConvex(shapePoly(r).map(([a, b]) => [a - X0, b - Y0]), lw, lh, (px, py) => (m[py * lw + px] = 1));
  if (grow) m = rank(m, lw, lh, Math.abs(grow), grow > 0);
  const out = new Uint8Array(W * H);
  for (let j = 0; j < lh; j++) out.set(m.subarray(j * lw, (j + 1) * lw), (Y0 + j) * W + X0);
  return out;
}

/** Mean brightness of n × n blocks of a texture, row by row. */
function blocks(T: Img, n: number): number[][] {
  const L = lum(T);
  const [bh, bw] = [Math.floor(T.h / n), Math.floor(T.w / n)];
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let y = i * bh; y < (i + 1) * bh; y++) for (let x = j * bw; x < (j + 1) * bw; x++) s += L[y * T.w + x]!;
      return s / (bh * bw);
    }),
  );
}

/**
 * Brightness change across the whole width and the whole height, from a
 * plane fitted to coarse blocks: baked light shows as a slope, while a
 * pattern of boards or shingles averages out in the blocks.
 */
export function slope(T: Img, n = 4): [number, number] {
  const B = blocks(T, n);
  const c = (i: number) => (i + 0.5) / n - 0.5;
  let [sx, sy, ss] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sx += B[i]![j]! * c(j);
      sy += B[i]![j]! * c(i);
      ss += c(j) * c(j);
    }
  }
  return [sx / ss, sy / ss];
}

/**
 * A repeating texture must be equally bright all over: no darker rim (a
 * vignette) and no brighter half (a band that would stripe the wall once
 * repeated). Profiles wrap round, as the texture will.
 */
export function evenness(T: Img, rowsByDesign: boolean): TextureCheck {
  const B = blocks(T, 6);
  const rim = mean([...B[0]!, ...B[5]!, ...B.slice(1, 5).map((r) => r[0]!), ...B.slice(1, 5).map((r) => r[5]!)]);
  const mid = mean([B[2]![2]!, B[2]![3]!, B[3]![2]!, B[3]![3]!]);
  const band = (prof: Float64Array) => {
    // half a repeat: a brighter half shows in full, stones and boards average out
    const k = Math.max(3, Math.floor(prof.length / 2));
    const p = [...prof.slice(-k), ...prof, ...prof.slice(0, k)];
    const off = Math.floor((k - 1) / 2);
    const sm = Array.from({ length: prof.length }, (_, i) => {
      let s = 0;
      for (let j = 0; j < k; j++) {
        const at = i + k + off - j;
        if (at >= 0 && at < p.length) s += p[at]! / k;
      }
      return s;
    });
    return Math.max(...sm) - Math.min(...sm);
  };
  const L = lum(T);
  const bands = [band(profile(L, T.w, T.h, true)), ...(rowsByDesign ? [] : [band(profile(L, T.w, T.h, false))])];
  return { ok: Math.abs(mid - rim) <= 0.06 && Math.max(...bands) <= 0.06, centreVsRim: r3(mid - rim), band: r3(Math.max(...bands)) };
}

/**
 * A border painted round a repeating texture draws a grid of lines once
 * tiled, yet still joins itself. For each pair of opposite edges: if both end
 * in the same kind of line, the two halves meet when tiled, so together they
 * must be no wider than the same lines inside the texture (a mortar line
 * split between top and bottom is right; a line the inside lacks is a frame).
 */
export function frameCheck(T: Img): TextureCheck {
  const L = lum(T);
  const [found, notes]: [string[], string[]] = [[], []];
  for (const [name, prof] of [['top and bottom', profile(L, T.w, T.h, false)], ['left and right', profile(L, T.w, T.h, true)]] as const) {
    const n = prof.length;
    const inner = prof.slice(Math.trunc(0.1 * n), Math.trunc(0.9 * n));
    const m = median(inner);
    const lim = Math.max(4 * 1.4826 * median(inner.map((v) => Math.abs(v - m))), 0.04);
    for (const sign of [1, -1]) {
      const rs = runs(Array.from(prof, (v) => sign * (v - m) > lim));
      const first = rs.find(([st]) => st === 0)?.[1] ?? 0;
      const last = rs.find(([st, w]) => st + w === n)?.[1] ?? 0;
      if (!(first && last)) continue;
      const inside = rs.filter(([st, w]) => st > 0 && st + w < n).map(([, w]) => w);
      if (inside.length && first + last <= 1.5 * median(inside)) notes.push(`${name}: edge lines ${first}+${last} px join into one like the ${Math.trunc(median(inside))} px ones inside`);
      else found.push(`${name}: ${first}+${last} px lines${inside.length ? `, inside ones are ${Math.trunc(median(inside))} px` : ', none inside'}`);
    }
  }
  return { ok: !found.length, edges: found, ...(notes.length ? { note: notes.join('; ') } : {}) };
}

/** Paints every pixel that is not good with the average of its good neighbours, growing inwards (no stretching, so the texture keeps its exact size). */
export function refill(T: Img, good: Uint8Array, iters = 60): Img {
  const { w, h } = T;
  const d = T.d.slice();
  let g = good.slice();
  for (let it = 0; it < iters && g.includes(0); it++) {
    const next = g.slice();
    const set: [number, number, number, number][] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (g[y * w + x]) continue;
        let [r, gg, b, cnt] = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const [xx, yy] = [x + dx, y + dy];
            if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h || !g[yy * w + xx]) continue;
            const i = (yy * w + xx) * 3;
            [r, gg, b, cnt] = [r + d[i]!, gg + d[i + 1]!, b + d[i + 2]!, cnt + 1];
          }
        }
        if (cnt) set.push([y * w + x, r / cnt, gg / cnt, b / cnt]);
      }
    }
    for (const [i, r, gg, b] of set) {
      d.set([r, gg, b], i * 3);
      next[i] = 1;
    }
    g = next;
  }
  return { w, h, d };
}

/** Measures a painted sheet against its layout. */
export async function checkSheet(painting: Img, R: SheetLayout, inset = 6): Promise<CheckedSheet> {
  const a = painting.w === SHEET[0] && painting.h === SHEET[1] ? painting : await resized(painting, SHEET[0], SHEET[1]);
  const [W, H] = [a.w, a.h];
  const notkey = new Uint8Array(W * H);
  const green = new Uint8Array(W * H);
  const mag = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const dm = dpx(a.d, i, MAGENTA, 0);
    notkey[i] = dm > 110 ? 1 : 0;
    mag[i] = dm < 110 ? 1 : 0;
    green[i] = dpx(a.d, i, GREEN, 0) < 120 ? 1 : 0;
  }
  const out: CheckedSheet = { report: {}, textures: {}, tiles: {} };
  for (const [name, r] of Object.entries(R)) {
    // one texture at a time, letting anything else waiting run in between
    await new Promise((next) => setImmediate(next));
    const checks: Record<string, TextureCheck> = {};
    let [x, y] = [r.box[0], r.box[1]];
    const [w, h] = [r.box[2], r.box[3]];
    const [X0, Y0, X1, Y1] = [Math.max(0, x - MARGIN), Math.max(0, y - MARGIN), Math.min(W, x + w + MARGIN), Math.min(H, y + h + MARGIN)];
    const colN = new Array<number>(X1 - X0).fill(0);
    const rowN = new Array<number>(Y1 - Y0).fill(0);
    for (let yy = Y0; yy < Y1; yy++) {
      for (let xx = X0; xx < X1; xx++) {
        if (!notkey[yy * W + xx]) continue;
        colN[xx - X0]!++;
        rowN[yy - Y0]!++;
      }
    }
    const cols = colN.flatMap((c, i) => (c > 0.25 * h ? [i] : []));
    const rows = rowN.flatMap((c, i) => (c > 0.25 * w ? [i] : []));
    if (!cols.length || !rows.length) {
      out.report[name] = { ok: false, checks: { place: { ok: false, why: 'nothing painted here' } } };
      continue;
    }
    const off = [X0 + cols[0]! - x, X0 + cols.at(-1)! + 1 - (x + w), Y0 + rows[0]! - y, Y0 + rows.at(-1)! + 1 - (y + h)];
    const moved = Math.max(...off.map(Math.abs));
    checks.place = { ok: moved <= 8, edgesMovedPx: off };
    // where it was painted: the sides and the bottom are reliable edges (an arch's top is too thin to measure)
    let dx = evenRound((off[0]! + off[1]!) / 2);
    let dy = r.shape === 'arch' ? off[3]! : evenRound((off[2]! + off[3]!) / 2);
    if (moved > 8) [dx, dy] = [0, 0];
    const sh: SheetRegion = { ...r, box: [x + dx, y + dy, w, h] };
    const inner = shapeMask(sh, W, H, -inset);
    const outer = shapeMask(r, W, H, 10);
    const outer2 = shapeMask(sh, W, H, 10);
    let [nIn, greenIn, magIn, spilled] = [0, 0, 0, 0];
    for (let yy = Math.max(0, sh.box[1]); yy < Math.min(H, sh.box[1] + h); yy++) {
      for (let xx = Math.max(0, sh.box[0]); xx < Math.min(W, sh.box[0] + w); xx++) {
        const i = yy * W + xx;
        if (!inner[i]) continue;
        nIn++;
        greenIn += green[i]!;
        magIn += mag[i]!;
      }
    }
    for (let yy = Y0; yy < Y1; yy++) for (let xx = X0; xx < X1; xx++) if (notkey[yy * W + xx] && !outer[yy * W + xx] && !outer2[yy * W + xx]) spilled++;
    checks.filled = { ok: greenIn / nIn <= 0.003 && magIn / nIn <= 0.003, greenLeft: r4(greenIn / nIn), magentaInside: r4(magIn / nIn) };
    checks.spill = { ok: spilled / nIn <= 0.015, outsideShare: r4(spilled / nIn) };
    [x, y] = [x + dx, y + dy];
    let T: Img;
    if (r.kind === 'tile') {
      T = crop(a, x + inset, y + inset, x + w - inset, y + h - inset);
      const [cx, cy] = slope(T);
      checks.flat = { ok: Math.abs(cx) + Math.abs(cy) <= SLOPE, across: r3(cx), down: r3(cy) };
      checks.even = evenness(T, r.rowsByDesign);
      checks['no frame'] = frameCheck(T);
      let T2: Img;
      let made: Record<string, string>;
      let okm: boolean;
      if (!r.stagger) {
        let [hx, hy, okx, oky] = ['', '', false, false];
        [T2, hx, okx] = makeSeamless(T, 1);
        [T2, hy, oky] = makeSeamless(T2, 0);
        if (!seam(T2, 1).ok) {
          // joining top to bottom can open the side seam again: join it once more
          const [T3, again, okx2] = makeSeamless(T2, 1);
          [T2, hx, okx] = [T3, `${hx}, then ${again}`, okx && okx2];
        }
        [made, okm] = [{ across: hx, down: hy }, okx && oky];
      } else if (seam(T, 1).ok && seam(T, 0).ok) {
        [T2, made, okm] = [T, { how: 'joins itself' }, true];
      } else {
        // rows with offset joints: rebuilt from whole rows, never cut through shapes (it judges its own joins)
        const [tile, how] = rowsTile(T);
        if (tile) [T2, made, okm] = [tile, { how }, true];
        else {
          // no rows to rebuild from: only an exact repeat of its own pattern will do
          const [Ta, hx, okx] = makeSeamless(T, 1, false);
          const [Tb, hy, oky] = makeSeamless(Ta, 0, false);
          okm = okx && oky;
          [T2, made] = [Tb, { how: okm ? `${hx}; ${hy}` : how, across: hx, down: hy }];
        }
      }
      const [sx, sy] = [seam(T2, 1), seam(T2, 0)];
      const plainOk = !r.stagger || !made.how!.startsWith('rebuilt') ? sx.ok && sy.ok : true;
      checks.repeats = { ok: okm && plainOk, ...made, edgeJump: [r1(sx.mean), r1(sy.mean)], worst: [r1(sx.worst), r1(sy.worst)], limit: [r1(sx.lim), r1(sy.lim)] };
      if (r.stagger) checks['shapes kept'] = { ...shapesCheck(T, T2) };
      // the finished tile must not end in lines its inside lacks either
      checks['tile has no frame'] = frameCheck(T2);
      out.tiles[name] = [(r.world[0] * T2.w) / T.w, (r.world[1] * T2.h) / T.h];
      T = T2;
    } else {
      T = crop(a, x, y, x + w, y + h);
      const m = shapeMask(sh, W, H, -3);
      const good = new Uint8Array(T.w * T.h);
      let bad = 0;
      for (let j = 0; j < T.h; j++) {
        for (let i = 0; i < T.w; i++) {
          const at = (y + j) * W + x + i;
          good[j * T.w + i] = m[at] && !mag[at] && !green[at] ? 1 : 0;
          if (!good[j * T.w + i]) bad++;
        }
      }
      checks['edges refilled'] = { ok: true, px: bad, share: r3(bad / (T.w * T.h)) };
      T = refill(T, good);
      const [cx, cy] = slope(T); // designs may have bands from top to bottom; light from one side shows across
      checks.flat = { ok: Math.abs(cx) <= SLOPE, across: r3(cx), down: r3(cy), note: 'only left to right is judged' };
    }
    out.report[name] = { ok: Object.values(checks).every((c) => c.ok), checks };
    out.textures[name] = T;
  }
  return out;
}

/**
 * Several checked paintings of one kit, newest first, as one: every texture
 * from the first painting where it passed, so a texture painted again on its
 * own replaces only itself. Each report says which painting it came from.
 */
export function combineSheets(paintings: { id: string; sheet: CheckedSheet }[]): CheckedSheet {
  const out: CheckedSheet = { report: {}, textures: {}, tiles: {} };
  for (const { id, sheet: c } of paintings) {
    for (const [n, v] of Object.entries(c.report)) {
      if (out.report[n] && (out.report[n]!.ok || !v.ok)) continue;
      out.report[n] = { ...v, painting: id };
      if (c.textures[n]) out.textures[n] = c.textures[n]!;
      else delete out.textures[n];
      if (c.tiles[n]) out.tiles[n] = c.tiles[n]!;
      else delete out.tiles[n];
    }
  }
  return out;
}
