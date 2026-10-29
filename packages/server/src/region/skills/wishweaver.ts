import { collides, statusOf, type RegionMap } from '@co-mmo/shared';
import { addStatus, allyFor, towards } from '../effects/types.ts';
import { afflictPlayer } from '../statuses.ts';
import type { Creature, PlayerState } from '../state.ts';
import type { SkillRule } from './types.ts';

/** Tide Lash pushes creatures this far; a Woven Ember Bolt's burn spreads this far; a Woven Wish Ward covers this far round its ally. */
const LASH_PUSH = 2;
const SPREAD_REACH = 3;
const WARD_SPREAD = 3;
/** Knockback moves in steps this long, stopping before anything solid. */
const STEP = 0.25;

/**
 * The Wishweaver's spells (docs/classes/wishweaver.md) and what each does
 * Woven, on top of the doubled amount the Weave gives (region/gauges.ts).
 */
export const WISHWEAVER_RULES: Record<string, SkillRule> = {
  'ember-bolt': {
    run: (kit, cast, effect) => {
      effect.run(kit, cast);
      if (!cast.woven || !cast.target) return;
      const next = kit.creaturesNear(cast.p, cast.target, SPREAD_REACH).find((c) => c !== cast.target);
      if (next) addStatus(kit, cast, next);
    },
  },
  'tide-lash': {
    // Woven, it Roots instead of Slowing.
    run: (kit, cast, effect) => {
      const status = cast.woven ? 'rooted' as const : cast.a.status!;
      effect.run(kit, { ...cast, a: { ...cast.a, status } });
      // What the lash caught carries its status from this player: those are knocked back.
      for (const c of kit.creaturesNear(cast.p, cast.p, cast.a.range + 0.5)) {
        if (statusOf(c, status, cast.now)?.by === cast.p.info.id) push(kit.s.map, cast.p, c, LASH_PUSH);
      }
    },
  },
  'gale-step': {
    run: (kit, cast, effect) => {
      effect.run(kit, cast);
      if (cast.woven) effect.run(kit, cast);
    },
  },
  'wish-ward': {
    run: (kit, cast, effect) => {
      if (!cast.woven) return effect.run(kit, cast);
      const { p, a } = cast;
      const ally = allyFor(kit, cast);
      const near = kit.partyNear(p, a.range + WARD_SPREAD).filter((m) => m.floor === ally.floor && Math.hypot(m.x - ally.x, m.y - ally.y) <= WARD_SPREAD);
      for (const m of near) {
        afflictPlayer(kit.s, m, 'shielded', a.duration, { by: p.info.id, amount: Math.round(cast.amount) });
        if (m !== p) kit.s.notice(m, `${p.info.name}'s Woven ${a.name} shields you.`);
      }
      kit.s.notice(p, `Woven ${a.name} shields ${near.length === 1 ? 'one' : near.length}.`);
    },
  },
};

/** Knocks a creature back from the player, stopping before anything solid. */
function push(map: RegionMap, p: PlayerState, c: Creature, distance: number): void {
  const dir = towards(p, c);
  for (let gone = 0; gone + STEP <= distance + 1e-9; gone += STEP) {
    const x = c.x + dir.dx * STEP;
    const y = c.y + dir.dy * STEP;
    if (collides(map, x, y, c.floor)) break;
    c.x = x;
    c.y = y;
  }
}
