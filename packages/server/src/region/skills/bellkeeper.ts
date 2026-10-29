import { maxHp } from '@co-mmo/shared';
import { hitWith, type Cast, type EffectKit } from '../effects/types.ts';
import { mend } from '../effects/support.ts';
import { afflictPlayer } from '../statuses.ts';
import type { PlayerState, Zone } from '../state.ts';
import type { SkillRule } from './types.ts';

/** Sanctuary heals each this often, and spares those inside this share of each blow, in percent. */
const SANCTUARY_EVERY_MS = 1000;
const SANCTUARY_GUARD = 10;
/** Peal of Waking raises a Fallen ally with this share of their health. */
const PEAL_RAISE = 0.25;

/** The Bellkeeper's skills (docs/classes/bellkeeper.md) where data is not enough. */
export const BELLKEEPER_RULES: Record<string, SkillRule> = {
  // Chime heals friends around you (leaving Echoes) as well as hurting creatures.
  chime: {
    ready: (kit, cast) => (chimed(kit, cast).length || kit.creaturesNear(cast.p, cast.p, cast.a.radius ?? 0).length ? undefined : 'No one near enough needs the bell.'),
    run: (kit, cast) => {
      for (const c of kit.creaturesNear(cast.p, cast.p, cast.a.radius ?? 0)) hitWith(kit, cast, c);
      const healed = chimed(kit, cast).map((m) => mend(kit, cast.p, m, cast.amount)).reduce((a, b) => a + b, 0);
      if (healed) kit.s.notice(cast.p, `${cast.a.name} restores ${healed} health.`);
    },
  },
  sanctuary: {
    ready: () => undefined,
    run: (kit, { p, id, a, amount, now, targetId }) => {
      const chosen = targetId ? kit.s.players.get(targetId) ?? kit.creatureInReach(p, a.range, targetId) : undefined;
      const near = chosen && chosen.floor === p.floor && Math.hypot(chosen.x - p.x, chosen.y - p.y) <= a.range;
      const at = near ? chosen : p;
      kit.s.zones = kit.s.zones.filter((z) => !(z.owner === p.info.id && z.ability === id));
      kit.s.zones.push({ owner: p.info.id, ability: id, x: at.x, y: at.y, floor: p.floor, radius: a.radius ?? 0, amount, until: now + (a.duration ?? 0) * 1000, nextAt: now });
      kit.s.notice(p, `You hallow the ground: a ${a.name} for ${a.duration} seconds.`);
    },
  },
  'peal-of-waking': {
    run: (kit, cast, effect) => {
      const { p, a } = cast;
      effect.run(kit, cast);
      for (const m of kit.partyNear(p, a.radius ?? 0)) afflictPlayer(kit.s, m, 'hallowed', a.duration, { by: p.info.id });
      const fallen = [...kit.s.players.values()]
        .filter((m) => m !== p && m.fallenUntil !== undefined && m.floor === p.floor && Math.hypot(m.x - p.x, m.y - p.y) <= (a.radius ?? 0))
        .sort((x, y) => Math.hypot(x.x - p.x, x.y - p.y) - Math.hypot(y.x - p.x, y.y - p.y))[0];
      if (fallen) kit.raise(fallen, PEAL_RAISE, p);
    },
  },
};

/** Hurt party members on their feet within the skill's radius of the Bellkeeper. */
function chimed(kit: EffectKit, cast: Cast): PlayerState[] {
  return kit.partyNear(cast.p, cast.a.radius ?? 0).filter((m) => m.character.hp < maxHp(m.character));
}

/** Each tick: Sanctuaries heal the party of whoever hallowed them and guard those inside, until they fade. */
export function tendSanctuaries(kit: EffectKit, now: number): void {
  const s = kit.s;
  if (!s.zones.length) return;
  s.zones = s.zones.filter((z) => now < z.until && s.players.has(z.owner));
  for (const z of s.zones) {
    if (now < z.nextAt) continue;
    z.nextAt += SANCTUARY_EVERY_MS;
    tend(kit, z);
  }
}

function tend(kit: EffectKit, z: Zone): void {
  const p = kit.s.players.get(z.owner)!;
  for (const m of kit.partyNear(p, Infinity)) {
    if (m.floor !== z.floor || Math.hypot(m.x - z.x, m.y - z.y) > z.radius) continue;
    afflictPlayer(kit.s, m, 'guarded', SANCTUARY_EVERY_MS / 1000 + 0.1, { by: p.info.id, amount: SANCTUARY_GUARD });
    mend(kit, p, m, z.amount);
  }
}
