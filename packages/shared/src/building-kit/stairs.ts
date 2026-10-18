// Straight flights of stairs against the inside of a wall. Each flight is
// placed before anything is built: it must fit the room, leave room to walk
// past, give headroom, keep clear of doors, windows and the stairs below,
// and arrive where the cutaway above shows it.

import { add, scale, sub } from './geometry.ts';
import type { KitBuilding } from './building.ts';
import type { Side } from './sizes.ts';
import { openingsOf, type Opening, type StairPlace } from './spec.ts';

/** A plan rectangle: a0, a1, b0, b1. */
export type Rect = [number, number, number, number];

/** Clear height a person needs under the floor above while climbing. */
export const HEAD = 0.95;
/** Clear width a person needs beside the stairs and where they arrive. */
export const WALK = 0.45;
/** Share of the top step that must show in the cutaway above, so players see where the stairs come up. */
export const WAY_DOWN = 0.5;
/** The near walls, which a cutaway cuts low. */
export const CUT_LOW: readonly Side[] = ['front', 'left'];
/** Where the kit tries a flight, in order: a wall and which way along it to climb. */
export const STAIR_PLACES: readonly (readonly [Side, 1 | -1])[] = [
  ['back', 1], ['back', -1], ['right', 1], ['right', -1], ['left', 1], ['left', -1], ['front', 1], ['front', -1],
];

/** One flight from storey i to i + 1. */
export interface Flight {
  storey: number;
  wall: Side;
  up: 1 | -1;
  /** 0 when it climbs along a, 1 along b. */
  along: 0 | 1;
  steps: { rect: Rect; top: number }[];
  zFrom: number;
  zTo: number;
  rise: number;
  /** Its whole footprint. */
  foot: Rect;
  /** The stairwell cut in the floor above, if the climb needs one. */
  hole: Rect | null;
  /** Where people step off at the top. */
  arrive: Rect;
  length: number;
  roomLen: number;
  roomAcross: number;
  headroom: number;
}

/** Where an opening needs the room clear: a door the space to walk through it, a window its glass. */
export interface Zone {
  side: Side;
  bay: number;
  kind: Opening;
  z: [number, number];
  rect: Rect;
}

/** Area two plan rectangles share. */
export function overlap(r1: Rect, r2: Rect): number {
  return Math.max(0, Math.min(r1[1], r2[1]) - Math.max(r1[0], r2[0])) * Math.max(0, Math.min(r1[3], r2[3]) - Math.max(r1[2], r2[2]));
}

/** A straight flight from storey i to i + 1 against the inside of one wall, climbing towards one end. */
export function flight(b: KitBuilding, i: number, wall: Side, up: 1 | -1): Flight {
  const k = b.k;
  const t = k.t;
  const [sw, go, n] = [k.stairW, k.stairGo, k.stairN];
  const [a0, a1, b0, b1] = [t / 2, b.W - t / 2, t / 2, b.D - t / 2];
  const along = wall === 'front' || wall === 'back' ? 0 : 1;
  const [lo, hi] = along === 0 ? [a0, a1] : [b0, b1];
  const [c0, c1] = { back: [b1 - sw, b1], front: [b0, b0 + sw], right: [a1 - sw, a1], left: [a0, a0 + sw] }[wall];
  const inward = wall === 'back' || wall === 'right' ? [c0 - WALK, c0] : [c1, c1 + WALK];
  const R = (x0: number, x1: number, y0: number, y1: number): Rect => (along === 0 ? [x0, x1, y0, y1] : [y0, y1, x0, x1]);
  const [zFrom, zTo] = [b.floorTop(i), b.floorTop(i + 1)];
  const rise = (zTo - zFrom) / n;
  const under = (i + 1) * k.H - k.plateH; // underside of the floor above
  const xs = Array.from({ length: n }, (_, j): [number, number] => (up > 0 ? [hi - (n - j) * go, hi - (n - j - 1) * go] : [lo + (n - j - 1) * go, lo + (n - j) * go]));
  const steps = xs.map((x, j) => ({ rect: R(x[0], x[1], c0, c1), top: zFrom + (j + 1) * rise }));
  // the first step that needs the floor above opened
  let jh = steps.findIndex((st) => under - st.top < HEAD);
  if (jh < 0) jh = n;
  const last = xs[n - 1]!;
  const hole = jh < n ? R(Math.min(xs[jh]![0], last[0]), Math.max(xs[jh]![1], last[1]), c0, c1) : null;
  return {
    storey: i, wall, up, along, steps, zFrom, zTo, rise,
    foot: R(Math.min(...xs.map((x) => x[0])), Math.max(...xs.map((x) => x[1])), c0, c1),
    hole,
    arrive: R(last[0], last[1], inward[0]!, inward[1]!),
    length: n * go,
    roomLen: hi - lo,
    roomAcross: along === 0 ? b1 - b0 : a1 - a0,
    headroom: under - steps[0]!.top,
  };
}

/** Where each opening of storey i needs to stay clear, inside the room. */
export function zones(b: KitBuilding, i: number): Zone[] {
  const k = b.k;
  const t = k.t;
  const ft = b.floorTop(i);
  const out: Zone[] = [];
  for (const [side, ops] of Object.entries(b.spec.storeys[i] ?? {}) as [Side, Record<number, Opening>][]) {
    const { o, ex, out: outward } = b.frame(side);
    for (const [j, kind] of openingsOf(ops)) {
      const w = kind === 'door' ? k.doorW : k.winW;
      const z: [number, number] = kind === 'door' ? [ft, ft + k.doorH] : [ft + k.winSill - 0.05, ft + k.winSill + k.winH];
      const depth = kind === 'door' ? 0.5 : 0.05;
      const ps = [j + 0.5 - w / 2, j + 0.5 + w / 2].flatMap((x) => [t / 2, t / 2 + depth].map((d) => sub(add(o, scale(ex, x)), scale(outward, d))));
      const xs = ps.map((q) => q[0]);
      const ys = ps.map((q) => q[1]);
      out.push({ side, bay: j, kind, z, rect: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] });
    }
  }
  return out;
}

/** Why a flight cannot go where it is, in words; empty when it fits. */
export function flightIssues(b: KitBuilding, f: Flight, prev: Flight | null): string[] {
  const i = f.storey;
  const why: string[] = [];
  if (f.length > f.roomLen + 1e-9) why.push(`needs ${f.length.toFixed(2)} along the wall, the room has ${f.roomLen.toFixed(2)}`);
  if (f.roomAcross - b.k.stairW < WALK - 1e-9) why.push(`leaves ${(f.roomAcross - b.k.stairW).toFixed(2)} to walk past, needs ${WALK}`);
  if (f.headroom < HEAD) why.push(`only ${f.headroom.toFixed(2)} headroom over the first step`);
  if (prev?.hole && overlap(f.foot, prev.hole) > 1e-9) why.push('would stand over the stairwell from below');
  if (prev && overlap(f.foot, prev.arrive) > 1e-9) why.push('would block where the stairs from below arrive');
  const shown = b.topStepShown(f);
  if (shown < WAY_DOWN) why.push(`would arrive behind a wall the cutaway above cuts low (${Math.round(shown * 100)}% of the top step in view)`);
  for (const zn of zones(b, i)) {
    const hit = f.steps.some((st) => overlap(st.rect, zn.rect) > 1e-9 && Math.min(st.top, zn.z[1]) - Math.max(f.zFrom, zn.z[0]) > 1e-9);
    if (hit) why.push(`blocks the ${zn.kind} in the ${zn.side} wall (bay ${zn.bay})`);
  }
  if (i + 1 < b.spec.storeys.length && f.hole) {
    for (const zn of zones(b, i + 1)) {
      if (zn.kind === 'door' && overlap(zn.rect, f.hole) > 1e-9) why.push(`the door upstairs in the ${zn.side} wall (bay ${zn.bay}) would open over the stairwell`);
    }
  }
  return why;
}

/** Places each flight (or checks the places the spec gives) before anything is built. */
export function placeStairs(b: KitBuilding): void {
  const n = b.spec.storeys.length;
  const want = b.spec.stairs;
  if (!want || n < 2) return;
  const plan = Array.isArray(want) ? want : Array.from({ length: n - 1 }, (_, i): StairPlace => ({ storey: i }));
  for (const fl of plan) {
    const i = fl.storey;
    const prev = b.flights.find((g) => g.storey === i - 1) ?? null;
    const name = `stairs from storey ${i + 1} to ${i + 2}`;
    if (!(i >= 0 && i < n - 1)) {
      b.fits(`${name}: there is a storey above`, false);
      continue;
    }
    const tried: string[] = [];
    let chosen: Flight | null = null;
    for (const [wall, up] of fl.wall ? [[fl.wall, fl.up ?? 1] as const] : STAIR_PLACES) {
      const f = flight(b, i, wall, up);
      const why = flightIssues(b, f, prev);
      if (!why.length) {
        chosen = f;
        break;
      }
      tried.push(`${wall} wall going ${up > 0 ? '+' : '-'}${'ab'[f.along]}: ${why.join('; ')}`);
      if (fl.wall) chosen = f; // a place the spec chose is still built, so the fault shows
    }
    const ok = chosen !== null && !(tried.length && fl.wall);
    b.fits(`${name} fit in the room, clear of doors and windows, with headroom${ok ? ` (along the ${chosen!.wall} wall)` : ''}`, ok, tried.join(' | '));
    if (chosen) b.flights.push(chosen);
  }
}
