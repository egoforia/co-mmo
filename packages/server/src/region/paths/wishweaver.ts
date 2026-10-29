import { GAUGE_MAX, STATUSES, cleanse, knowsPassive, maxEnergy, pathNumbers } from '@co-mmo/shared';
import { mend } from '../effects/support.ts';
import { allyFor, hitWith } from '../effects/types.ts';
import { spotFor, type PathRule } from './types.ts';

// The Wishweaver's Paths (docs/classes/wishweaver.md). Overflow and Loose
// Ends are passives in paths/index.ts. All their damage is arcane.

/** Stormcaller's Firestorm and Starfall, Threadbinder's Unravel and Rewrite, where data is not enough. */
export const WISHWEAVER_PATH_RULES: Record<string, PathRule> = {
  // Fire rains on the spot once a second, setting what is inside Burning.
  firestorm: {
    run: (kit, cast) => {
      const { p, a, now } = cast;
      const spot = spotFor(kit, cast);
      const seconds = pathNumbers('firestorm').seconds ?? 5;
      for (let i = 0; i < seconds; i++) {
        kit.paths.later(now + i * 1000, () => {
          if (p.character.hp <= 0 || !kit.s.players.has(p.info.id)) return;
          for (const c of kit.creaturesNear(p, spot, a.radius ?? 3)) hitWith(kit, cast, c);
        });
      }
    },
  },
  // Always Woven (doubled), stars falling over 3 seconds; it leaves the Weave at 3, ready for the next.
  starfall: {
    run: (kit, cast) => {
      const { p, a, now } = cast;
      const n = pathNumbers('starfall');
      const spot = spotFor(kit, cast);
      const hits = n.hits ?? 6;
      const woven = { ...cast, amount: cast.amount * 2, woven: true };
      for (let i = 0; i < hits; i++) {
        kit.paths.later(now + (i * (n.seconds ?? 3) * 1000) / hits, () => {
          if (p.character.hp <= 0 || !kit.s.players.has(p.info.id)) return;
          for (const c of kit.creaturesNear(p, spot, a.radius ?? 4)) hitWith(kit, woven, c);
        });
      }
      const g = kit.gauges.of(p);
      if (g?.id === 'weave') g.pips = Math.min(GAUGE_MAX, Math.max(g.pips, n.weave ?? 3));
      // Starfall is Woven, so Overflow gives its Energy back.
      if (knowsPassive(p.character, 'overflow')) p.character.energy = Math.min(maxEnergy(p.character), p.character.energy + a.energy);
      kit.s.notice(p, `${a.name}: the stars fall, woven of all three threads.`);
    },
  },
  // Hurt it, tear away its shields and anything else that helps it, and Silence it.
  unravel: {
    run: (kit, cast) => {
      const c = cast.target!;
      c.statuses = c.statuses.filter((s) => STATUSES[s.id].harmful);
      hitWith(kit, cast, c);
      if (c.respawnAt === null) kit.s.notice(cast.p, `${c.def.name} comes unravelled: ${STATUSES.silenced.name}.`);
    },
  },
  // On a creature: it takes back what it dealt in the last 3 s. On a friend: what they took is healed and their ailments go.
  rewrite: {
    ready: (kit, cast) => {
      const { p, a, targetId, now } = cast;
      const seconds = pathNumbers('rewrite').seconds ?? 3;
      const c = targetId ? kit.creatureInReach(p, a.range, targetId) : undefined;
      if (c) {
        cast.target = c;
        return kit.paths.recent({ by: c.id }, seconds, now) > 0 ? undefined : `${c.def.name} has dealt no damage in the last ${seconds} seconds.`;
      }
      const m = allyFor(kit, cast);
      return kit.paths.recent({ victim: m.info.id }, seconds, now) > 0 ? undefined : `There is nothing to undo from the last ${seconds} seconds.`;
    },
    run: (kit, cast) => {
      const { p, a, now } = cast;
      const seconds = pathNumbers('rewrite').seconds ?? 3;
      if (cast.target) {
        const c = cast.target;
        kit.strike(p, c, kit.paths.recent({ by: c.id }, seconds, now), { type: 'arcane', ability: cast.id, pierce: true });
        return kit.s.notice(p, `${a.name}: ${c.def.name} takes back every blow it dealt.`);
      }
      const m = allyFor(kit, cast);
      const healed = mend(kit, p, m, kit.paths.recent({ victim: m.info.id }, seconds, now));
      cleanse(m);
      kit.paths.rewritten(m.info.id);
      kit.s.notice(p, m === p ? `${a.name} undoes the last ${seconds} seconds: +${healed} health.` : `${a.name} undoes ${m.info.name}'s last ${seconds} seconds: +${healed} health.`);
      if (m !== p) kit.s.notice(m, `${p.info.name}'s ${a.name} undoes your last ${seconds} seconds: +${healed} health.`);
    },
  },
};
