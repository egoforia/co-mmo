import { maxHp, pathNumbers } from '@co-mmo/shared';
import { hitWith } from '../effects/types.ts';
import type { PathRule } from './types.ts';

// The Warden's Paths (docs/classes/warden.md). Rooted Stand and Mountainfall
// are data alone; Rooted Stand's Armor and its guard against Stuns are asked
// for by the creatures' minds and statuses.ts, Barkskin and Retaliate are
// passives in paths/index.ts.

/** Oakheart's Last Knight and Stonefist's Quake Leap, where data is not enough. */
export const WARDEN_PATH_RULES: Record<string, PathRule> = {
  // Unyielding for 8 s (the buff's data), then a heal when it ends, if still standing.
  'last-knight': {
    run: (kit, cast, effect) => {
      effect.run(kit, cast);
      const { p, a, now } = cast;
      kit.paths.later(now + (a.duration ?? 8) * 1000, () => {
        const ch = p.character;
        if (!kit.s.players.has(p.info.id) || ch.hp <= 0) return;
        const healed = Math.min(maxHp(ch) - ch.hp, Math.round(maxHp(ch) * (pathNumbers('last-knight').share ?? 0)));
        ch.hp += healed;
        p.dirty = true;
        kit.s.notice(p, `${a.name} ends, and you recover ${healed} health.`);
      });
    },
  },
  // Leap at the creature (the dash), then the landing shakes everything else close by.
  'quake-leap': {
    run: (kit, cast, effect) => {
      effect.run(kit, cast);
      for (const c of kit.creaturesNear(cast.p, cast.p, cast.a.radius ?? 2)) if (c !== cast.target) hitWith(kit, cast, c);
    },
  },
};
