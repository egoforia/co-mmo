// The tiles a skill will cover, shown while its key in the hotbar is pointed
// at (docs/combat.md, Skill shapes): the same tiles the server hits
// (shared tiles/shapes.ts), each with the painted tile marker. Only we see
// our own aim; everyone near sees the tiles as the skill lands (world-marks).

import { ABILITIES, TILE_MARKER_ART, anchorNear, shapeTiles, type RegionMap, type SkillShape, type WorldMark } from '@co-mmo/shared';

/** Tiles an area covers when its skill does not say (as the server's areas.ts). */
const AREA_RADIUS = 2;

/** Who we are aiming from and at. */
export interface Aim {
  ability: string;
  me: { x: number; y: number; floor: number };
  /** The way we last walked, for a cone or line with nothing chosen to point at. */
  facing: { dx: number; dy: number };
  /** Where the creature we chose stands, if we chose one. */
  target?: { x: number; y: number };
  /** The nearest creature, which the server aims at when we chose none. */
  nearest?: { x: number; y: number };
}

/** The marks for the tiles a skill being aimed would cover; none for a skill with no shape. */
export function aimMarks(map: RegionMap | undefined, aim: Aim): WorldMark[] {
  const a = ABILITIES[aim.ability];
  if (!a || !['cone', 'line', 'area'].includes(a.effect)) return [];
  const shape = a.effect as SkillShape;
  const toward = aim.target ?? aim.nearest;
  let tiles;
  if (shape === 'area') {
    const at = toward && aim.target && a.range > 0 ? aim.target : aim.me;
    tiles = shapeTiles(map, { shape, from: anchorNear(at.x, at.y), dx: 0, dy: 0, range: a.radius ?? AREA_RADIUS, floor: aim.me.floor });
  } else {
    const dx = toward ? toward.x - aim.me.x : aim.facing.dx;
    const dy = toward ? toward.y - aim.me.y : aim.facing.dy;
    tiles = shapeTiles(map, { shape, from: anchorNear(aim.me.x, aim.me.y), dx, dy, range: a.range, floor: aim.me.floor });
  }
  return tiles.map((t) => ({ id: `aim-${t.tx},${t.ty}`, asset: TILE_MARKER_ART, x: t.tx + 0.5, y: t.ty + 0.5, ...(aim.me.floor ? { floor: aim.me.floor } : {}) }));
}
