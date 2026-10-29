import { collides, pathNumbers } from '@co-mmo/shared';
import { ahead } from '../effects/areas.ts';
import { hitWith, towards } from '../effects/types.ts';
import { spotFor, weaponHit, type PathRule } from './types.ts';

// The Ranger's Paths (docs/classes/ranger.md). Piercing Arrow is data alone;
// Steady Breath and Pack Instinct are passives in paths/index.ts. The spirit
// hawk is a summoned helper: its picture is painted in build plan step 10
// and never drawn in code; until then it is heard of, not seen.

/** Steps a knockback moves a creature at a time, stopping before anything solid. */
const PUSH_STEP = 0.25;
/** The hawk stays until sent home; this is only so a forgotten one cannot live for ever. */
const HAWK_SECONDS = 3600;

/** Windeye's Skyfall Arrow and Wildkin's Call Companion and Stampede, where data is not enough. */
export const RANGER_PATH_RULES: Record<string, PathRule> = {
  // Draw, then the great arrow falls where the creature stood when you loosed it.
  'skyfall-arrow': {
    run: (kit, cast) => {
      const { p, a, now } = cast;
      const spot = spotFor(kit, cast);
      kit.paths.later(now + (pathNumbers('skyfall-arrow').seconds ?? 1.5) * 1000, () => {
        if (p.character.hp <= 0 || !kit.s.players.has(p.info.id)) return;
        for (const c of kit.creaturesNear(p, spot, a.radius ?? 3)) hitWith(kit, cast, c);
      });
      kit.s.notice(p, `You draw ${a.name}...`);
    },
  },
  // The spirit hawk: called once, it fights until sent home (using the skill again, at no cost).
  'call-companion': {
    again: (kit, p, id) => {
      const hawk = kit.s.helpers.find((h) => h.owner === p.info.id && h.ability === id);
      if (!hawk) return undefined;
      kit.s.helpers.splice(kit.s.helpers.indexOf(hawk), 1);
      return 'Your spirit hawk flies home.';
    },
    run: (kit, { p, id, a, now }) => {
      const n = pathNumbers('call-companion');
      const every = (n.every ?? 1.2) * 1000;
      kit.s.helpers.push({ owner: p.info.id, ability: id, amount: weaponHit(p) * (n.weapon ?? 0), radius: a.radius ?? 6, until: now + HAWK_SECONDS * 1000, nextAt: now + every });
      kit.s.notice(p, 'A spirit hawk answers your call and fights beside you. Use Call Companion again to send it home.');
    },
  },
  // The herd runs the line (the data's hits and Slow), and knocks each creature back.
  stampede: {
    run: (kit, cast, effect) => {
      const { p } = cast;
      const hit = ahead(kit, cast, 'line');
      effect.run(kit, cast);
      const push = pathNumbers('stampede').push ?? 2;
      for (const c of hit) {
        if (c.respawnAt !== null) continue;
        // Away from you; a creature right on top of you goes the way you face.
        const way = towards(p, c);
        for (let gone = 0; gone + PUSH_STEP <= push; gone += PUSH_STEP) {
          const x = c.x + way.dx * PUSH_STEP;
          const y = c.y + way.dy * PUSH_STEP;
          if (collides(kit.s.map, x, y, c.floor)) break;
          c.x = x;
          c.y = y;
        }
      }
    },
  },
};
