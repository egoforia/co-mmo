import { buildingKit } from '@co-mmo/shared';
import { cover, down, type Render } from './raster.ts';

type KitBuilding = buildingKit.KitBuilding;
type KitCheck = buildingKit.KitCheck;
const { WAY_DOWN } = buildingKit;

// Checks read from a building's render: what the shapes promise must be what
// a player sees. They run on every render, after the shape checks, and a
// building is shown to no one until both pass.

const check = (name: string, ok: boolean, detail = ''): KitCheck => ({ check: name, ok, detail });

/** Which pixels are inside a room: lit only by the room's own lights. The tops a cutaway makes are outside. */
export function insideMask(b: KitBuilding, r: Render): Uint8Array {
  const n = r.fid.length;
  const ins = new Uint8Array(n);
  if (b.cut === null) return ins;
  const e = 1e-4; // a room's walls have their inner faces on its edge
  const cutFaces = new Set(r.faces.flatMap((f, i) => (f.tag === 'cut' ? [i] : [])));
  for (let i = 0; i < n; i++) {
    if (r.fid[i]! < 0 || cutFaces.has(r.fid[i]!)) continue;
    const [x, y, z] = [r.pos[i * 3]!, r.pos[i * 3 + 1]!, r.pos[i * 3 + 2]!];
    if (b.rooms.some((m) => x > m.a[0] - e && x < m.a[1] + e && y > m.b[0] - e && y < m.b[1] + e && z > m.z[0] - e && z < m.z[1] + e)) ins[i] = 1;
  }
  return ins;
}

/** Background pixels the building closes round, in the final-size picture: holes you could see through. */
function seeThrough(r: Render): number {
  const { w, h, ss } = r.cv;
  const alpha = down(Array.from(r.fid, (f) => (f >= 0 ? 1 : 0)), w, h, 1, ss);
  const [W, H] = [w / ss, h / ss];
  const reached = new Uint8Array(W * H);
  const stack = [0];
  reached[0] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const [x, y] = [i % W, Math.floor(i / W)];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      const j = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || reached[j] || alpha[j]! > 0.5) continue;
      reached[j] = 1;
      stack.push(j);
    }
  }
  let holes = 0;
  for (let i = 0; i < W * H; i++) if (alpha[i]! <= 0.5 && !reached[i]) holes++;
  return holes;
}

/** Faces in one plane facing one way must not both show in one place (they would flicker between two paints). */
function fights(r: Render): string[] {
  const key = (x: number) => Math.round(x * 1e5) / 1e5 + 0;
  const groups = new Map<string, number[]>();
  for (const i of r.masks.keys()) {
    const f = r.faces[i]!;
    const k = `${f.n.map(key).join(',')}|${key(buildingKit.dot(f.n, f.pts[0]!))}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const out: string[] = [];
  for (const g of groups.values()) {
    for (let x = 0; x < g.length; x++) {
      for (let y = x + 1; y < g.length; y++) {
        const [i, j] = [g[x]!, g[y]!];
        const [mi, mj] = [r.masks.get(i)!, r.masks.get(j)!];
        const [X0, Y0] = [Math.max(mi.x0, mj.x0), Math.max(mi.y0, mj.y0)];
        const [X1, Y1] = [Math.min(mi.x0 + mi.w, mj.x0 + mj.w), Math.min(mi.y0 + mi.h, mj.y0 + mj.h)];
        let ov = 0;
        for (let Y = Y0; Y < Y1; Y++) {
          for (let X = X0; X < X1; X++) {
            const both = mi.m[(Y - mi.y0) * mi.w + X - mi.x0] && mj.m[(Y - mj.y0) * mj.w + X - mj.x0];
            const shown = r.fid[Y * r.cv.w + X];
            if (both && (shown === i || shown === j)) ov++; // only where one of them is what shows
          }
        }
        if (ov > 2) out.push(`${r.faces[i]!.part} / ${r.faces[j]!.part} (${ov} px)`);
      }
    }
  }
  return out;
}

/**
 * In a cutaway a player must see where the stairs from below come up: the
 * top step of each flight arriving in the storey shown must show for
 * WAY_DOWN of its top (a cut wall or the stairs up may stand in front).
 */
function wayDown(b: KitBuilding, r: Render): KitCheck[] {
  if (b.cut === null) return [];
  const zt = b.floorTop(b.cut);
  return b.flights
    .filter((f) => f.storey === b.cut! - 1)
    .map((f) => {
      const n = f.steps.length;
      const [a0, a1, b0, b1] = f.steps[n - 1]!.rect;
      const top = new Set(r.faces.flatMap((g, i) => (g.part === `stair${f.storey}.${n - 1}` && g.n[2] > 0.5 ? [i] : [])));
      const P = ([[a0, b0], [a1, b0], [a1, b1], [a0, b1]] as const).map(([x, y]) => r.cv.px([x, y, zt]));
      const [x0, y0] = [Math.max(0, Math.floor(Math.min(...P.map((q) => q[0])))), Math.max(0, Math.floor(Math.min(...P.map((q) => q[1]))))];
      const [x1, y1] = [Math.min(r.cv.w, Math.ceil(Math.max(...P.map((q) => q[0]))) + 1), Math.min(r.cv.h, Math.ceil(Math.max(...P.map((q) => q[1]))) + 1)];
      const m = cover([P], x0, y0, x1, y1);
      let [all, seen] = [0, 0];
      m.forEach((v, k) => {
        if (!v) return;
        all++;
        if (top.has(r.fid[(y0 + Math.floor(k / (x1 - x0))) * r.cv.w + x0 + (k % (x1 - x0))]!)) seen++;
      });
      const share = all ? seen / all : 0;
      return check(`the way down shows: the top of the stairs from storey ${b.cut} is seen in this cutaway`, share >= WAY_DOWN, `${Math.round(share * 100)}% of the top step shows, needs ${Math.round(WAY_DOWN * 100)}%`);
    });
}

/** Every check read from a render of the building. */
export function pictureChecks(b: KitBuilding, r: Render): KitCheck[] {
  const { faces, fid, col } = r;
  const vis = new Int32Array(faces.length);
  let [stretched, layout] = [0, 0];
  for (let i = 0; i < fid.length; i++) {
    if (fid[i]! < 0) continue;
    vis[fid[i]!]++;
    if (r.uvbad[i]) stretched++;
    const [cr, cg, cb] = [col[i * 3]!, col[i * 3 + 1]!, col[i * 3 + 2]!];
    if (Math.hypot(cr - 1, cg, cb - 1) < 0.35 || Math.hypot(cr, cg - 1, cb) < 0.35) layout++;
  }
  const shown = faces.flatMap((f, i) => (f.tag === 'hidden' && vis[i]! > 0 ? [`${f.part}: ${vis[i]} px`] : []));
  const holes = seeThrough(r);
  const fought = fights(r);
  const out = [
    check('faces meant to be hidden stay hidden (wall ends inside posts, tops under beams)', !shown.length, shown.slice(0, 6).join('; ')),
    check('stretched textures never show past their painted area', stretched === 0, `${stretched} px`),
    check('no layout colour (magenta/green) on the building', layout === 0, `${layout} px`),
    check('no gaps you can see through', holes === 0, `${holes} px`),
    check('no two surfaces fight for the same place', !fought.length, fought.slice(0, 5).join('; ')),
    ...wayDown(b, r),
  ];
  if (b.cut !== null) {
    // insides are lit only by their own lights; the tops the cut makes are outside
    const ins = insideMask(b, r);
    const inner = new Set(faces.flatMap((f, i) => (f.tex === 'inside' || (f.part === `floor${b.cut}` && f.n[2] > 0.99) ? [i] : [])));
    const cutFaces = new Set(faces.flatMap((f, i) => (f.tag === 'cut' ? [i] : [])));
    let [daylit, cutInside] = [0, 0];
    for (let i = 0; i < fid.length; i++) {
      if (inner.has(fid[i]!) && !ins[i]) daylit++;
      if (cutFaces.has(fid[i]!) && ins[i]) cutInside++;
    }
    out.push(check('room walls and floor take only inside light', daylit === 0, `${daylit} px get daylight`));
    out.push(check('the tops the cutaway makes take outside light', cutInside === 0, `${cutInside} px`));
  }
  return out;
}
