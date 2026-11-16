import { wallBetween } from '../edge-walls.ts';
import { Tile, tileAt, type RegionMap } from '../world.ts';
import { tilesApart, type TileSpot } from './grid.ts';

// Reach and sight on tiles (docs/combat.md, Rules): how many tiles a weapon
// or a power reaches, whether a long blade's target stands in a straight
// line, and whether a shot or a spell has a clear line to its target past
// trees, rocks and walls (and bodies, when God's View's Combat page says so).

/** Tiles that stop a shot: what stands tall. Water and gaps are shot across. */
const SIGHT_BLOCKING = new Set<Tile>([Tile.Tree, Tile.Rock, Tile.Wall, Tile.Blocked]);

/** True when nothing tall stands on this tile of a floor. */
export function seeThrough(map: RegionMap, tx: number, ty: number, floor = 0): boolean {
  return !SIGHT_BLOCKING.has(tileAt(map, tx + 0.5, ty + 0.5, floor));
}

/**
 * How many tiles a reach of `range` (tiles, as weapons and powers give it)
 * covers: anything under two is the eight touching tiles; past that, whole
 * tiles. Zero reaches only what overlaps.
 */
export function tilesFor(range: number): number {
  if (range <= 0) return 0;
  return range < 2 ? 1 : Math.floor(range + 1e-9);
}

/** The tile of a `width`-wide square nearest a tile: where a shot at a big body aims. */
export function nearestOf(anchor: TileSpot, width: number, to: TileSpot): TileSpot {
  const clamp = (v: number, lo: number) => Math.min(lo + width - 1, Math.max(lo, v));
  return { tx: clamp(to.tx, anchor.tx), ty: clamp(to.ty, anchor.ty) };
}

/** True when a tile of a square lies in a straight line from a tile: the same row or column, or a true diagonal. */
export function inLine(from: TileSpot, anchor: TileSpot, width = 1): boolean {
  for (let y = anchor.ty; y < anchor.ty + width; y++) {
    for (let x = anchor.tx; x < anchor.tx + width; x++) {
      const dx = Math.abs(x - from.tx);
      const dy = Math.abs(y - from.ty);
      if (dx === 0 || dy === 0 || dx === dy) return true;
    }
  }
  return false;
}

/**
 * The tiles a line from one tile's middle to another's passes through, in
 * order, without the two ends. Where it passes exactly over a corner, both
 * tiles beside the corner are given, as a pair.
 */
export function tilesBetween(from: TileSpot, to: TileSpot): (TileSpot | [TileSpot, TileSpot])[] {
  const out: (TileSpot | [TileSpot, TileSpot])[] = [];
  const dx = to.tx - from.tx;
  const dy = to.ty - from.ty;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  let x = from.tx;
  let y = from.ty;
  // Walk across the grid one edge at a time (a supercover line).
  for (let ix = 0, iy = 0; ix < nx || iy < ny; ) {
    const across = (0.5 + ix) / nx;
    const down = (0.5 + iy) / ny;
    if (Math.abs(across - down) < 1e-9) {
      out.push([{ tx: x + sx, ty: y }, { tx: x, ty: y + sy }]);
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (across < down) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    if (x !== to.tx || y !== to.ty) out.push({ tx: x, ty: y });
  }
  return out;
}

/**
 * True when a shot from one tile reaches another: no tall tile and no wall
 * on a tile's side in the way, and none of `blocked` (tiles bodies stand on,
 * when bodies stop shots). Past a corner, one open side is enough.
 */
export function clearLine(map: RegionMap, from: TileSpot, to: TileSpot, floor = 0, blocked?: (t: TileSpot) => boolean): boolean {
  if (tilesApart(from, 1, to, 1) <= 1 && !wallInWay(map, from, to, floor)) return true;
  const open = (t: TileSpot) => seeThrough(map, t.tx, t.ty, floor) && !blocked?.(t);
  let at = from;
  for (const step of [...tilesBetween(from, to), to]) {
    if (Array.isArray(step)) {
      const [a, b] = step;
      const viaA = open(a) && !wallInWay(map, at, a, floor);
      const viaB = open(b) && !wallInWay(map, at, b, floor);
      if (!viaA && !viaB) return false;
      // On to the far tile of the corner from whichever side was open.
      at = viaA ? a : b;
      continue;
    }
    if (step !== to && !open(step)) return false;
    if (wallInWay(map, at, step, floor)) return false;
    at = step;
  }
  return true;
}

/** True when a wall on a tile's side stands between two touching tiles (side by side, or past a corner on both ways round). */
function wallInWay(map: RegionMap, a: TileSpot, b: TileSpot, floor: number): boolean {
  const dx = b.tx - a.tx;
  const dy = b.ty - a.ty;
  if (dx === 0 && dy === 0) return false;
  if (dx === 0 || dy === 0) return wallBetween(map, a.tx, a.ty, dx, dy, floor);
  const viaX = !wallBetween(map, a.tx, a.ty, dx, 0, floor) && !wallBetween(map, a.tx + dx, a.ty, 0, dy, floor);
  const viaY = !wallBetween(map, a.tx, a.ty, 0, dy, floor) && !wallBetween(map, a.tx, a.ty + dy, dx, 0, floor);
  return !viaX && !viaY;
}
