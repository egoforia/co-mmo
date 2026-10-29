import { maxHp, pathNumbers, statusOf } from '@co-mmo/shared';
import { mend } from '../effects/support.ts';
import { allyFor, hitWith } from '../effects/types.ts';
import type { PlayerState } from '../state.ts';
import { afflictPlayer } from '../statuses.ts';
import { spotFor, type PathRule } from './types.ts';

// The Bellkeeper's Paths (docs/classes/bellkeeper.md). Knell is data (its
// status is read by combat and the creatures' minds); Overtone and Iron Psalm
// are passives in paths/index.ts.

/** Dawnbell's Grace and Great Bell of Waking, Dirgebell's Final Knell, where data is not enough. */
export const BELLKEEPER_PATH_RULES: Record<string, PathRule> = {
  // A heal over time on one friend (Graced; paths/index.ts heals each tick), leaving an Echo of the whole of it.
  grace: {
    ready: (kit, cast) => {
      const m = allyFor(kit, cast);
      const own = statusOf(m, 'graced', cast.now);
      if (own?.by === cast.p.info.id) return m === cast.p ? 'Your Grace is still with you.' : `Your Grace is still with ${m.info.name}.`;
      return m.character.hp < maxHp(m.character) ? undefined : m === cast.p ? 'You are already at full health.' : `${m.info.name} is already at full health.`;
    },
    run: (kit, cast) => {
      const { p, a, amount } = cast;
      const m = allyFor(kit, cast);
      const seconds = a.duration ?? 10;
      const each = Math.max(1, Math.round(amount));
      afflictPlayer(kit.s, m, 'graced', seconds, { by: p.info.id, amount: each });
      kit.gauges.healed(p, m, each * seconds);
      kit.s.notice(p, m === p ? `${a.name} settles on you.` : `${a.name} settles on ${m.info.name}.`);
      if (m !== p) kit.s.notice(m, `${p.info.name}'s ${a.name} settles on you: you heal a little each second.`);
    },
  },
  // Every friend close by is healed, and every Fallen friend close by rises at half health.
  'great-bell-of-waking': {
    ready: () => undefined,
    run: (kit, cast) => {
      const { p, a, amount } = cast;
      const radius = a.radius ?? 8;
      let healed = 0;
      for (const m of kit.partyNear(p, radius)) {
        if (mend(kit, p, m, amount)) healed++;
      }
      let raised = 0;
      for (const m of fallenNear(kit.s.hooks.party?.(p.info.id) ?? [p.info.id], kit.s.players, p, radius)) {
        if (kit.raise(m, pathNumbers('great-bell-of-waking').raise ?? 0.5, p)) raised++;
      }
      kit.s.notice(p, `${a.name} rings out: ${healed} healed${raised ? `, ${raised} raised` : ''}.`);
    },
  },
  // Ring every Echo first (healing as Toll does), then the knell falls, stronger for each Echo rung.
  'final-knell': {
    run: (kit, cast) => {
      const { p, a } = cast;
      const spot = spotFor(kit, cast);
      const rung = kit.gauges.toll(p, a);
      const knell = { ...cast, amount: cast.amount * (1 + (pathNumbers('final-knell').perEcho ?? 0) * rung) };
      for (const c of kit.creaturesNear(p, spot, a.radius ?? 3)) hitWith(kit, knell, c);
      if (rung) kit.s.notice(p, `${a.name} rings ${rung === 1 ? 'one Echo' : `${rung} Echoes`} before it falls.`);
    },
  },
};

/** Party members lying Fallen on the player's floor within `radius`. */
function fallenNear(party: string[], players: Map<string, PlayerState>, p: PlayerState, radius: number): PlayerState[] {
  return party
    .map((id) => players.get(id))
    .filter((m): m is PlayerState => !!m && m.fallenUntil !== undefined && m.floor === p.floor && Math.hypot(m.x - p.x, m.y - p.y) <= radius);
}
