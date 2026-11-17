import type { Creature } from '../state.ts';
import { aimAt, hitPlayerWith, hitWith, type Cast, type Effect, type EffectKit } from './types.ts';

/** A rival player chosen as the skill's target and in its range (region/pvp.ts). */
function rival(kit: EffectKit, cast: Cast) {
  return cast.targetId && kit.s.players.has(cast.targetId) ? kit.rivalInReach(cast.p, cast.a.range, cast.targetId) : undefined;
}

/** A chaining bolt jumps to the nearest creature this close to the last one it hit, this much weaker each jump. */
const CHAIN_REACH = 3;
const CHAIN_FADE = 0.8;

/** A blow of the weapon at the chosen creature in reach, or the nearest. */
export const strike: Effect = {
  ready: (kit, cast) => (rival(kit, cast) || aimAt(kit, cast) ? undefined : 'Nothing in reach to strike.'),
  run: (kit, cast) => {
    const v = rival(kit, cast);
    if (v) return hitPlayerWith(kit, cast, v);
    hitWith(kit, cast, cast.target!);
  },
};

/**
 * Something flung at one creature further off. A chaining bolt then jumps
 * from creature to creature, up to `chain` in all (twice as many Woven).
 */
export const bolt: Effect = {
  ready: (kit, cast) => (rival(kit, cast) || aimAt(kit, cast) ? undefined : `No creature within ${cast.a.range} steps.`),
  run: (kit, cast) => {
    const v = rival(kit, cast);
    if (v) return hitPlayerWith(kit, cast, v);
    const hit: Creature[] = [];
    const most = (cast.a.chain ?? 1) * (cast.woven && cast.a.chain ? 2 : 1);
    let next: Creature | undefined = cast.target!;
    while (next && hit.length < most) {
      hitWith(kit, cast, next, CHAIN_FADE ** hit.length);
      hit.push(next);
      next = kit.creaturesNear(cast.p, next, CHAIN_REACH).find((c) => !hit.includes(c));
    }
  },
};
