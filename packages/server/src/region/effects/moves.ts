import { collides, paceOf } from '@co-mmo/shared';
import type { PlayerState, RegionState } from '../state.ts';
import { aimAt, hitWith, towards, type Effect } from './types.ts';

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
 * toward the creature you chose); with a radius, a gust hits what stood
 * around the spot you left.
 */
export const blink: Effect = {
  ready: (_kit, cast) => (paceOf(cast.p, cast.now) ? undefined : 'You cannot move right now.'),
  run: (kit, cast) => {
    const { p, a } = cast;
    const from = { x: p.x, y: p.y };
    const chosen = cast.targetId ? kit.creatureInReach(p, a.range + 2, cast.targetId) : undefined;
    slide(kit.s, p, towards(p, chosen), a.range);
    if (a.radius) for (const c of kit.creaturesNear(p, from, a.radius)) hitWith(kit, cast, c);
    kit.s.notice(p, `${a.name} carries you ${Math.round(Math.hypot(p.x - from.x, p.y - from.y))} steps.`);
  },
};

/** Moves a player up to `distance` along a direction, stopping before anything solid. */
function slide(s: RegionState, p: PlayerState, dir: { dx: number; dy: number }, distance: number): void {
  for (let gone = 0; gone + STEP <= distance + 1e-9; gone += STEP) {
    const x = p.x + dir.dx * STEP;
    const y = p.y + dir.dy * STEP;
    if (collides(s.map, x, y, p.floor)) break;
    p.x = x;
    p.y = y;
  }
}
