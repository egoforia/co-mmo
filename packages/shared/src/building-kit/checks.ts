// Shape checks on an assembled kit building, measured on the placed solids
// with exact lines, never on boxes round them. A building is shown to no
// one until every check passes; the picture checks on its render come after.

import { Z, span, type Vec3 } from './geometry.ts';
import type { KitBuilding, KitCheck, Part, Relation } from './building.ts';
import { SIDES } from './sizes.ts';

/** How close two placed shapes must be to count as touching. */
export const TOL = 1e-3;

type Box = [Vec3, Vec3];

/** The part's box, from its solids' corners. */
function aabb(part: Part): Box {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const s of part.solids) {
    for (const [x, y] of s.outline) {
      for (const d of [s.d0, s.d1]) {
        for (let c = 0; c < 3; c++) {
          const v = s.o[c]! + x * s.ex[c]! + y * s.ey[c]! + d * s.n[c]!;
          lo[c] = Math.min(lo[c]!, v);
          hi[c] = Math.max(hi[c]!, v);
        }
      }
    }
  }
  return [lo as unknown as Vec3, hi as unknown as Vec3];
}

/** n sample places across [lo, hi], kept just off its ends. */
function grid(lo: number, hi: number, n: number): number[] {
  const e = Math.min(1e-4, (hi - lo) / 4);
  const [a, b] = [lo + e, hi - e];
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + (i * (b - a)) / (n - 1)));
}

/** Where the line p0 + t*dir is inside a part. */
function partSpan(part: Part, p0: Vec3, dir: Vec3): [number, number][] {
  return part.solids.flatMap((s) => span(s, p0, dir)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/** Where a vertical line through (x, y) is inside a part: its [z0, z1] stretches. */
function col(part: Part, x: number, y: number): [number, number][] {
  return partSpan(part, [x, y, 0], Z);
}

/** The plan rectangle where two parts' boxes overlap, if they do. */
function plan(a: Part, b: Part): [number, number, number, number] | null {
  const [[al0, al1], [ah0, ah1]] = aabb(a);
  const [[bl0, bl1], [bh0, bh1]] = aabb(b);
  const [x0, x1, y0, y1] = [Math.max(al0, bl0), Math.min(ah0, bh0), Math.max(al1, bl1), Math.min(ah1, bh1)];
  return x1 - x0 > 1e-6 && y1 - y0 > 1e-6 ? [x0, x1, y0, y1] : null;
}

/**
 * Do two parts share a surface or overlap? Exact lines are cast through the
 * region where both could be, along each axis; an edge or a corner meeting
 * is not enough.
 */
export function touch(a: Part, b: Part, n = 7): boolean {
  const [al, ah] = aabb(a);
  const [bl, bh] = aabb(b);
  for (let c = 0; c < 3; c++) if (al[c]! > bh[c]! + TOL || bl[c]! > ah[c]! + TOL) return false;
  for (let ax = 0; ax < 3; ax++) {
    const [u, v] = [0, 1, 2].filter((q) => q !== ax) as [number, number];
    const [u0, u1, v0, v1] = [Math.max(al[u]!, bl[u]!), Math.min(ah[u]!, bh[u]!), Math.max(al[v]!, bl[v]!), Math.min(ah[v]!, bh[v]!)];
    if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6) continue;
    const dir: Vec3 = [ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0];
    for (const gu of grid(u0, u1, n)) {
      for (const gv of grid(v0, v1, n)) {
        const p0 = [0, 0, 0];
        [p0[u], p0[v]] = [gu, gv];
        const sa = partSpan(a, p0 as unknown as Vec3, dir);
        if (!sa.length) continue;
        const sb = partSpan(b, p0 as unknown as Vec3, dir);
        if (sa.some(([x0, x1]) => sb.some(([y0, y1]) => x0 <= y1 + TOL && y0 <= x1 + TOL))) return true;
      }
    }
  }
  return false;
}

/** How far two lists of stretches overlap at most. */
function deepest(sa: [number, number][], sb: [number, number][]): number {
  let d = -Infinity;
  for (const [x0, x1] of sa) for (const [y0, y1] of sb) d = Math.max(d, Math.min(x1, y1) - Math.max(x0, y0));
  return d;
}

/** Measures one recorded contact on the placed shapes. */
export function relation(b: KitBuilding, r: Relation, n = 9): { ok: boolean; detail: string } {
  const A = b.parts.filter((p) => r.a.includes(p.name));
  const B = b.parts.filter((p) => r.b.includes(p.name));
  if (!A.length || !B.length) return { ok: false, detail: 'a part is missing' };
  if (r.kind === 'level with') {
    const za = Math.max(...A.map((p) => aabb(p)[1][2]));
    const zb = Math.max(...B.map((p) => aabb(p)[1][2]));
    return { ok: Math.abs(za - zb) <= TOL, detail: `${za - zb >= 0 ? '+' : ''}${(za - zb).toFixed(3)} apart` };
  }
  const bad: string[] = [];
  for (const a of A) {
    if (r.kind === 'rests on') {
      const gaps: number[] = [];
      for (const q of B) {
        const pl = plan(a, q);
        if (!pl) continue;
        for (const x of grid(pl[0], pl[1], n)) {
          for (const y of grid(pl[2], pl[3], n)) {
            const ca = col(a, x, y);
            if (!ca.length) continue;
            const low = Math.min(...ca.map(([z0]) => z0));
            const under = col(q, x, y).filter(([z0]) => z0 < low + TOL).map(([, z1]) => z1);
            if (under.length) gaps.push(low - Math.max(...under));
          }
        }
      }
      const gap = Math.min(...gaps);
      if (!gaps.length) bad.push(`${a.name} is not over it`);
      else if (gap > TOL) bad.push(`${a.name} floats ${gap.toFixed(3)} above it`);
      else if (gap < -TOL) bad.push(`${a.name} sinks ${(-gap).toFixed(3)} into it`);
    } else if (r.kind === 'clear of') {
      const into: number[] = [];
      for (const q of B) {
        const pl = plan(a, q);
        if (!pl) continue;
        for (const x of grid(pl[0], pl[1], n)) {
          for (const y of grid(pl[2], pl[3], n)) {
            const d = Math.max(0, deepest(col(a, x, y), col(q, x, y)));
            if (d > TOL) into.push(d);
          }
        }
      }
      if (into.length) bad.push(`${a.name} goes ${Math.max(...into).toFixed(3)} into it`);
    } else {
      // 'set into' samples under its own footprint; 'held by' wherever the two are above each other
      let areas: [number, number, number, number][];
      if (r.kind === 'set into') {
        const [lo, hi] = aabb(a);
        areas = [[lo[0], hi[0], lo[1], hi[1]]];
      } else {
        areas = B.map((q) => plan(a, q)).filter((pl): pl is [number, number, number, number] => pl !== null);
      }
      let met = 0;
      let miss = 0;
      for (const pl of areas) {
        for (const x of grid(pl[0], pl[1], n)) {
          for (const y of grid(pl[2], pl[3], n)) {
            const ca = col(a, x, y);
            if (!ca.length) continue;
            const cb = B.flatMap((q) => col(q, x, y));
            if (r.kind === 'held by' && !cb.length) continue;
            if (deepest(ca, cb) > TOL) met++;
            else miss++;
          }
        }
      }
      if (miss || !met) bad.push(`${a.name}: ${miss} of ${met + miss} places do not go into it`);
    }
  }
  return { ok: !bad.length, detail: bad.slice(0, 4).join('; ') };
}

/** Every shape check on a building: its fits, its recorded contacts, complete walls, nothing floating. */
export function shapeChecks(b: KitBuilding): KitCheck[] {
  const out: KitCheck[] = b.contacts.map((c) => ({ ...c, check: `fits: ${c.check}` }));
  for (const r of b.relations) out.push({ check: `meets: ${r.what}`, ...relation(b, r) });
  // every wall has all its bays (a missing piece would open a hole into the room)
  const missing: string[] = [];
  for (let i = 0; i < b.rooms.length; i++) {
    for (const side of SIDES) {
      const have = new Set(b.parts.filter((p) => p.role === 'bay' && p.storey === i && p.side === side).map((p) => p.bay));
      const lack = Array.from({ length: b.runLen(side) }, (_, j) => j).filter((j) => !have.has(j));
      if (lack.length || have.size !== b.runLen(side)) missing.push(`storey ${i + 1} ${side}: bays [${lack.join(', ')}]`);
    }
  }
  out.push({ check: 'every wall is complete', ok: !missing.length, detail: missing.join('; ') });
  // every wall bay runs exactly from one post to the next (posts are what hide the joints)
  const key = (x: number, y: number, storey?: number) => `${Math.round(x * 1e6) / 1e6 + 0},${Math.round(y * 1e6) / 1e6 + 0},${storey}`;
  const posts = new Set(b.parts.filter((p) => p.role === 'post').map((p) => key(p.at![0], p.at![1], p.storey)));
  const off: string[] = [];
  for (const p of b.parts) {
    if (p.role !== 'bay') continue;
    const { o, ex } = b.frame(p.side!);
    const xs = p.faces.flatMap((f) => f.pts.map((q) => (q[0] - o[0]) * ex[0] + (q[1] - o[1]) * ex[1] + (q[2] - o[2]) * ex[2]));
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const onPosts = [x0, x1].every((x) => posts.has(key(o[0] + x * ex[0], o[1] + x * ex[1], p.storey)));
    if (Math.abs(x0 - Math.round(x0)) > 1e-9 || Math.abs(x1 - Math.round(x1)) > 1e-9 || Math.abs(x1 - x0 - 1) > 1e-9 || !onPosts) off.push(`${p.faces[0]!.part} runs ${x0.toFixed(3)}..${x1.toFixed(3)}`);
  }
  out.push({ check: 'every wall bay runs from post to post', ok: !off.length, detail: off.join('; ') });
  // every part is joined to the ground through parts it really touches
  const boxes = b.parts.map(aabb);
  const near = (i: number, j: number) => [0, 1, 2].every((c) => boxes[i]![0][c]! <= boxes[j]![1][c]! + TOL && boxes[j]![0][c]! <= boxes[i]![1][c]! + TOL);
  const seen = new Set(b.parts.map((_, i) => i).filter((i) => boxes[i]![0][2] <= TOL));
  const queue = [...seen];
  while (queue.length) {
    const i = queue.shift()!;
    for (let j = 0; j < b.parts.length; j++) {
      if (!seen.has(j) && near(i, j) && touch(b.parts[i]!, b.parts[j]!)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  const floating = [...new Set(b.parts.filter((_, i) => !seen.has(i)).map((p) => p.name))].sort();
  out.push({ check: 'nothing floats', ok: !floating.length, detail: floating.join(', ') });
  return out;
}
