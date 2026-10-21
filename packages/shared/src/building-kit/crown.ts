// What a kit building wears besides a gable roof, for the great buildings:
// a flat roof behind a parapet (with battlements when asked), towers at its
// corners and a dome. Every piece is still exact parts on the kit's sizes,
// painted only with the look's flat textures, and every contact is recorded
// for the shape checks. Rounded things are faceted (an octagon, a dome of
// flat bands), which suits the flat faceted style and keeps every face flat.

import { Z, add, box, cross, dot, prism, rect, scale, sub, unit, Face, type Paint, type Solid, type Vec2, type Vec3 } from './geometry.ts';
import type { KitBuilding } from './building.ts';
import { CUT_LOW } from './stairs.ts';
import type { Side } from './sizes.ts';

/** A building's corner, named by the two walls that meet there. */
export type Corner = 'front-left' | 'front-right' | 'back-left' | 'back-right';

/** A tower standing on one of the building's corners. */
export interface TowerSpec {
  corner: Corner;
  /** Across, in bays (1 when not given): it stands centred on the corner. */
  size?: number;
  /** How far it rises above the building's walls, in bays (1 when not given). */
  above?: number;
  /** An octagon rather than a square. */
  round?: boolean;
  /** A pointed roof, or a flat top (with battlements when the building has them). */
  top?: 'flat' | 'cone';
}

/** A dome on a flat roof. */
export interface DomeSpec {
  /** Its centre in plan, in bays; the middle of the roof when not given. */
  at?: readonly [number, number];
  /** Its radius in bays (a third of the shorter side when not given). */
  r?: number;
  /** A small pointed finial on top. */
  finial?: boolean;
}

/** Sizes of the crown's parts, in bays. */
export const CROWN = {
  /** The flat roof reaches this far past the beams, so its sides never share a plane with theirs. */
  over: 0.12,
  parapetT: 0.12,
  parapetH: 0.3,
  merlonW: 0.2,
  merlonH: 0.16,
  /** A tower's flat top overhangs its walls by this much. */
  capOut: 0.06,
  capH: 0.1,
  /** A pointed roof is this many times as tall as the tower is wide. */
  cone: 1.1,
  /** The drum a dome stands on. */
  drumH: 0.3,
  /** Facets round a dome or a round tower, and bands up a dome. */
  sides: 8,
  bands: 4,
  /** The flat top left at a dome's crown, which the finial stands on. */
  crownR: 0.1,
  finialR: 0.07,
  finialH: 0.4,
};

/** The walls meeting at each corner, and where the corner is. */
const CORNERS: Record<Corner, { walls: readonly [Side, Side]; at: (W: number, D: number) => Vec2 }> = {
  'front-left': { walls: ['front', 'left'], at: () => [0, 0] },
  'front-right': { walls: ['front', 'right'], at: (W) => [W, 0] },
  'back-left': { walls: ['back', 'left'], at: (_W, D) => [0, D] },
  'back-right': { walls: ['back', 'right'], at: (W, D) => [W, D] },
};

/** A regular polygon round (cx, cy) whose sides lie `apothem` from its centre, a flat side facing each grid direction. */
export function ring(cx: number, cy: number, apothem: number, sides: number): Vec2[] {
  const r = apothem / Math.cos(Math.PI / sides);
  // corners half a step round from the axes, so a side faces each way along the grid
  return Array.from({ length: sides }, (_, i): Vec2 => [cx + r * Math.cos((Math.PI * (2 * i + 1)) / sides), cy + r * Math.sin((Math.PI * (2 * i + 1)) / sides)]);
}

/** The solid of a flat outline in plan from z0 to z1, with no faces: the shape checks' stand-in for a sloped part. */
function slab(outline: Vec2[], z0: number, z1: number): Solid {
  return { o: [0, 0, 0], ex: [1, 0, 0], ey: [0, 1, 0], n: [0, 0, 1], outline: outline.map((q) => [q[0], q[1]]), holes: [], d0: z0, d1: z1 };
}

/** A flat face through these points, facing away from `inside`. */
function facet(pts: Vec3[], inside: Vec3, paint: Paint, part: string): Face {
  let n = cross(sub(pts[1]!, pts[0]!), sub(pts[2]!, pts[0]!));
  const mid = scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / pts.length);
  if (dot(n, sub(mid, inside)) < 0) {
    n = scale(n, -1);
    pts = [...pts].reverse();
  }
  return new Face(pts, unit(n), paint.tex, paint.mapping, [], part);
}

/** A polygon in plan scaled about its centre. */
function shrink(outline: Vec2[], c: Vec2, k: number): Vec2[] {
  return outline.map((q) => [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k]);
}

/**
 * A pointed roof over a plan outline: one flat facet from each edge to the
 * apex, with stacked slabs inside it for the shape checks.
 */
function spire(outline: Vec2[], c: Vec2, z0: number, h: number, paint: Paint, part: string): { faces: Face[]; solids: Solid[] } {
  const apex: Vec3 = [c[0], c[1], z0 + h];
  const inside: Vec3 = [c[0], c[1], z0];
  const faces = outline.map((p, i) => {
    const q = outline[(i + 1) % outline.length]!;
    return facet([[p[0], p[1], z0], [q[0], q[1], z0], apex], inside, paint, part);
  });
  // each slab as wide as the roof at its top, so it stays inside the roof
  const steps = 6;
  const solids = Array.from({ length: steps }, (_, i) => slab(shrink(outline, c, 1 - (i + 1) / steps), z0 + (i * h) / steps, z0 + ((i + 1) * h) / steps));
  for (const f of faces) f.solid = solids[0];
  return { faces, solids };
}

/**
 * Merlons along a straight run from p0 to p1 on top of a wall `depth` thick
 * at height z: whole merlons with gaps at least as wide, one at each end.
 */
function merlons(b: KitBuilding, p0: Vec2, p1: Vec2, depth: number, z: number, on: string, name: string): void {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const w = CROWN.merlonW;
  const n = Math.max(1, Math.floor((len / w + 1) / 2));
  const gap = n > 1 ? (len - n * w) / (n - 1) : 0;
  const ex: Vec3 = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len, 0];
  const top = b.paint('stone');
  const side = b.paint('plaster');
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? i * (w + gap) : (len - w) / 2;
    const o: Vec3 = [p0[0], p0[1], z];
    const f = prism(rect(x, x + w, 0, CROWN.merlonH), [o, ex, Z], -depth / 2, depth / 2, { front: side, back: side, side: (n3) => (n3[2] > 0.5 ? top : side) }, { part: `${name}.${i}` });
    b.add(f, 'merlon');
    b.rel('rests on', [`${name}.${i}`], [on], `merlon ${i + 1} of ${name.replace(/\./g, ' ')} stands on its wall`);
  }
}

/** A flat roof on the walls' beams, a parapet round it, battlements when asked, then the dome. */
export function addFlatRoof(b: KitBuilding, zr0: number): void {
  const k = b.k;
  const e = CROWN.over;
  const [a0, a1, b0, b1] = [-e, b.W + e, -e, b.D + e];
  const z1 = zr0 + k.roofT;
  const top = b.spec.storeys.length - 1;
  b.add(box(a0, a1, b0, b1, zr0, z1, b.paint('roof', [1, 0, 0]), b.paint('stone'), 'roof.flat'), 'roof');
  b.rel('rests on', ['roof.flat'], (['front', 'right', 'back', 'left'] as const).map((s) => `${s}${top}.beam`), 'the flat roof rests on the beams');
  const pt = CROWN.parapetT;
  const zp = z1 + CROWN.parapetH;
  const runs: [Side, number, number, number, number][] = [
    ['front', a0, a1, b0, b0 + pt],
    ['back', a0, a1, b1 - pt, b1],
    ['left', a0, a0 + pt, b0 + pt, b1 - pt],
    ['right', a1 - pt, a1, b0 + pt, b1 - pt],
  ];
  for (const [side, x0, x1, y0, y1] of runs) {
    b.add(box(x0, x1, y0, y1, z1, zp, b.paint('stone'), b.paint('plaster'), `parapet.${side}`), 'parapet', { side });
    b.rel('rests on', [`parapet.${side}`], ['roof.flat'], `the ${side} parapet stands on the roof`);
    if (!b.spec.battlements) continue;
    // along the parapet's middle, from end to end
    const along = side === 'front' || side === 'back';
    const [p0, p1]: [Vec2, Vec2] = along ? [[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]] : [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]];
    merlons(b, p0, p1, pt, zp, `parapet.${side}`, `battlement.${side}`);
  }
  b.roof = { zr0, zu: () => z1, ridge: zp, along: b.W >= b.D ? 'a' : 'b' };
  b.joints.push({ label: 'parapet corner', at: [a0, b0, zp] }, { label: 'roof meets parapet', at: [a0 + pt, b0 + pt, z1] });
  const ch = b.spec.chimney;
  if (ch) {
    const c = k.chimney / 2;
    const topZ = zp + k.chimneyUp;
    b.add(box(ch[0] - c, ch[0] + c, ch[1] - c, ch[1] + c, zr0, topZ, b.paint('stone'), b.paint('stone'), 'chimney'), 'chimney');
    b.rel('set into', ['chimney'], ['roof.flat'], 'the chimney goes into the roof everywhere under it (no floating)');
  }
  if (b.spec.dome) addDome(b, z1, b.spec.dome);
}

/** A faceted dome on a drum, standing on the flat roof. */
function addDome(b: KitBuilding, z: number, d: DomeSpec): void {
  const c: Vec2 = [d.at?.[0] ?? b.W / 2, d.at?.[1] ?? b.D / 2];
  const r = d.r ?? Math.min(b.W, b.D) / 3;
  // where the parapet's inner faces stand
  const inner = CROWN.parapetT - CROWN.over;
  b.fits('the dome stands inside the parapet', c[0] - r >= inner - 1e-9 && c[0] + r <= b.W - inner + 1e-9 && c[1] - r >= inner - 1e-9 && c[1] + r <= b.D - inner + 1e-9);
  const n = CROWN.sides;
  const base = ring(c[0], c[1], r, n);
  const zd = z + CROWN.drumH;
  b.add(prism(base, [[0, 0, z], [1, 0, 0], [0, 1, 0]], 0, CROWN.drumH, { side: b.paint('plaster') }, { part: 'dome.drum' }), 'dome');
  b.rel('rests on', ['dome.drum'], ['roof.flat'], 'the drum stands on the roof');
  // bands up a quarter circle, to a small flat crown
  const m = CROWN.bands;
  const top = Math.acos(CROWN.crownR / r);
  const lv = Array.from({ length: m + 1 }, (_, i) => (top * i) / m);
  const paint = b.paint('roof');
  const centre: Vec3 = [c[0], c[1], zd];
  const faces: Face[] = [];
  const solids: Solid[] = [];
  for (let i = 0; i < m; i++) {
    const [lo, hi] = [ring(c[0], c[1], r * Math.cos(lv[i]!), n), ring(c[0], c[1], r * Math.cos(lv[i + 1]!), n)];
    const [z0, z1] = [zd + r * Math.sin(lv[i]!), zd + r * Math.sin(lv[i + 1]!)];
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      faces.push(facet([[lo[j]![0], lo[j]![1], z0], [lo[j2]![0], lo[j2]![1], z0], [hi[j2]![0], hi[j2]![1], z1], [hi[j]![0], hi[j]![1], z1]], centre, paint, 'dome'));
    }
    solids.push(slab(hi, z0, z1));
  }
  const zc = zd + r * Math.sin(top);
  const crown = ring(c[0], c[1], CROWN.crownR, n);
  faces.push(...capFace(crown, zc, paint, 'dome'));
  for (const f of faces) f.solid = solids[0];
  b.parts.push({ role: 'dome', name: 'dome', faces, solids });
  b.faces.push(...faces);
  b.rel('rests on', ['dome'], ['dome.drum'], 'the dome stands on its drum');
  b.joints.push({ label: 'dome meets drum', at: [base[0]![0], base[0]![1], zd] });
  if (!d.finial) return;
  const fr = ring(c[0], c[1], CROWN.finialR, n);
  const s = spire(fr, c, zc, CROWN.finialH, b.paint('stone'), 'dome.finial');
  b.parts.push({ role: 'dome', name: 'dome.finial', faces: s.faces, solids: s.solids });
  b.faces.push(...s.faces);
  b.rel('rests on', ['dome.finial'], ['dome'], 'the finial stands on the top of the dome');
}

/** A flat face over a plan outline at height z, facing up. */
function capFace(outline: Vec2[], z: number, paint: Paint, part: string): Face[] {
  return [new Face(outline.map((q): Vec3 => [q[0], q[1], z]), Z, paint.tex, paint.mapping, [], part)];
}

/**
 * Towers centred on the building's corners. In a cutaway a tower on a wall
 * cut low is cut as low, and the others stop with the storey shown.
 */
export function addTowers(b: KitBuilding): void {
  const k = b.k;
  const n = b.spec.storeys.length;
  for (const t of b.spec.towers ?? []) {
    const { walls, at } = CORNERS[t.corner];
    const [ca, cb] = at(b.W, b.D);
    const s = t.size ?? 1;
    const name = `tower.${t.corner}`;
    const plan = t.round ? ring(ca, cb, s / 2, CROWN.sides) : rect(ca - s / 2, ca + s / 2, cb - s / 2, cb + s / 2);
    const cut = b.cut;
    const low = cut !== null && walls.some((w) => CUT_LOW.includes(w));
    // cut a little prouder than the posts of a cut wall and the beams of a standing one, so no two tops share a plane
    const zt = cut === null ? n * k.H + (t.above ?? 1) : low ? b.floorTop(cut) + k.cut + 0.08 : (cut + 1) * k.H + 0.04;
    const walling = b.paint('plaster');
    const topPaint = b.paint('stone');
    b.add(prism(plan, [[0, 0, 0], [1, 0, 0], [0, 1, 0]], 0, zt, { front: topPaint, side: walling }, { part: name }), 'tower', { at: [ca, cb] });
    // Its top is left untagged in a cutaway: a quarter of the tower stands in the room's corner, like a pier.
    b.fits(`${name}: no door or window is buried in it`, !walls.some((w) => buried(b, w, t.corner, s)));
    b.joints.push({ label: 'tower meets wall', at: [ca - s / 2, cb - s / 2, k.plinthH] });
    if (cut !== null) continue;
    if (t.top === 'cone') {
      const eave = shrink(plan, [ca, cb], (s / 2 + CROWN.capOut) / (s / 2));
      const capped = prism(eave, [[0, 0, zt], [1, 0, 0], [0, 1, 0]], 0, CROWN.capH, { side: b.paint('timber') }, { part: `${name}.eave` });
      b.add(capped, 'tower');
      b.rel('rests on', [`${name}.eave`], [name], `the eave of the ${t.corner} tower sits on it`);
      const sp = spire(eave, [ca, cb], zt + CROWN.capH, s * CROWN.cone, b.paint('roof'), `${name}.roof`);
      b.parts.push({ role: 'tower', name: `${name}.roof`, faces: sp.faces, solids: sp.solids });
      b.faces.push(...sp.faces);
      b.rel('rests on', [`${name}.roof`], [`${name}.eave`], `the roof of the ${t.corner} tower sits on its eave`);
    } else if (b.spec.battlements) {
      // set in by half a merlon's depth, so the merlons stand flush on the tower's top
      const inset = (v: Vec2): Vec2 => [v[0] + (ca - v[0]) * (CROWN.parapetT / s), v[1] + (cb - v[1]) * (CROWN.parapetT / s)];
      plan.forEach((p, i) => {
        const [a, q] = [inset(p), inset(plan[(i + 1) % plan.length]!)];
        // each run starts half a depth after the corner, so it meets the run before without going into it
        const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
        const d = CROWN.parapetT / 2 / len;
        merlons(b, [a[0] + (q[0] - a[0]) * d, a[1] + (q[1] - a[1]) * d], q, CROWN.parapetT, zt, name, `${name}.battlement.${i}`);
      });
    }
  }
}

/** True when a door or window in a wall lies under a tower at the given corner. */
function buried(b: KitBuilding, side: Side, corner: Corner, size: number): boolean {
  const L = b.runLen(side);
  // bays count left to right seen from outside: which end of this wall is the corner
  const startCorner: Record<Side, Corner> = { front: 'front-left', right: 'front-right', back: 'back-right', left: 'back-left' };
  const atStart = startCorner[side] === corner;
  const reach = size / 2 + b.k.trimW;
  return b.spec.storeys.some((lay) =>
    Object.keys(lay[side] ?? {}).some((j) => {
      const bay = Number(j);
      const [x0, x1] = [bay + 0.5 - b.k.doorW / 2 - b.k.trimW, bay + 0.5 + b.k.doorW / 2 + b.k.trimW];
      return atStart ? x0 < reach : x1 > L - reach;
    }),
  );
}
