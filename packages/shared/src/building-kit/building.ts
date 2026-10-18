// A kit building from plain data: footprint, storeys, doors and windows per
// wall, stairs. Code places exact timber-frame parts; the image model only
// paints the flat textures they are covered with. Every contact the design
// relies on is recorded, so the shape checks can measure it on the placed solids.

import { Z, add, arch, box, cross, offsetRing, prism, rect, region, scale, solidsOf, type Face, type Mapping, type Paint, type Solid, type Vec2, type Vec3 } from './geometry.ts';
import { addRoof, type RoofInfo } from './roof.ts';
import { CUT_LOW, placeStairs, type Flight } from './stairs.ts';
import { C30, K, R2, RUNS, S30, SIDES, TILE, tile, type KitSizes, type Side, type TileSizes } from './sizes.ts';
import { openingsOf, type BuildingSpec, type Opening } from './spec.ts';

/** What a part is, for the checks and for whatever draws it. */
export type PartRole = 'bay' | 'beam' | 'footing' | 'post' | 'door' | 'window' | 'trim' | 'sill' | 'floor' | 'stair' | 'roof' | 'ridge' | 'gable' | 'chimney';

/** One named part of a building: its faces and the solids they bound. */
export interface Part {
  role: PartRole;
  name: string;
  faces: Face[];
  solids: Solid[];
  side?: Side;
  storey?: number;
  bay?: number;
  at?: Vec2;
  step?: number;
}

/**
 * A contact the checks measure on the placed shapes: 'rests on' (sits on
 * top, no gap, not sunk), 'set into' (goes into it everywhere under its own
 * footprint), 'held by' (goes into it wherever the two are above each other),
 * 'clear of' (may touch it, never goes into it) or 'level with' (same top).
 */
export interface Relation {
  kind: 'rests on' | 'set into' | 'held by' | 'clear of' | 'level with';
  a: string[];
  b: string[];
  what: string;
}

/** One check's result, in words a builder can act on. */
export interface KitCheck {
  check: string;
  ok: boolean;
  detail: string;
}

/** The inside of one storey, for lighting it only from its own lights. */
export interface Room {
  a: [number, number];
  b: [number, number];
  z: [number, number];
  storey: number;
}

/** A light the building brings: window light falling into a room. */
export interface Light {
  kind: 'window';
  pos: Vec3;
  storey: number;
}

/** A wall's centre line between doorways, which the game uses to block walking. */
export interface BlockLine {
  storey: number;
  side: Side;
  p0: Vec2;
  p1: Vec2;
}

/** A joint worth a close look in the picture review. */
export interface Joint {
  label: string;
  at: Vec3;
}

/** How a building is built: its kit sizes, which storey a cutaway shows, and the painted tile sizes. */
export interface BuildOptions {
  k?: KitSizes;
  /** The storey shown as a cutaway (near walls cut low, everything above taken off); null shows the outside. */
  cut?: number | null;
  tiles?: TileSizes;
}

// which wall meets each end of a wall
const NEXT: Record<Side, readonly [Side, Side]> = { front: ['left', 'right'], right: ['front', 'back'], back: ['right', 'left'], left: ['back', 'front'] };

const round6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;

/** A kit building, built from its spec on construction. */
export class KitBuilding {
  readonly k: KitSizes;
  readonly cut: number | null;
  readonly T: TileSizes;
  readonly W: number;
  readonly D: number;
  faces: Face[] = [];
  parts: Part[] = [];
  /** Fit checks decided while building (openings between posts, stairs that fit). */
  contacts: KitCheck[] = [];
  relations: Relation[] = [];
  flights: Flight[] = [];
  rooms: Room[] = [];
  lights: Light[] = [];
  blocks: BlockLine[] = [];
  joints: Joint[] = [];
  roof?: RoofInfo;

  constructor(
    readonly spec: BuildingSpec,
    opts: BuildOptions = {},
  ) {
    this.k = { ...(opts.k ?? K) };
    this.cut = opts.cut ?? null;
    this.T = { ...TILE, ...opts.tiles };
    this.W = spec.W;
    this.D = spec.D;
    const n = spec.storeys.length;
    const top = this.cut === null ? n : this.cut + 1;
    placeStairs(this);
    for (let i = 0; i < top; i++) this.storey(i, this.cut === i);
    if (this.cut === null && spec.roof !== false) addRoof(this, n * this.k.H);
    this.floors(top);
  }

  /** A tiled texture by name, its grain along a direction when given. */
  paint(name: string, grain?: Vec3): Paint {
    return { tex: name, mapping: tile(name, grain, this.T) };
  }

  /** Adds a part made of these faces. */
  add(faces: Face[], role: PartRole, info: Partial<Pick<Part, 'side' | 'storey' | 'bay' | 'at' | 'step'>> = {}): void {
    this.parts.push({ role, faces, name: faces[0]!.part, solids: solidsOf(faces), ...info });
    this.faces.push(...faces);
  }

  /** Records a contact for the shape checks to measure. */
  rel(kind: Relation['kind'], a: string[], b: string[], what: string): void {
    this.relations.push({ kind, a, b, what });
  }

  /** Records a fit decided while building. */
  fits(check: string, ok: boolean, detail = ''): void {
    this.contacts.push({ check, ok, detail });
  }

  /** The names of the parts that match, sorted. */
  names(pred: (p: Part) => boolean): string[] {
    return [...new Set(this.parts.filter(pred).map((p) => p.name))].sort();
  }

  /** A wall's frame: where bay 0 starts, the direction its bays run, and its outward normal. */
  frame(side: Side, z = 0): { o: Vec3; ex: Vec3; out: Vec3 } {
    const { out, start } = RUNS[side];
    const [a, b] = start(this.W, this.D);
    return { o: [a, b, z], ex: cross(Z, out), out };
  }

  /** How many bays a wall has. */
  runLen(side: Side): number {
    return side === 'front' || side === 'back' ? this.W : this.D;
  }

  /** The top of storey i's floor. */
  floorTop(i: number): number {
    return i === 0 ? this.k.floor : i * this.k.H + this.k.floorUp;
  }

  /**
   * About how much of a flight's top step a player sees in the cutaway
   * above: a near wall cut low hides the floor beside it, up to the depth
   * where a line of sight over its cut meets the floor.
   */
  topStepShown(f: Flight): number {
    const hide = this.k.t / 2 + (this.k.cut * C30) / S30 / R2;
    const [a0, a1, b0, b1] = f.steps[f.steps.length - 1]!.rect;
    let shown = 1;
    if (CUT_LOW.includes('left')) shown *= Math.max(0, a1 - Math.max(a0, hide)) / (a1 - a0);
    if (CUT_LOW.includes('front')) shown *= Math.max(0, b1 - Math.max(b0, hide)) / (b1 - b0);
    return shown;
  }

  private storey(i: number, cutLow: boolean): void {
    const k = this.k;
    const { H, t, post: p } = k;
    const z0 = i * H;
    const ztop = z0 + H - k.plateH;
    const floorTop = this.floorTop(i);
    // rooms stack with no gap: each reaches the next floor's top, so what a stairwell shows is inside
    const z1 = i + 1 < this.spec.storeys.length ? this.floorTop(i + 1) : z0 + H;
    this.rooms.push({ a: [t / 2, this.W - t / 2], b: [t / 2, this.D - t / 2], z: [floorTop, z1], storey: i });
    const lay = this.spec.storeys[i]!;
    const low = (side: Side) => cutLow && CUT_LOW.includes(side);
    // which beam covers a corner: front and back normally, the standing wall in a cutaway
    const owns = (side: Side, end: 0 | 1) => !low(side) && (low(NEXT[side][end]) || side === 'front' || side === 'back');
    const posts = new Map<string, { a: number; b: number; z: number }>();
    for (const side of SIDES) {
      const { o, ex, out } = this.frame(side);
      const L = this.runLen(side);
      const ops = lay[side] ?? {};
      const zt = low(side) ? floorTop + k.cut : ztop;
      const wp = (x: number, y: number, d = 0): Vec3 => add(add(add(o, scale(ex, x)), scale(Z, y)), scale(out, d));
      // wall bays: one prism per bay through the wall; outer face 'front', inner face 'back'
      for (let j = 0; j < L; j++) {
        const kind = ops[j];
        const cx = j + 0.5;
        let hole: Vec2[] | null = null;
        if (kind === 'door') hole = arch(cx - k.doorW / 2, k.doorW, floorTop, k.doorH, k.doorFacets);
        else if (kind === 'window') hole = rect(cx - k.winW / 2, cx + k.winW / 2, floorTop + k.winSill, floorTop + k.winSill + k.winH);
        if (hole && kind) this.checkOpening(side, i, j, kind, hole, ztop, z0);
        let outline = rect(j, j + 1, z0, zt);
        let holes = hole ? [hole] : [];
        if (hole && low(side)) {
          let hx0 = Math.min(...hole.map((q) => q[0]));
          let hx1 = Math.max(...hole.map((q) => q[0]));
          const hy0 = Math.min(...hole.map((q) => q[1]));
          if (kind === 'door') [hx0, hx1] = [hx0 - k.trimW, hx1 + k.trimW]; // as wide as the footing's notch
          this.fits(`${side}${i} bay ${j}: the cut passes the straight part of the opening`, hy0 >= zt || kind === 'window' || zt < floorTop + k.doorH - k.doorW / 2);
          holes = [];
          // the opening reaches the cut: it becomes a notch in the top of the wall
          if (hy0 < zt) outline = [[j, z0], [j + 1, z0], [j + 1, zt], [hx1, zt], [hx1, hy0], [hx0, hy0], [hx0, zt], [j, zt]];
        }
        const [vis0, vis1] = [j + p / 2, j + 1 - p / 2];
        // panels and inside walls are painted one storey tall; on the ground floor their foot hides behind
        // the footing and the floor, so every storey shows the same picture at the same size
        const front: Paint = kind === undefined ? { tex: 'panel', mapping: fit(wp(vis0, z0, t / 2), wp(vis1, z0, t / 2), wp(vis0, ztop, t / 2)) } : this.paint('plaster');
        const back: Paint = { tex: 'inside', mapping: fit(wp(vis1, z0, -t / 2), wp(vis0, z0, -t / 2), wp(vis1, ztop, -t / 2)) };
        const cut = low(side);
        const tagger = (a: Vec2, b: Vec2, n3: Vec3) => {
          if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[0] - Math.round(a[0])) < 1e-9) return 'hidden'; // bay ends sit inside posts
          if (Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[1] - zt) < 1e-9 && n3[2] > 0.5) return cut ? 'cut' : 'hidden'; // wall top: cut, or under the beam
          return '';
        };
        const f = prism(outline, [o, ex, Z], -t / 2, t / 2, { front, back, side: this.paint('plaster') }, { holes, part: `${side}${i}.bay${j}`, sideTag: tagger });
        this.add(f, 'bay', { side, storey: i, bay: j });
        if (holes.length && kind) this.opening(side, i, j, kind, hole!, o, ex, out);
      }
      // posts at every grid point of this run, from the floor below (hidden in the footing) to the beam
      for (let j = 0; j <= L; j++) {
        const [a, b] = [round6(o[0] + j * ex[0]), round6(o[1] + j * ex[1])];
        const pz = zt + (low(side) ? 0.04 : 0); // posts stand a little proud of a cut wall, never level with it
        const had = posts.get(`${a},${b}`);
        posts.set(`${a},${b}`, { a, b, z: had ? Math.max(had.z, pz) : pz }); // a corner post stays tall if one of its walls does
      }
      const bays = Array.from({ length: L }, (_, j) => `${side}${i}.bay${j}`);
      // the beam on top of the walls (not on walls cut low)
      if (!low(side)) {
        const e = k.plateW / 2;
        const g = this.paint('timber', ex);
        const beam = prism(rect(owns(side, 0) ? -e : e, owns(side, 1) ? L + e : L - e, ztop, z0 + H), [o, ex, Z], -e, e, { front: g, back: g, side: g }, { part: `${side}${i}.beam` });
        this.add(beam, 'beam', { side, storey: i });
        this.rel('rests on', [`${side}${i}.beam`], bays, `the ${side} beam of storey ${i + 1} rests on its wall`);
      }
      if (i === 0) {
        // stone footing under the ground storey: only the part proud of the wall, so it never overlaps it
        const [d0, d1] = [t / 2, t / 2 + k.plinthOut];
        const [x0, x1] = side === 'front' || side === 'back' ? [-d1, L + d1] : [-d0, L + d0];
        const ph = k.plinthH;
        const ol: Vec2[] = [[x0, 0], [x1, 0], [x1, ph]];
        // a notch at each door, wide enough for its trim
        for (const [j, kind] of openingsOf(ops).reverse()) {
          if (kind !== 'door') continue;
          const w2 = k.doorW / 2 + k.trimW;
          ol.push([j + 0.5 + w2, ph], [j + 0.5 + w2, k.floor], [j + 0.5 - w2, k.floor], [j + 0.5 - w2, ph]);
        }
        ol.push([x0, ph]);
        const stone = this.paint('stone');
        this.add(prism(ol, [o, ex, Z], d0, d1, { front: stone, side: stone }, { part: `${side}.footing` }), 'footing', { side });
      } else {
        this.rel('rests on', bays, [`${side}${i - 1}.beam`], `the ${side} wall of storey ${i + 1} rests on the beam below`);
      }
      // the blocking line: the wall's centre line, less its doorways
      let x = 0;
      const segs: [number, number][] = [];
      for (const [j, kind] of openingsOf(ops)) {
        if (kind !== 'door') continue;
        segs.push([x, j + 0.5 - k.doorW / 2]);
        x = j + 0.5 + k.doorW / 2;
      }
      segs.push([x, L]);
      for (const [a, b] of segs) this.blocks.push({ storey: i, side, p0: [o[0] + a * ex[0], o[1] + a * ex[1]], p1: [o[0] + b * ex[0], o[1] + b * ex[1]] });
    }
    for (const { a, b, z } of posts.values()) {
      const h = p / 2;
      const f = box(a - h, a + h, b - h, b + h, z0, z, this.paint('timber'), this.paint('timber', Z), `post${i}@${a},${b}`);
      f[0]!.tag = z >= ztop - 1e-9 ? 'hidden' : 'cut'; // a full post's top is under a beam
      this.add(f, 'post', { storey: i, at: [a, b] });
      if (i === 0) this.joints.push({ label: 'post meets footing', at: [a - h, b - h, k.plinthH] }); // the corner nearest the camera
      this.joints.push({ label: z >= ztop ? 'post meets beam' : 'post at the cut', at: [a - h, b - h, z] });
    }
    if (i > 0) {
      this.rel('rests on', this.names((q) => q.role === 'post' && q.storey === i), this.names((q) => q.role === 'beam' && q.storey === i - 1), `the posts of storey ${i + 1} stand on the beams below`);
    }
    if (!cutLow) this.joints.push({ label: 'beam corner', at: [-k.plateW / 2, -k.plateW / 2, z0 + H] });
    if (i === 0) this.joints.push({ label: 'footing corner', at: [-t / 2 - k.plinthOut, -t / 2 - k.plinthOut, k.plinthH] });
  }

  private checkOpening(side: Side, i: number, j: number, kind: Opening, hole: Vec2[], ztop: number, z0: number): void {
    const k = this.k;
    const xs = hole.map((q) => q[0]);
    const ys = hole.map((q) => q[1]);
    const tw = k.trimW;
    const [lo, hi] = [j + k.post / 2, j + 1 - k.post / 2];
    this.fits(`${side}${i} bay ${j} ${kind}: opening and trim stay between the posts`, Math.min(...xs) - tw >= lo - 1e-9 && Math.max(...xs) + tw <= hi + 1e-9);
    this.fits(`${side}${i} bay ${j} ${kind}: opening and trim stay under the beam`, Math.max(...ys) + tw <= ztop + 1e-9);
    if (kind === 'window') this.fits(`${side}${i} bay ${j} window: sill above the footing`, Math.min(...ys) - tw - 0.05 > z0 + (i === 0 ? k.plinthH : 0));
  }

  private opening(side: Side, i: number, j: number, kind: Opening, hole: Vec2[], o: Vec3, ex: Vec3, out: Vec3): void {
    const k = this.k;
    const t = k.t;
    const lf = k.leaf / 2;
    const P = (x: number, y: number, d = 0): Vec3 => add(add(add(o, scale(ex, x)), scale(Z, y)), scale(out, d));
    const [x0, x1] = [Math.min(...hole.map((q) => q[0])), Math.max(...hole.map((q) => q[0]))];
    const [y0, y1] = [Math.min(...hole.map((q) => q[1])), Math.max(...hole.map((q) => q[1]))];
    // the door leaf or the window pane: a thin slab in the middle of the wall, painted on both sides; its
    // edges touch the opening's sides, so they are hidden
    const outside = { tex: kind, mapping: fit(P(x0, y0, lf), P(x1, y0, lf), P(x0, y1, lf)) };
    const inside = { tex: kind, mapping: fit(P(x1, y0, -lf), P(x0, y0, -lf), P(x1, y1, -lf)) };
    const leaf = prism(hole, [o, ex, Z], -lf, lf, { front: outside, back: inside, side: this.paint('timber') }, { part: `${side}${i}.${kind}${j}`, sideTag: () => 'hidden' });
    this.add(leaf, kind, { side, storey: i, bay: j });
    if (kind === 'door') this.rel('rests on', [`${side}${i}.door${j}`], [`${side}${i}.bay${j}`], `the ${side} door of storey ${i + 1} stands on its threshold`);
    // timber trim on the outside, mitred
    for (const q of offsetRing(hole, k.trimW, kind === 'door')) {
      const grain = add(scale(ex, q[1]![0] - q[0]![0]), scale(Z, q[1]![1] - q[0]![1]));
      const g = this.paint('timber', grain);
      this.add(prism(q, [o, ex, Z], t / 2, t / 2 + k.trimD, { front: g, side: g }, { part: `${side}${i}.${kind}${j}.trim` }), 'trim', { side, storey: i, bay: j });
    }
    if (kind === 'window') {
      const sy = y0 - k.trimW;
      const g = this.paint('timber', ex);
      const sill = prism(rect(x0 - k.trimW - 0.03, x1 + k.trimW + 0.03, sy - 0.05, sy), [o, ex, Z], t / 2, t / 2 + k.trimD + k.sillD, { front: g, side: g }, { part: `${side}${i}.sill${j}` });
      this.add(sill, 'sill', { side, storey: i, bay: j });
      this.lights.push({ kind: 'window', pos: P((x0 + x1) / 2, (y0 + y1) / 2, -t / 2 - 0.25), storey: i });
    }
    this.joints.push({ label: `${kind} bottom`, at: P((x0 + x1) / 2, y0, t / 2) });
  }

  /** Floors (with a stairwell cut where stairs climb through) and the steps of each flight. */
  protected floors(top: number): void {
    const k = this.k;
    const t = k.t;
    const room: [number, number, number, number] = [t / 2, this.W - t / 2, t / 2, this.D - t / 2];
    for (let i = 0; i < top; i++) {
      const zt = this.floorTop(i);
      const zb = i === 0 ? 0 : i * k.H - k.plateH;
      const wells = this.flights.filter((f) => f.storey === i - 1 && f.hole).map((f) => f.hole!);
      for (const { outline, holes } of region(room, wells)) {
        const f = prism(outline, [[0, 0, zb], [1, 0, 0], [0, 1, 0]], 0, zt - zb, { front: this.paint('floor', [1, 0, 0]), side: this.paint('timber') }, { holes, part: `floor${i}` });
        this.add(f, 'floor', { storey: i });
      }
      if (i > 0) this.rel('held by', [`floor${i}`], this.names((q) => q.role === 'beam' && q.storey === i - 1), `the floor of storey ${i + 1} is held by the beams below`);
      this.joints.push({ label: 'wall meets floor', at: [room[0], room[3], zt] }, { label: 'wall meets floor', at: [room[1], room[2] + 0.5, zt] });
    }
    for (const f of this.flights) {
      const i = f.storey;
      if (i >= top) continue;
      const clip = this.cut === i ? i * k.H + k.H - k.plateH : null; // a cutaway stops the stairs under the beams
      const along: Vec3 = f.along === 0 ? [1, 0, 0] : [0, 1, 0];
      const across: Vec3 = f.along === 0 ? [0, 1, 0] : [1, 0, 0];
      f.steps.forEach((st, j) => {
        const [a0, a1, b0, b1] = st.rect;
        const g = box(a0, a1, b0, b1, f.zFrom, clip === null ? st.top : Math.min(st.top, clip), this.paint('timber', across), this.paint('timber', along), `stair${i}.${j}`);
        if (clip !== null && st.top > clip) g[0]!.tag = 'cut';
        this.add(g, 'stair', { storey: i, step: j });
      });
      const nm = f.steps.map((_, j) => `stair${i}.${j}`);
      this.rel('rests on', nm, [`floor${i}`], `the stairs from storey ${i + 1} stand on its floor`);
      if (i + 1 < top) {
        this.rel('clear of', nm, [`floor${i + 1}`], `the stairs from storey ${i + 1} climb through an opening in the floor above`);
        this.rel('level with', [nm[nm.length - 1]!], [`floor${i + 1}`], `the top step is level with the floor of storey ${i + 2}`);
      }
      const [a0, , b0] = f.steps[0]!.rect;
      this.joints.push({ label: 'stairs meet floor', at: [a0, b0, f.zFrom] });
    }
  }
}

/** A 'fit' mapping from three world corners. */
function fit(bl: Vec3, br: Vec3, tl: Vec3): Mapping {
  return { kind: 'fit', bl, br, tl };
}
