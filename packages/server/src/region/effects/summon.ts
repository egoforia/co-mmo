import { ABILITIES, abilityDamageType } from '@co-mmo/shared';
import type { Helper } from '../state.ts';
import type { Effect, EffectKit } from './types.ts';

/** A helper strikes this often, lasts this long, and looks this far around its owner when the skill does not say. */
const HELPER_EVERY_MS = 1200;
const HELPER_SECONDS = 20;
const HELPER_RADIUS = 5;

/**
 * Calls a helper that stays by you and strikes the nearest creature every
 * 1.2 s for the ability's amount, until its time runs out or you fall. One
 * of each at a time: calling it again starts it afresh. The spirit hawk
 * (Call Companion) is seen beside its owner (region/world-marks.ts).
 */
export const summon: Effect = {
  run: (kit, { p, id, a, amount, now }) => {
    const s = kit.s;
    s.helpers = s.helpers.filter((h) => !(h.owner === p.info.id && h.ability === id));
    const seconds = a.duration ?? HELPER_SECONDS;
    s.helpers.push({ owner: p.info.id, ability: id, amount, radius: a.radius ?? HELPER_RADIUS, until: now + seconds * 1000, nextAt: now + HELPER_EVERY_MS });
    s.notice(p, `${a.name} answers your call and fights beside you for ${seconds} seconds.`);
  },
};

/** Helpers strike when their turn comes; those whose owner fell or left, or whose time ran out, go. */
export function helpersAct(kit: EffectKit, now: number): void {
  const s = kit.s;
  if (!s.helpers.length) return;
  s.helpers = s.helpers.filter((h) => {
    const p = s.players.get(h.owner);
    if (!p || p.character.hp <= 0 || now >= h.until) return false;
    if (now >= h.nextAt) act(kit, h);
    return true;
  });
}

function act(kit: EffectKit, h: Helper): void {
  h.nextAt += HELPER_EVERY_MS;
  const p = kit.s.players.get(h.owner)!;
  const a = ABILITIES[h.ability];
  const c = kit.creatureInReach(p, h.radius);
  if (!a || !c) return;
  kit.strike(p, c, h.amount, { type: abilityDamageType(a), ability: h.ability });
}
