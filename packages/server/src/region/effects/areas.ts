import { SIZE_TILES, anchorNear, creatureSize, shapeTiles, type TileSpot } from '@co-mmo/shared';
import type { Creature, PlayerState } from '../state.ts';
import { aimAt, hitPlayerWith, hitWith, towards, type Cast, type Effect, type EffectKit } from './types.ts';

/** How long the tiles a cone, line or area covered stay shown, in ms. */
export const SHAPE_SHOWN_MS = 700;
/** Tiles an area covers when the skill does not say. */
const AREA_RADIUS = 2;

/**
 * Hits everything within the radius around the chosen creature (when it is
 * within range: "at a spot"), or around you.
 */
export const area: Effect = {
  ready: (kit, cast) => (inArea(kit, cast).length || rivalsInArea(kit, cast).length ? undefined : 'Nothing close enough to hit.'),
  run: (kit, cast) => {
    const { p, a } = cast;
    const at = areaMiddle(kit, cast);
    show(kit, cast, shapeTiles(kit.s.map, { shape: 'area', from: anchorNear(at.x, at.y), dx: 0, dy: 0, range: a.radius ?? AREA_RADIUS, floor: p.floor }));
    for (const c of inArea(kit, cast)) hitWith(kit, cast, c);
    // Outside safe areas an area hurts players as it hurts monsters, bystanders too (combat decisions, step 5).
    for (const v of rivalsInArea(kit, cast)) hitPlayerWith(kit, cast, v);
  },
};

/** Where an area lands: on the chosen creature or player in range, else round the caster. */
function areaMiddle(kit: EffectKit, cast: Cast): { x: number; y: number } {
  const { p, a, targetId } = cast;
  if (!targetId || a.range <= 0) return p;
  return kit.creatureInReach(p, a.range, targetId) ?? kit.rivalInReach(p, a.range, targetId) ?? p;
}

function inArea(kit: EffectKit, cast: Cast): Creature[] {
  return kit.creaturesNear(cast.p, areaMiddle(kit, cast), cast.a.radius ?? AREA_RADIUS);
}

function rivalsInArea(kit: EffectKit, cast: Cast): PlayerState[] {
  return kit.rivalsNear(cast.p, areaMiddle(kit, cast), cast.a.radius ?? AREA_RADIUS);
}

/** Shows everyone near the tiles a skill covered, with the painted tile marker (world-marks.ts). */
function show(kit: EffectKit, cast: Cast, tiles: TileSpot[]): void {
  kit.s.shapes.push({ owner: cast.p.info.id, tiles, floor: cast.p.floor, until: kit.s.now() + SHAPE_SHOWN_MS });
}

/** Hits everything in front of you within range: toward the chosen or nearest creature, else the way you face. */
export const cone: Effect = {
  ready: (kit, cast) => (ahead(kit, cast, 'cone').length || rivalsAhead(kit, cast, 'cone').length ? undefined : 'Nothing in front of you to hit.'),
  run: (kit, cast) => {
    show(kit, cast, aheadTiles(kit, cast, 'cone'));
    for (const c of ahead(kit, cast, 'cone')) hitWith(kit, cast, c);
    for (const v of rivalsAhead(kit, cast, 'cone')) hitPlayerWith(kit, cast, v);
  },
};

/** Hits everything in a straight line ahead, within range. */
export const line: Effect = {
  ready: (kit, cast) => (ahead(kit, cast, 'line').length || rivalsAhead(kit, cast, 'line').length ? undefined : 'Nothing in line to hit.'),
  run: (kit, cast) => {
    show(kit, cast, aheadTiles(kit, cast, 'line'));
    for (const c of ahead(kit, cast, 'line')) hitWith(kit, cast, c);
    for (const v of rivalsAhead(kit, cast, 'line')) hitPlayerWith(kit, cast, v);
  },
};

/** Rival players standing on a tile a cone or line covers. */
function rivalsAhead(kit: EffectKit, cast: Cast, shape: 'cone' | 'line'): PlayerState[] {
  const covered = new Set(aheadTiles(kit, cast, shape).map((t) => `${t.tx},${t.ty}`));
  return kit.rivalsNear(cast.p, cast.p, cast.a.range).filter((v) => covered.has(`${Math.floor(v.x)},${Math.floor(v.y)}`));
}

/** The tiles a cone or line covers: a wedge or a row of tiles (shared tiles/shapes.ts), toward the chosen or nearest creature, else the way you face. */
function aheadTiles(kit: EffectKit, cast: Cast, shape: 'cone' | 'line'): TileSpot[] {
  const { p, a } = cast;
  const dir = towards(p, cast.target ?? aimAt(kit, cast));
  return shapeTiles(kit.s.map, { shape, from: anchorNear(p.x, p.y), dx: dir.dx, dy: dir.dy, range: a.range, floor: p.floor });
}

/** The creatures a cone or line covers: any tile of their square on one of its tiles (Stampede knocks back those its line covered). */
export function ahead(kit: EffectKit, cast: Cast, shape: 'cone' | 'line'): Creature[] {
  const { p, a } = cast;
  const covered = new Set(aheadTiles(kit, cast, shape).map((t) => `${t.tx},${t.ty}`));
  return kit.creaturesNear(p, p, a.range).filter((c) => {
    const width = c.width ?? SIZE_TILES[creatureSize(c.kind)];
    const at = anchorNear(c.x, c.y, width);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) if (covered.has(`${at.tx + x},${at.ty + y}`)) return true;
    return false;
  });
}
