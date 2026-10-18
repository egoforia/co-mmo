// Exact solid geometry for kit buildings. Every part is a prism: a flat
// outline pushed out along its normal. Parts sit on exact numbers, so joints
// cannot drift, and each prism keeps its solid so the shape checks can ask
// exact questions (what is above this point, does this rest on that).

/** A point or direction in kit space: a and b along the two wall runs, z up, in wall sections. */
export type Vec3 = readonly [number, number, number];
/** A point in a flat outline. */
export type Vec2 = readonly [number, number];

export const Z: Vec3 = [0, 0, 1];
export const add = (p: Vec3, q: Vec3): Vec3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
export const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
export const scale = (p: Vec3, k: number): Vec3 => [p[0] * k, p[1] * k, p[2] * k];
export const dot = (p: Vec3, q: Vec3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
export const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
export const length = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]);
export const unit = (p: Vec3): Vec3 => scale(p, 1 / length(p));

/**
 * How a texture covers a face. 'tile' repeats it every s by t world units,
 * anchored to the world so faces in one plane continue each other, with its
 * grain along a chosen direction; 'fit' stretches it once over the rectangle
 * given by three world corners (bottom left, bottom right, top left).
 */
export type Mapping =
  | { kind: 'tile'; s: number; t: number; grain?: Vec3 }
  | { kind: 'fit'; bl: Vec3; br: Vec3; tl: Vec3 };

/** A painted texture by name and how it is laid on a face. */
export interface Paint {
  tex: string;
  mapping: Mapping;
}

/** A prism's solid: its outline in a plane, pushed from depth d0 to d1 along n. */
export interface Solid {
  o: Vec3;
  ex: Vec3;
  ey: Vec3;
  n: Vec3;
  outline: Vec2[];
  holes: Vec2[][];
  d0: number;
  d1: number;
}

/**
 * One flat polygon of a part, with its texture. Faces a design hides (wall
 * ends inside posts, tops under beams) are tagged 'hidden' so a render can
 * prove they stay hidden; tops a cutaway makes are tagged 'cut'.
 */
export class Face {
  /** The texture's own right and up on this face. */
  es: Vec3;
  et: Vec3;
  readonly n: Vec3;

  constructor(
    public pts: Vec3[],
    n: Vec3,
    public tex: string,
    public mapping: Mapping,
    public holes: Vec3[][] = [],
    public part = '',
    public tag = '',
    public solid?: Solid,
  ) {
    this.n = unit(n);
    if (Math.abs(this.n[2]) > 0.999) {
      this.es = [1, 0, 0];
      this.et = [0, Math.sign(this.n[2]), 0];
    } else {
      this.et = unit(sub(Z, scale(this.n, dot(Z, this.n))));
      this.es = cross(this.et, this.n);
    }
    if (mapping.kind === 'tile' && mapping.grain) {
      const g = sub(mapping.grain, scale(this.n, dot(mapping.grain, this.n)));
      if (length(g) > 1e-6) {
        this.es = unit(g);
        this.et = cross(this.n, this.es);
        // turn half way round rather than paint upside down
        if (dot(this.et, Z) < -1e-6) [this.es, this.et] = [scale(this.es, -1), scale(this.et, -1)];
      }
    }
  }
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

function nearEdge(p: Vec2, poly: Vec2[], eps: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / Math.max(ex * ex + ey * ey, 1e-30)));
    if (Math.hypot(a[0] + t * ex - p[0], a[1] + t * ey - p[1]) <= eps) return true;
  }
  return false;
}

/** Inside an outline and not inside its holes; a point on any edge counts as inside (touching). */
export function inRegion(p: Vec2, outline: Vec2[], holes: Vec2[][] = [], eps = 1e-7): boolean {
  if (!(pointInPolygon(p, outline) || nearEdge(p, outline, eps))) return false;
  return !holes.some((h) => pointInPolygon(p, h) && !nearEdge(p, h, eps));
}

/** What a prism's faces are painted with; a missing key leaves that face out (the solid stays whole). */
export interface PrismPaint {
  front?: Paint;
  back?: Paint;
  side?: Paint | ((n: Vec3) => Paint);
}

/**
 * A flat outline in the plane (o, ex, ey), pushed from depth d0 to d1 along
 * the plane's normal ex x ey. sideTag may tag a side face from its edge.
 */
export function prism(
  outline: Vec2[],
  frame: [Vec3, Vec3, Vec3],
  d0: number,
  d1: number,
  paint: PrismPaint,
  opts: { holes?: Vec2[][]; part?: string; sideTag?: (a: Vec2, b: Vec2, n: Vec3) => string } = {},
): Face[] {
  const [o, ex, ey] = frame;
  const n = cross(ex, ey);
  const holes = opts.holes ?? [];
  const part = opts.part ?? '';
  const solid: Solid = { o, ex, ey, n, outline: outline.map((q) => [q[0], q[1]]), holes: holes.map((h) => h.map((q) => [q[0], q[1]])), d0: Math.min(d0, d1), d1: Math.max(d0, d1) };
  const at = (q: Vec2, d: number): Vec3 => add(add(add(o, scale(ex, q[0])), scale(ey, q[1])), scale(n, d));
  const faces: Face[] = [];
  for (const [d, sign, key] of [[d1, 1, 'front'], [d0, -1, 'back']] as const) {
    const p = paint[key];
    if (p) faces.push(new Face(outline.map((q) => at(q, d)), scale(n, sign), p.tex, p.mapping, holes.map((h) => h.map((q) => at(q, d))), part, '', solid));
  }
  if (paint.side) {
    for (const loop of [outline, ...holes]) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-9) continue;
        let nn: Vec2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
        const probe: Vec2 = [(a[0] + b[0]) / 2 + nn[0] * 1e-5, (a[1] + b[1]) / 2 + nn[1] * 1e-5];
        if (pointInPolygon(probe, outline) && !holes.some((h) => pointInPolygon(probe, h))) nn = [-nn[0], -nn[1]];
        const n3 = add(scale(ex, nn[0]), scale(ey, nn[1]));
        const p = typeof paint.side === 'function' ? paint.side(n3) : paint.side;
        faces.push(new Face([at(a, d0), at(b, d0), at(b, d1), at(a, d1)], n3, p.tex, p.mapping, [], part, opts.sideTag?.(a, b, n3) ?? '', solid));
      }
    }
  }
  return faces;
}

/** An axis-aligned block with its top first; top and side are the paints. */
export function box(a0: number, a1: number, b0: number, b1: number, z0: number, z1: number, top: Paint, side: Paint, part = '', tag = ''): Face[] {
  const faces = prism(rect(a0, a1, b0, b1), [[0, 0, z0], [1, 0, 0], [0, 1, 0]], 0, z1 - z0, { front: top, side }, { part });
  if (tag) for (const f of faces) f.tag = tag;
  return faces;
}

/** The distinct solids behind some faces. */
export function solidsOf(faces: Face[]): Solid[] {
  return [...new Set(faces.map((f) => f.solid).filter((s): s is Solid => s !== undefined))];
}

/** Exact stretches [t0, t1] of the line p0 + t*dir inside a solid (its surface counts). */
export function span(sol: Solid, p0: Vec3, dir: Vec3, eps = 1e-7): [number, number][] {
  const q = sub(p0, sol.o);
  const [X0, Y0, D0] = [dot(q, sol.ex), dot(q, sol.ey), dot(q, sol.n)];
  const [dx, dy, dd] = [dot(dir, sol.ex), dot(dir, sol.ey), dot(dir, sol.n)];
  const [lo, hi] = [sol.d0 - eps, sol.d1 + eps];
  let tlo = -Infinity;
  let thi = Infinity;
  if (Math.abs(dd) < 1e-12) {
    if (!(lo <= D0 && D0 <= hi)) return [];
  } else {
    const ta = (lo - D0) / dd;
    const tb = (hi - D0) / dd;
    [tlo, thi] = [Math.min(ta, tb), Math.max(ta, tb)];
  }
  const inside = (t: number) => inRegion([X0 + t * dx, Y0 + t * dy], sol.outline, sol.holes, eps);
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return inside(0) ? [[tlo, thi]] : [];
  const ts: number[] = [];
  for (const loop of [sol.outline, ...sol.holes]) {
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = loop[i]!;
      const [bx, by] = loop[(i + 1) % loop.length]!;
      const [ux, uy] = [bx - ax, by - ay];
      const det = -dx * uy + ux * dy;
      if (Math.abs(det) < 1e-14) continue;
      const [rx, ry] = [ax - X0, ay - Y0];
      const t = (-rx * uy + ux * ry) / det;
      const along = (dx * ry - dy * rx) / det;
      if (along >= -1e-9 && along <= 1 + 1e-9) ts.push(t);
    }
  }
  if (!ts.length) return [];
  const cuts = [...new Set([...ts.map((t) => Math.min(Math.max(t, tlo), thi)), ...[tlo, thi].filter(Number.isFinite)])].sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [u, v] = [cuts[i]!, cuts[i + 1]!];
    if (v - u < 1e-12 || v <= tlo || u >= thi) continue;
    if (inside((u + v) / 2)) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - u) < 1e-9) last[1] = v;
      else out.push([u, v]);
    }
  }
  // a line that only grazes a corner or an edge still touches the solid
  for (const t of ts) if (t >= tlo - 1e-12 && t <= thi + 1e-12 && !out.some(([a, b]) => a - 1e-9 <= t && t <= b + 1e-9) && inside(t)) out.push([t, t]);
  return out.sort((x, y) => x[0] - y[0]);
}

/** A rectangle's outline from its two corners, anticlockwise. */
export function rect(x0: number, x1: number, y0: number, y1: number): Vec2[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * A rectangle with axis-aligned rectangles cut out of it, as outlines with
 * their holes. Worked out on the grid of all their edges, so a cut may touch
 * the border (a notch) or sit inside (a hole).
 */
export function region(r: [number, number, number, number], cuts: [number, number, number, number][]): { outline: Vec2[]; holes: Vec2[][] }[] {
  const [x0, x1, y0, y1] = r;
  const cs = cuts
    .map(([a, b, c, d]) => [Math.max(a, x0), Math.min(b, x1), Math.max(c, y0), Math.min(d, y1)] as const)
    .filter((c) => c[1] - c[0] > 1e-9 && c[3] - c[2] > 1e-9);
  const merge = (vals: number[]) => vals.sort((a, b) => a - b).reduce<number[]>((out, v) => (!out.length || v - out[out.length - 1]! > 1e-9 ? [...out, v] : out), []);
  const xs = merge([x0, x1, ...cs.flatMap((c) => [c[0], c[1]])]);
  const ys = merge([y0, y1, ...cs.flatMap((c) => [c[2], c[3]])]);
  const full = (i: number, j: number) => {
    if (!(i >= 0 && i < xs.length - 1 && j >= 0 && j < ys.length - 1)) return false;
    const cx = (xs[i]! + xs[i + 1]!) / 2;
    const cy = (ys[j]! + ys[j + 1]!) / 2;
    return !cs.some(([a, b, c, d]) => a < cx && cx < b && c < cy && cy < d);
  };
  const key = (i: number, j: number) => `${i},${j}`;
  const next = new Map<string, string[]>();
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!full(i, j)) continue;
      const edges: [string, string, boolean][] = [
        [key(i, j), key(i + 1, j), full(i, j - 1)],
        [key(i + 1, j), key(i + 1, j + 1), full(i + 1, j)],
        [key(i + 1, j + 1), key(i, j + 1), full(i, j + 1)],
        [key(i, j + 1), key(i, j), full(i - 1, j)],
      ];
      for (const [p, q, shared] of edges) if (!shared) next.set(p, [...(next.get(p) ?? []), q]);
    }
  }
  const loops: Vec2[][] = [];
  while (next.size) {
    const start = next.keys().next().value!;
    const loop = [start];
    let cur = start;
    for (;;) {
      const outs = next.get(cur)!;
      const nx = outs.shift()!;
      if (!outs.length) next.delete(cur);
      if (nx === start) break;
      loop.push(nx);
      cur = nx;
    }
    const pts = loop.map((k): Vec2 => {
      const [i, j] = k.split(',').map(Number);
      return [xs[i!]!, ys[j!]!];
    });
    // drop points in the middle of a straight edge
    loops.push(pts.filter((p, k) => {
      const a = pts[(k - 1 + pts.length) % pts.length]!;
      const b = pts[(k + 1) % pts.length]!;
      return Math.abs((a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0])) > 1e-12;
    }));
  }
  const area = (l: Vec2[]) => l.reduce((s, p, k) => s + (l[(k - 1 + l.length) % l.length]![0] * p[1] - p[0] * l[(k - 1 + l.length) % l.length]![1]), 0) / 2;
  const inner = loops.filter((l) => area(l) < 0);
  return loops
    .filter((l) => area(l) > 0)
    .map((outline) => ({
      outline,
      holes: inner.filter((h) => pointInPolygon([h.reduce((s, p) => s + p[0], 0) / h.length, h.reduce((s, p) => s + p[1], 0) / h.length], outline)),
    }));
}

/** Outline of a round-topped opening (n facets on its half circle), bottom left first, anticlockwise. */
export function arch(x0: number, w: number, y0: number, h: number, n: number): Vec2[] {
  const r = w / 2;
  const yc = y0 + h - r;
  const pts: Vec2[] = [[x0, y0], [x0 + w, y0]];
  for (let i = 0; i <= n; i++) pts.push([x0 + r + r * Math.cos((Math.PI * i) / n), yc + r * Math.sin((Math.PI * i) / n)]);
  return pts;
}

/**
 * Quads of a trim of width w round an opening's outline, mitred at the
 * corners. A door's trim (openBottom) has no bottom piece, and its jambs come
 * straight down to the floor.
 */
export function offsetRing(hole: Vec2[], w: number, openBottom = true): Vec2[][] {
  const m = hole.length;
  const normal = (i: number): Vec2 => {
    const a = hole[(i + m) % m]!;
    const b = hole[(i + 1) % m]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  };
  const out = hole.map((p, i): Vec2 => {
    const [n0, n1] = [normal(i - 1), normal(i)];
    const len = Math.hypot(n0[0] + n1[0], n0[1] + n1[1]);
    const mid: Vec2 = [(n0[0] + n1[0]) / len, (n0[1] + n1[1]) / len];
    const k = w / Math.max(mid[0] * n1[0] + mid[1] * n1[1], 0.2);
    return [p[0] + mid[0] * k, p[1] + mid[1] * k];
  });
  const bottom = Math.min(...hole.map((p) => p[1]));
  const quads: Vec2[][] = [];
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    if (openBottom && Math.abs(hole[i]![1] - hole[j]![1]) < 1e-9 && hole[i]![1] === bottom) continue;
    quads.push([hole[i]!, hole[j]!, out[j]!, out[i]!]);
  }
  if (!openBottom) return quads;
  return quads.map((q) => q.map((p, k): Vec2 => (Math.abs(p[1] - bottom) < 1e-9 || (k >= 2 && p[1] < bottom) ? [p[0], bottom] : p)));
}
