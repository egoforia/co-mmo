import type { Footprint } from '@co-mmo/shared';

// Where a picture painted standing on tiles puts its feet, and whether its
// base runs at the game camera's angle. Read from its see-through edges, so
// it is free. The lowest outline of a thing standing on a diamond of tiles is
// a wide V: its base's two front edges, meeting at the front corner. That V
// is the lower convex hull of the picture's bottom edge; its side nearest
// the lowest point, up to where the outline turns steeper than a ground line
// can (an overhang, a canopy's edge), is each base edge. A base edge whose
// hull is many short bends (a round pot) is not judged.

/** How solid a pixel must be to count, of 255. */
const SOLID = 32;
/** A run of solid pixels narrower than this share of the widest row is a speck. */
const SPECK = 0.03;
/** A ground edge rises at most this steeply (1 = 45 degrees); steeper is the thing's side, not its base. */
const GROUND_MOST = 1;
/** A base edge shorter than this share of the picture's solid width is too short to judge. */
const EDGE_LEAST = 0.15;
/** A base edge is read as straight when one stretch of its hull spans this share of it (legs standing apart)... */
const STRAIGHT_SHARE = 0.6;
/** ...or when no bend of its hull is further from the line between its ends than this share of its length (a painted edge's pixel steps); a round base bows further. */
const BOW_MOST = 0.03;
/** The game's ground lines slope one down for two across: about 26.6 degrees. */
export const GROUND_DEGREES = (Math.atan(0.5) * 180) / Math.PI;
/** How far off the ground's angle a base edge may be before it is called wrong, in degrees. */
export const ANGLE_SLACK = 7;

/** A front foot this far off the middle of the side feet (a share of their span) shows which way a thing is turned. */
const TURN_LEAST = 0.05;
/** How much squarer than its tiles a base may look before it is called the wrong shape, as a share of the span. */
const SQUARE_SLACK = 0.14;

const tilesWord = (n: number) => (n === 1 ? '1 tile' : `${n} tiles`);

/** A point in the picture's own pixels, y down. */
export interface Point {
  x: number;
  y: number;
}

/** One base edge: from the front foot out to a side foot. */
export interface BaseEdge {
  /** Its outer foot. */
  foot: Point;
  /** How steeply it rises away from the front foot, in degrees (the game's ground is GROUND_DEGREES). */
  degrees: number;
  /** True when the outline follows it closely enough, and it is long enough, to judge its angle. */
  judged: boolean;
}

/** Where a picture's feet are. */
export interface Feet {
  /** The lowest point: where its front corner stands. */
  front: Point;
  left: BaseEdge;
  right: BaseEdge;
}

/** The lowest solid pixel of each column, specks left out; -1 where a column is empty. */
function bottoms(alpha: Uint8Array, width: number, height: number): Int32Array {
  const out = new Int32Array(width).fill(-1);
  let widest = 0;
  const rows: [number, number][][] = [];
  for (let y = 0; y < height; y++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const solid = x < width && alpha[y * width + x]! >= SOLID;
      if (solid && start < 0) start = x;
      if (!solid && start >= 0) {
        runs.push([start, x]);
        start = -1;
      }
    }
    if (runs.length) widest = Math.max(widest, runs[runs.length - 1]![1] - runs[0]![0]);
    rows.push(runs);
  }
  const least = Math.max(1, widest * SPECK);
  for (let y = 0; y < height; y++) for (const [a, b] of rows[y]!) if (b - a >= least) for (let x = a; x < b; x++) out[x] = y;
  return out;
}

/** The lower convex hull of the bottom outline, left to right (y down: the hull bulges downwards). */
function lowerHull(pts: Point[]): Point[] {
  const hull: Point[] = [];
  for (const p of pts) {
    while (hull.length >= 2) {
      const [a, b] = [hull[hull.length - 2]!, hull[hull.length - 1]!];
      // Keep b only when it is below the line from a to p.
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0) hull.pop();
      else break;
    }
    hull.push(p);
  }
  return hull;
}

/** From the front foot outwards along the hull, the edges no steeper than ground can be. */
function baseEdge(hull: Point[], from: number, step: 1 | -1, width: number): BaseEdge {
  const front = hull[from]!;
  let at = from;
  while (at + step >= 0 && at + step < hull.length) {
    const next = hull[at + step]!;
    const cur = hull[at]!;
    if (Math.abs(cur.y - next.y) > GROUND_MOST * Math.abs(next.x - cur.x)) break;
    at += step;
  }
  const foot = hull[at]!;
  const across = Math.abs(foot.x - front.x);
  const degrees = across ? (Math.atan2(front.y - foot.y, across) * 180) / Math.PI : 0;
  // The longest single stretch of the hull along it: a straight edge, or legs standing apart, is one long stretch.
  let longest = 0;
  for (let i = from; i !== at; i += step) longest = Math.max(longest, Math.abs(hull[i + step]!.x - hull[i]!.x));
  let bow = 0;
  for (let i = from; i !== at; i += step) {
    const p = hull[i]!;
    const onLine = front.y + ((foot.y - front.y) * (p.x - front.x)) / (foot.x - front.x || 1);
    bow = Math.max(bow, Math.abs(onLine - p.y));
  }
  const judged = across >= EDGE_LEAST * width && (longest >= STRAIGHT_SHARE * across || bow <= BOW_MOST * across);
  return { foot, degrees, judged };
}

/** Where a picture's feet are, from its alpha channel; undefined when nothing solid is in it. */
export function measureFeet(alpha: Uint8Array, width: number, height: number): Feet | undefined {
  const outline = bottoms(alpha, width, height);
  const pts: Point[] = [];
  for (let x = 0; x < width; x++) if (outline[x]! >= 0) pts.push({ x, y: outline[x]! });
  if (pts.length < 2) return undefined;
  const hull = lowerHull(pts);
  const solid = pts[pts.length - 1]!.x - pts[0]!.x + 1;
  // The lowest point; on a flat bottom, the middle of it.
  const lowest = Math.max(...hull.map((p) => p.y));
  const flat = hull.map((p, i) => [p, i] as const).filter(([p]) => p.y === lowest);
  const [, at] = flat[Math.floor(flat.length / 2)]!;
  return { front: hull[at]!, left: baseEdge(hull, at, -1, solid), right: baseEdge(hull, at, 1, solid) };
}

/** What the base check found, in words for the Owner. */
export interface BaseVerdict {
  /** True when every edge judged runs at the ground's angle; undefined when no edge could be judged. */
  ok?: boolean;
  words: string;
}

/** Whether a picture's base runs at the ground's angle, and which way its long side runs, for its footprint. */
export function judgeBase(feet: Feet | undefined, fp: Footprint): BaseVerdict {
  if (!feet) return { words: 'Nothing solid to measure.' };
  const deg = (n: number) => `${Math.round(n)}°`;
  const judged = ([['left', feet.left], ['right', feet.right]] as const).filter(([, e]) => e.judged);
  const off = judged.filter(([, e]) => Math.abs(e.degrees - GROUND_DEGREES) > ANGLE_SLACK);
  if (off.length) {
    const said = off.map(([side, e]) => `its ${side} edge at ${deg(e.degrees)}`).join(' and ');
    return { ok: false, words: `Painted at the wrong angle: ${said}, where the tiles slope at ${deg(GROUND_DEGREES)}. Paint it again.` };
  }
  // Which way its long side runs: where the front foot falls between the side feet, against where the front corner falls between the side corners.
  // Read from where the feet are, so a bumpy edge (stools in front of a counter) still shows it.
  const span = feet.right.foot.x - feet.left.foot.x;
  if (fp.width !== fp.height && span > 0) {
    const share = (feet.front.x - feet.left.foot.x) / span;
    const want = fp.width / (fp.width + fp.height);
    const sides = `${tilesWord(fp.width)} to the left and ${tilesWord(fp.height)} to the right`;
    if ((share - 0.5) * (want - 0.5) < 0 && Math.abs(share - 0.5) > TURN_LEAST) {
      return { ok: false, words: `Turned the other way: its long side runs to the ${share > 0.5 ? 'left' : 'right'}, but its tiles run ${sides}. Paint it again.` };
    }
    if (Math.abs(share - 0.5) < Math.abs(want - 0.5) - SQUARE_SLACK) {
      return { ok: false, words: `Too square for its tiles: they run ${sides}. Paint it again.` };
    }
  }
  if (!judged.length) return { words: 'Its base has no straight edges to measure (round, or uneven): check it by eye.' };
  return { ok: true, words: `Its base runs at the tiles' angle (${judged.map(([side, e]) => `${side} ${deg(e.degrees)}`).join(', ')}).` };
}
