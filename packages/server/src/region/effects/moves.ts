import { collides, paceOf } from '@co-mmo/shared';
import type { PlayerState, RegionState } from '../state.ts';
import { afflictPlayer } from '../statuses.ts';
import { aimAt, hitWith, towards, type Cast, type EffectKit, type Effect } from './types.ts';

/** Dashes and blinks move in steps this long, stopping before anything solid. */
const STEP = 0.25;
/** A dash stops this close to its creature, in striking reach. */
const DASH_STOP = 1;

/** Runs to the chosen or nearest creature within range and strikes it. */
export const dash: Effect = {
  ready: (kit, cast) => {
    if (!paceOf(cast.p, cast.now)) return 'You cannot move right now.';
    return aimAt(kit, cast) ? undefined : `No creature within ${cast.a.range} steps.`;
  },
  run: (kit, cast) => {
    const { p } = cast;
    const c = cast.target!;
    const dir = towards(p, c);
    slide(kit.s, p, dir, Math.max(0, Math.hypot(c.x - p.x, c.y - p.y) - DASH_STOP));
    hitWith(kit, cast, c);
  },
};

/**
 * Vanishes and appears up to the ability's range away, the way you face (or
 * toward the creature you chose; away from it or to one side for a skill
 * that says `away`); with a radius, a gust hits what stood around the spot
 * you left. Its status, if any, is on you after.
 */
export const blink: Effect = {
  ready: (_kit, cast) => (paceOf(cast.p, cast.now) ? undefined : 'You cannot move right now.'),
  run: (kit, cast) => {
    const { p, a } = cast;
    const from = { x: p.x, y: p.y };
    slide(kit.s, p, blinkWay(kit, cast), a.range);
    if (a.radius) for (const c of kit.creaturesNear(p, from, a.radius)) hitWith(kit, cast, c);
    if (a.status) afflictPlayer(kit.s, p, a.status, a.duration);
    kit.s.notice(p, `${a.name} carries you ${Math.round(Math.hypot(p.x - from.x, p.y - from.y))} steps.`);
  },
};

/** Which way a blink goes: toward the chosen creature, or away from (or beside) the chosen or nearest one. */
function blinkWay(kit: EffectKit, cast: Cast): { dx: number; dy: number } {
  const { p, a } = cast;
  const reach = a.range + 2;
  const chosen = cast.targetId ? kit.creatureInReach(p, reach, cast.targetId) : undefined;
  if (!a.away) return towards(p, chosen);
  const to = towards(p, chosen ?? kit.creatureInReach(p, reach));
  return a.away === 'back' ? { dx: -to.dx, dy: -to.dy } : { dx: -to.dy, dy: to.dx };
}

/** Moves a player up to `distance` along a direction, stopping before anything solid. */
export function slide(s: RegionState, p: PlayerState, dir: { dx: number; dy: number }, distance: number): void {
  for (let gone = 0; gone + STEP <= distance + 1e-9; gone += STEP) {
    const x = p.x + dir.dx * STEP;
    const y = p.y + dir.dy * STEP;
    if (collides(s.map, x, y, p.floor)) break;
    p.x = x;
    p.y = y;
  }
}
