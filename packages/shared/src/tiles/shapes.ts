import type { RegionMap } from '../world.ts';
import { wayOf, type TileSpot } from './grid.ts';
import { clearLine, tilesFor } from './sight.ts';

// The tiles a skill covers (docs/combat.md, Skill shapes): a cone is a wedge
// of tiles opening ahead, a line a row of tiles straight ahead, an area a
// square of tiles about a spot. The server hits what stands on them, and
// the browser shows them with the painted tile marker (skill-art.ts
// TILE_MARKER_ART) as the skill is aimed and as it lands.

/** The shapes a skill can cover. */
export type SkillShape = 'cone' | 'line' | 'area';

/** What a shape needs: where it starts, which way it points, and how far it goes. */
export interface ShapeAsk {
  shape: SkillShape;
  /** The caster's tile (a cone or line), or the area's middle. */
  from: TileSpot;
  /** Which way a cone or line points, any numbers (rounded to one of eight ways). */
  dx: number;
  dy: number;
  /** How far it reaches, in tiles as skills give it (tilesFor). */
  range: number;
  floor?: number;
}

/**
 * Every tile a shape covers that the caster can see from where it starts:
 * trees, rocks and walls cut a cone or line short. A cone pointing straight
 * holds the tiles within an eighth of a turn either side; pointing
 * corner-wise, the quarter between its two sides.
 */
export function shapeTiles(map: RegionMap | undefined, ask: ShapeAsk): TileSpot[] {
  const reach = Math.max(1, tilesFor(ask.range));
  const out: TileSpot[] = [];
  const { from } = ask;
  if (ask.shape === 'area') {
    for (let y = -reach; y <= reach; y++) for (let x = -reach; x <= reach; x++) out.push({ tx: from.tx + x, ty: from.ty + y });
    return out.filter((t) => inside(map, t));
  }
  const way = wayOf(ask.dx, ask.dy) ?? { dx: 1, dy: 0 };
  for (let y = -reach; y <= reach; y++) {
    for (let x = -reach; x <= reach; x++) {
      if (x === 0 && y === 0) continue;
      if (ask.shape === 'line' ? onLine(x, y, way) : inCone(x, y, way)) out.push({ tx: from.tx + x, ty: from.ty + y });
    }
  }
  return out.filter((t) => inside(map, t) && (!map || clearLine(map, from, t, ask.floor ?? 0)));
}

/** True when a tile, this far from the caster, lies on the row straight ahead. */
function onLine(x: number, y: number, way: { dx: number; dy: number }): boolean {
  const n = Math.max(Math.abs(x), Math.abs(y));
  return x === way.dx * n && y === way.dy * n;
}

/** True when a tile, this far from the caster, lies in the wedge ahead. */
function inCone(x: number, y: number, way: { dx: number; dy: number }): boolean {
  if (way.dx !== 0 && way.dy !== 0) return x * way.dx >= 0 && y * way.dy >= 0;
  // Straight: ahead along the way, no wider to either side than it is far.
  const along = x * way.dx + y * way.dy;
  const across = Math.abs(x * way.dy - y * way.dx);
  return along > 0 && across <= along;
}

function inside(map: RegionMap | undefined, t: TileSpot): boolean {
  return !map || (t.tx >= 0 && t.ty >= 0 && t.tx < map.width && t.ty < map.height);
}
