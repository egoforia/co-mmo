// A building's gable roof: two slopes, a ridge beam, gables under the roof's
// ends with their king posts, and an optional chimney set into the roof.

import { Z, add, box, cross, dot, prism, scale, type Vec2, type Vec3 } from './geometry.ts';
import type { KitBuilding } from './building.ts';
import type { Side } from './sizes.ts';

/** Where the roof sits, for whatever is placed on it later. */
export interface RoofInfo {
  /** Top of the walls' beams, where the roof starts. */
  zr0: number;
  /** Height of the roof's underside at distance c across the ridge. */
  zu: (c: number) => number;
  /** Top of the roof at the ridge. */
  ridge: number;
  along: 'a' | 'b';
}

/**
 * Adds a pitched roof whose ridge runs along the longer side (or spec.ridge),
 * worked out in ridge coordinates: l along the ridge, c across it.
 */
export function addRoof(b: KitBuilding, zr0: number): void {
  const k = b.k;
  const e = k.plateW / 2;
  const t = k.t;
  const top = b.spec.storeys.length - 1;
  const pr = (k.pitch * Math.PI) / 180;
  const [tp, cp, sp] = [Math.tan(pr), Math.cos(pr), Math.sin(pr)];
  const along = b.spec.ridge ?? (b.W >= b.D ? 'a' : 'b');
  const alongA = along === 'a';
  const [Lr, S] = alongA ? [b.W, b.D] : [b.D, b.W];
  const Lh: Vec3 = alongA ? [1, 0, 0] : [0, 1, 0];
  const Ch: Vec3 = alongA ? [0, 1, 0] : [1, 0, 0];
  const gables: Side[] = alongA ? ['left', 'right'] : ['front', 'back'];
  const eaves: Side[] = alongA ? ['front', 'back'] : ['left', 'right'];
  const world = (l: number, c: number, z: number): Vec3 => (alongA ? [l, c, z] : [c, l, z]);
  const rt = k.roofT / cp; // the roof slab's thickness, measured straight up
  const [lMin, lMax] = [-e - k.verge, Lr + e + k.verge];
  const zu = (c: number) => zr0 + (Math.min(c, S - c) + e) * tp;
  const ce = -e - k.eave;
  const ze = zr0 - k.eave * tp;
  const zr = zu(S / 2);
  b.roof = { zr0, zu, ridge: zr + rt, along };
  // each slope is an outline in (c, z), pushed along the ridge
  const n = cross(Ch, Z);
  const [d0, d1] = dot(n, Lh) > 0 ? [0, lMax - lMin] : [-(lMax - lMin), 0];
  const fr: [Vec3, Vec3, Vec3] = [world(lMin, 0, 0), Ch, Z];
  const roofSide = (n3: Vec3) => (n3[2] > 0.3 ? b.paint('roof', Lh) : b.paint('timber', Lh));
  const near: Vec2[] = [[ce, ze], [S / 2, zr], [S / 2, zr + rt], [ce, ze + rt]];
  const far: Vec2[] = [[S - ce, ze], [S - ce, ze + rt], [S / 2, zr + rt], [S / 2, zr]];
  for (const [name, ol, slope] of [['near', near, add(scale(Ch, cp), scale(Z, sp))], ['far', far, add(scale(Ch, -cp), scale(Z, sp))]] as const) {
    const end = b.paint('timber', slope); // both ends are finished, whichever way the building turns
    b.add(prism(ol, fr, d0, d1, { front: end, back: end, side: roofSide }, { part: `roof.${name}` }), 'roof');
  }
  // the ridge beam is a little longer than the roof, so its ends never share a plane with the roof's ends
  const rc = k.ridge;
  const p0 = world(lMin - 0.02, S / 2 - rc, 0);
  const p1 = world(lMax + 0.02, S / 2 + rc, 0);
  const ridge = b.paint('timber', Lh);
  const ridgeBeam = box(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]), zu(S / 2 - rc) + rt - 0.005, zr + rt + 0.6 * rc, ridge, ridge, 'ridge');
  b.add(ridgeBeam, 'ridge');
  b.rel('rests on', ['roof.near'], [`${eaves[0]}${top}.beam`], `the near roof slope rests on the ${eaves[0]} beam`);
  b.rel('rests on', ['roof.far'], [`${eaves[1]}${top}.beam`], `the far roof slope rests on the ${eaves[1]} beam`);
  b.rel('held by', ['ridge'], ['roof.near', 'roof.far'], 'the ridge beam sits into the top of the roof');
  // gables on the walls under the roof's ends, their slopes exactly under the roof
  for (const side of gables) {
    const { o, ex } = b.frame(side);
    const ol: Vec2[] = [[-e, zr0], [S + e, zr0], [S / 2, zr]]; // symmetric, so it reads the same from both ends
    const plaster = b.paint('plaster');
    b.add(prism(ol, [o, ex, Z], -t / 2, t / 2, { front: plaster, side: plaster }, { part: `gable.${side}`, sideTag: (_a, _b, n3) => (n3[2] > 0.3 ? 'hidden' : '') }), 'gable', { side });
    const w = k.king;
    const kp: Vec2[] = [[S / 2 - w, zr0], [S / 2 + w, zr0], [S / 2 + w, zu(S / 2 + w)], [S / 2, zr], [S / 2 - w, zu(S / 2 - w)]];
    const timber = b.paint('timber', Z);
    b.add(prism(kp, [o, ex, Z], t / 2, t / 2 + k.trimD, { front: timber, side: timber }, { part: `gable.${side}.king` }), 'trim', { side });
    b.rel('rests on', [`gable.${side}`], [`${side}${top}.beam`], `the ${side} gable stands on its beam`);
    b.rel('rests on', [`gable.${side}.king`], [`${side}${top}.beam`], `the ${side} king post stands on its beam`);
    for (const name of ['near', 'far']) b.rel('rests on', [`roof.${name}`], [`gable.${side}`], `the ${name} roof slope rests on the ${side} gable`);
  }
  b.joints.push(
    { label: 'eave corner', at: world(lMin, ce, ze + rt) },
    { label: 'ridge end', at: world(lMin, S / 2, zr + rt) },
    { label: 'gable foot', at: world(-t / 2, -e, zr0) },
    { label: 'roof meets gable', at: world(-t / 2, S * 0.25, zu(S * 0.25)) },
  );
  const ch = b.spec.chimney;
  if (!ch) return;
  const [ca, cb] = ch;
  const c = k.chimney / 2;
  const topZ = zr + rt + k.chimneyUp;
  b.add(box(ca - c, ca + c, cb - c, cb + c, zr0, topZ, b.paint('stone'), b.paint('stone'), 'chimney'), 'chimney');
  b.add(box(ca - c - 0.03, ca + c + 0.03, cb - c - 0.03, cb + c + 0.03, topZ, topZ + 0.07, b.paint('timber'), b.paint('timber', [1, 0, 0]), 'chimney.cap'), 'chimney');
  b.rel('set into', ['chimney'], ['roof.near', 'roof.far', 'ridge'], 'the chimney goes into the roof everywhere under it (no floating)');
  b.rel('rests on', ['chimney.cap'], ['chimney'], 'the chimney cap sits on the chimney');
  b.joints.push({ label: 'chimney meets roof', at: [ca - c, cb - c, zu(alongA ? cb - c : ca - c) + rt] });
}
