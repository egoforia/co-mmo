import { buildingKit } from '@co-mmo/shared';

type Face = buildingKit.Face;
type Vec3 = buildingKit.Vec3;
const { RIGHT, UP, VIEW, R2, dot, project } = buildingKit;

// Draws kit parts with their painted textures, with no light (the game
// lights the maps). A depth test decides what is in front, so the order of
// parts never matters, and every pixel keeps which face it came from, where
// it is in the world and that face's exact normal: the maps and the picture
// checks all come from the same numbers.

/** A painted texture as linear RGB in 0..1, rows from the top. */
export interface Texture {
  w: number;
  h: number;
  rgb: Float32Array;
}

/**
 * The pixel frame of a building's renders, sized to the faces it is made
 * from, so the outside and every cutaway line up pixel for pixel. Renders
 * are ss times finer than the maps they make (the anti-aliasing step).
 */
export class KitCanvas {
  readonly w: number;
  readonly h: number;
  readonly origin: [number, number];

  constructor(
    faces: Face[],
    /** Pixels per bay along a ground line, in the final maps. */
    readonly u: number,
    readonly ss = 2,
    pad = 60,
  ) {
    const U = u * ss;
    const lo = [Infinity, Infinity];
    const hi = [-Infinity, -Infinity];
    for (const f of faces) {
      for (const p of f.pts) {
        const q = project(p, U);
        for (let c = 0; c < 2; c++) [lo[c], hi[c]] = [Math.min(lo[c]!, q[c]!), Math.max(hi[c]!, q[c]!)];
      }
    }
    this.origin = [pad * ss - lo[0]!, pad * ss - lo[1]!];
    const w = Math.ceil(hi[0]! - lo[0]! + 2 * pad * ss);
    const h = Math.ceil(hi[1]! - lo[1]! + 2 * pad * ss);
    this.w = w + (((-w % ss) + ss) % ss);
    this.h = h + (((-h % ss) + ss) % ss);
  }

  /** A kit point in this canvas's pixels. */
  px(p: Vec3): [number, number] {
    return project(p, this.u * this.ss, this.origin);
  }
}

/** Where a face covers the canvas before the depth test: a mask over its box. */
export interface Coverage {
  x0: number;
  y0: number;
  w: number;
  h: number;
  m: Uint8Array;
}

/** Everything one render knows per pixel. */
export interface Render {
  cv: KitCanvas;
  faces: Face[];
  /** Unlit colour, 3 per pixel. */
  col: Float32Array;
  /** The kit-space normal of the face shown, 3 per pixel. */
  nrm: Float32Array;
  /** The kit-space point shown, 3 per pixel. */
  pos: Float32Array;
  /** Nearness of what is shown (larger is nearer). */
  zb: Float32Array;
  /** The face shown, or -1 for nothing. */
  fid: Int32Array;
  /** 1 where a fitted texture is stretched past its painted area. */
  uvbad: Uint8Array;
  masks: Map<number, Coverage>;
}

const OFF = 0.000123; // pixel sample points sit a hair off the snap grid

/** Vertices on a 1/1024 px grid, so an edge shared by two faces is the very same numbers in both. */
const snap = (v: number) => Math.round(v * 1024) / 1024;

/**
 * Pixels whose sample point lies inside the polygon and outside its holes
 * (even-odd). Edges are snapped and walked from their lower end, so two
 * faces that share an edge split its pixels exactly: no cracks, no
 * overlaps, and a hidden face cannot leak a fringe past what covers it.
 */
export function cover(loops: [number, number][][], x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const [w, h] = [x1 - x0, y1 - y0];
  const m = new Uint8Array(w * h);
  const edges: [number, number, number, number][] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      let [ax, ay] = [snap(loop[i]![0]), snap(loop[i]![1])];
      let [bx, by] = [snap(loop[(i + 1) % loop.length]![0]), snap(loop[(i + 1) % loop.length]![1])];
      if (ay === by) continue;
      if (ay > by) [ax, ay, bx, by] = [bx, by, ax, ay];
      edges.push([ax, ay, bx, by]);
    }
  }
  const xs: number[] = [];
  for (let j = 0; j < h; j++) {
    const yy = y0 + j + OFF;
    xs.length = 0;
    for (const [ax, ay, bx, by] of edges) if (yy >= ay && yy < by) xs.push(ax + (yy - ay) * ((bx - ax) / (by - ay)));
    xs.sort((a, b) => a - b);
    // a sample point is inside when an odd number of crossings lie at or left of it
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let i = Math.max(0, Math.ceil(xs[k]! - OFF - x0) - 1);
      while (i < w && x0 + i + OFF < xs[k]!) i++;
      for (; i < w && x0 + i + OFF < xs[k + 1]!; i++) m[j * w + i] = 1;
    }
  }
  return m;
}

/** Bilinear lookup at u, v in 0..1 (v = 0 at the bottom of the texture), repeating or clamped, into out[o..o+2]. */
function sample(tex: Texture, uu: number, vv: number, wrap: boolean, out: Float32Array, o: number): void {
  const { w, h, rgb } = tex;
  let x: number;
  let y: number;
  let X0: number;
  let X1: number;
  let Y0: number;
  let Y1: number;
  if (wrap) {
    x = (uu - Math.floor(uu)) * w - 0.5;
    y = (1 - vv - Math.floor(1 - vv)) * h - 0.5;
    X0 = Math.floor(x);
    Y0 = Math.floor(y);
    X1 = (X0 + 1) % w;
    Y1 = (Y0 + 1) % h;
    X0 = (X0 + w) % w;
    Y0 = (Y0 + h) % h;
  } else {
    x = uu * (w - 1);
    y = (1 - vv) * (h - 1);
    X0 = Math.floor(x);
    Y0 = Math.floor(y);
    X1 = Math.min(Math.max(X0 + 1, 0), w - 1);
    Y1 = Math.min(Math.max(Y0 + 1, 0), h - 1);
    X0 = Math.min(Math.max(X0, 0), w - 1);
    Y0 = Math.min(Math.max(Y0, 0), h - 1);
  }
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const [a, b, c, d] = [(Y0 * w + X0) * 3, (Y0 * w + X1) * 3, (Y1 * w + X0) * 3, (Y1 * w + X1) * 3];
  const [ka, kb, kc, kd] = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  for (let ch = 0; ch < 3; ch++) out[o + ch] = rgb[a + ch]! * ka + rgb[b + ch]! * kb + rgb[c + ch]! * kc + rgb[d + ch]! * kd;
}

/** Rasterises the faces that face the camera into per-pixel maps at the canvas resolution. */
export function render(faces: Face[], textures: Record<string, Texture>, cv: KitCanvas): Render {
  const [W, H] = [cv.w, cv.h];
  const k = R2 * cv.u * cv.ss;
  const r: Render = {
    cv, faces,
    col: new Float32Array(W * H * 3), nrm: new Float32Array(W * H * 3), pos: new Float32Array(W * H * 3),
    zb: new Float32Array(W * H).fill(-Infinity), fid: new Int32Array(W * H).fill(-1), uvbad: new Uint8Array(W * H),
    masks: new Map(),
  };
  faces.forEach((f, i) => {
    if (dot(f.n, VIEW) <= 1e-6) return;
    const P = f.pts.map((p) => cv.px(p));
    const x0 = Math.max(Math.floor(Math.min(...P.map((q) => q[0]))) - 1, 0);
    const y0 = Math.max(Math.floor(Math.min(...P.map((q) => q[1]))) - 1, 0);
    const x1 = Math.min(Math.ceil(Math.max(...P.map((q) => q[0]))) + 2, W);
    const y1 = Math.min(Math.ceil(Math.max(...P.map((q) => q[1]))) + 2, H);
    if (x1 <= x0 || y1 <= y0) return;
    const m = cover([P, ...f.holes.map((hole) => hole.map((p) => cv.px(p)))], x0, y0, x1, y1);
    if (!m.includes(1)) return;
    r.masks.set(i, { x0, y0, w: x1 - x0, h: y1 - y0, m });
    // screen to a point on the face's plane: p = q0 + s*es + t*et
    const q0 = f.pts[0]!;
    const S0 = cv.px(q0);
    const [a, b, c, d] = [k * dot(f.es, RIGHT), k * dot(f.et, RIGHT), -k * dot(f.es, UP), -k * dot(f.et, UP)];
    const det = a * d - b * c;
    const tex = textures[f.tex];
    if (!tex) throw new Error(`no texture painted for ${f.tex}`);
    const mp = f.mapping;
    const fit = mp.kind === 'fit' ? { s0: dot(mp.bl, f.es), s1: dot(mp.br, f.es), t0: dot(mp.bl, f.et), t1: dot(mp.tl, f.et) } : null;
    const [es0, es1, es2, et0, et1, et2] = [f.es[0], f.es[1], f.es[2], f.et[0], f.et[1], f.et[2]];
    const [V0, V1, V2] = [VIEW[0], VIEW[1], VIEW[2]];
    const [n0, n1, n2] = [f.n[0], f.n[1], f.n[2]];
    const mw = x1 - x0;
    for (let j = 0; j < y1 - y0; j++) {
      const Y = j + y0;
      const dy = Y - S0[1];
      for (let x = 0; x < mw; x++) {
        if (!m[j * mw + x]) continue;
        const X = x + x0;
        const dx = X - S0[0];
        const s = (d * dx - b * dy) / det;
        const t = (a * dy - c * dx) / det;
        const p0 = q0[0] + s * es0 + t * et0;
        const p1 = q0[1] + s * es1 + t * et1;
        const p2 = q0[2] + s * es2 + t * et2;
        const nr = Math.fround(p0 * V0 + p1 * V1 + p2 * V2);
        const at = Y * W + X;
        if (!(nr > r.zb[at]!)) continue;
        const s_ = p0 * es0 + p1 * es1 + p2 * es2;
        const t_ = p0 * et0 + p1 * et1 + p2 * et2;
        let bad = 0;
        if (fit) {
          const uu = (s_ - fit.s0) / (fit.s1 - fit.s0);
          const vv = (t_ - fit.t0) / (fit.t1 - fit.t0);
          bad = uu < -0.01 || uu > 1.01 || vv < -0.01 || vv > 1.01 ? 1 : 0;
          sample(tex, Math.min(Math.max(uu, 0), 1), Math.min(Math.max(vv, 0), 1), false, r.col, at * 3);
        } else if (mp.kind === 'tile') {
          sample(tex, s_ / mp.s, t_ / mp.t, true, r.col, at * 3);
        }
        r.nrm[at * 3] = n0;
        r.nrm[at * 3 + 1] = n1;
        r.nrm[at * 3 + 2] = n2;
        r.pos[at * 3] = p0;
        r.pos[at * 3 + 1] = p1;
        r.pos[at * 3 + 2] = p2;
        r.zb[at] = nr;
        r.fid[at] = i;
        r.uvbad[at] = bad;
      }
    }
  });
  return r;
}

/** Averages ss x ss blocks of a map with n values per pixel (the anti-aliasing step). */
export function down(map: ArrayLike<number>, w: number, h: number, n: number, ss: number): Float32Array {
  const [W, H] = [w / ss, h / ss];
  const out = new Float32Array(W * H * n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (Math.floor(y / ss) * W + Math.floor(x / ss)) * n;
      for (let c = 0; c < n; c++) out[o + c] += map[(y * w + x) * n + c]! / (ss * ss);
    }
  }
  return out;
}
