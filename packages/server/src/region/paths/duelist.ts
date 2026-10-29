import { pathNumbers } from '@co-mmo/shared';
import { forget } from '../../creature-brain.ts';
import { afflictPlayer } from '../statuses.ts';
import { healthShare, weaponHit, type PathRule } from './types.ts';

// The Duelist's Paths (docs/classes/duelist.md). Blazing Edge and Thirsting
// Blade are passives in paths/index.ts; Hidden keeps creatures off you
// (Minds), and a Dune Tempest spin keeps Slows and Roots off (statuses.ts).

/** Sunblade's Execute and Sunfall Dance, Sandstorm's Mirage and Dune Tempest, where data is not enough. */
export const DUELIST_PATH_RULES: Record<string, PathRule> = {
  // Double damage to a creature near its end.
  execute: {
    run: (kit, cast, effect) => {
      const n = pathNumbers('execute');
      if (cast.target && healthShare(cast.target) < (n.below ?? 0)) cast.amount *= n.times ?? 1;
      effect.run(kit, cast);
    },
  },
  // Dash to the first creature, then strike again and again, each time at the creature nearby struck least lately.
  'sunfall-dance': {
    run: (kit, cast) => {
      const { p, a, now } = cast;
      const n = pathNumbers('sunfall-dance');
      const hits = n.hits ?? 5;
      const gap = ((n.seconds ?? 2) * 1000) / hits;
      afflictPlayer(kit.s, p, 'hidden', n.seconds ?? 2);
      const struck: string[] = [];
      for (let i = 0; i < hits; i++) {
        kit.paths.later(now + i * gap, () => {
          if (p.character.hp <= 0 || !kit.s.players.has(p.info.id)) return;
          const near = kit.creaturesNear(p, p, a.range);
          const c = near.find((x) => !struck.includes(x.id)) ?? near[0];
          if (!c) return;
          struck.push(c.id);
          if (struck.length >= near.length) struck.length = 0;
          kit.strike(p, c, kit.critical(p, weaponHit(p) * (n.weapon ?? 1)), { type: 'physical', ability: cast.id });
          kit.gauges.landed(p);
        });
      }
      kit.s.notice(p, `${a.name}: nothing can touch you while you dance.`);
    },
  },
  // Creatures close by lose you to the sand double, you are Hidden, and your next hit is critical.
  mirage: {
    run: (kit, cast) => {
      const { p, a, now } = cast;
      const id = p.info.id;
      const standing = (other: string) => other !== id && (kit.s.players.get(other)?.character.hp ?? 0) > 0;
      for (const c of kit.creaturesNear(p, p, a.radius ?? 5)) if (c.threat[id] !== undefined || c.aggro === id) forget(c, id, standing, now);
      afflictPlayer(kit.s, p, 'hidden', pathNumbers('mirage').hidden);
      kit.paths.ambush(p);
      kit.s.notice(p, `${a.name}: a double of sand takes your place, and you slip from sight.`);
    },
  },
  // Spin as you move: every half second, everything around you is hit.
  'dune-tempest': {
    run: (kit, cast) => {
      const { p, a, now } = cast;
      const n = pathNumbers('dune-tempest');
      const seconds = n.seconds ?? 4;
      const every = (n.every ?? 0.5) * 1000;
      p.steadfastUntil = now + seconds * 1000;
      p.statuses = p.statuses.filter((s) => s.id !== 'slowed' && s.id !== 'rooted');
      for (let at = 0; at < seconds * 1000; at += every) {
        kit.paths.later(now + at, () => {
          if (p.character.hp <= 0 || !kit.s.players.has(p.info.id)) return;
          for (const c of kit.creaturesNear(p, p, a.radius ?? 2)) {
            kit.strike(p, c, kit.critical(p, weaponHit(p) * (n.weapon ?? 1)), { type: 'physical', ability: cast.id });
            kit.gauges.landed(p);
          }
        });
      }
      kit.s.notice(p, `${a.name}: you spin for ${seconds} seconds.`);
    },
  },
};
