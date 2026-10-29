import type { Creature } from '../state.ts';
import { aimAt, hitWith, towards, type Cast, type Effect, type EffectKit } from './types.ts';

/** How wide a cone opens either side of where it points, and how wide a line is. */
const CONE_HALF_ANGLE = Math.PI / 4;
const LINE_HALF_WIDTH = 0.6;
/** Tiles an area covers when the skill does not say. */
const AREA_RADIUS = 2;

/**
 * Hits everything within the radius around the chosen creature (when it is
 * within range: "at a spot"), or around you.
 */
export const area: Effect = {
  ready: (kit, cast) => (inArea(kit, cast).length ? undefined : 'Nothing close enough to hit.'),
  run: (kit, cast) => {
    for (const c of inArea(kit, cast)) hitWith(kit, cast, c);
  },
};

function inArea(kit: EffectKit, cast: Cast): Creature[] {
  const { p, a, targetId } = cast;
  const at = (targetId && a.range > 0 ? kit.creatureInReach(p, a.range, targetId) : undefined) ?? p;
  return kit.creaturesNear(p, at, a.radius ?? AREA_RADIUS);
}

/** Hits everything in front of you within range: toward the chosen or nearest creature, else the way you face. */
export const cone: Effect = {
  ready: (kit, cast) => (ahead(kit, cast, 'cone').length ? undefined : 'Nothing in front of you to hit.'),
  run: (kit, cast) => {
    for (const c of ahead(kit, cast, 'cone')) hitWith(kit, cast, c);
  },
};

/** Hits everything in a straight line ahead, within range. */
export const line: Effect = {
  ready: (kit, cast) => (ahead(kit, cast, 'line').length ? undefined : 'Nothing in line to hit.'),
  run: (kit, cast) => {
    for (const c of ahead(kit, cast, 'line')) hitWith(kit, cast, c);
  },
};

/** The creatures a cone or line covers (Stampede knocks back those its line covered). */
export function ahead(kit: EffectKit, cast: Cast, shape: 'cone' | 'line'): Creature[] {
  const { p, a } = cast;
  const dir = towards(p, cast.target ?? aimAt(kit, cast));
  return kit.creaturesNear(p, p, a.range).filter((c) => {
    const x = c.x - p.x;
    const y = c.y - p.y;
    const along = x * dir.dx + y * dir.dy;
    if (along <= 0) return Math.hypot(x, y) < 0.3;
    const across = Math.abs(x * dir.dy - y * dir.dx);
    return shape === 'line' ? across <= LINE_HALF_WIDTH : Math.atan2(across, along) <= CONE_HALF_ANGLE;
  });
}
