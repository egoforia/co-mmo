import { ABILITIES, TICK_SECONDS, statusOf } from '@co-mmo/shared';
import type { PlayerState } from '../state.ts';
import { afflictPlayer } from '../statuses.ts';
import type { Effect, EffectKit } from './types.ts';

/** A stance's status is renewed this far ahead each tick, so it ends soon after the stance does. */
const HOLD_SECONDS = 1;

/**
 * Takes up a stance: on until used again or Energy runs out, draining the
 * ability's Energy each second and keeping its status (if any) on you.
 * Using it again while on is handled by Combat, which calls endStance.
 */
export const stance: Effect = {
  run: (kit, { p, id, a, amount }) => {
    if (p.stance) endStance(kit, p);
    p.stance = { ability: id, amount: Math.round(amount) };
    hold(kit, p, true);
    kit.s.notice(p, `You take up ${a.name}. Use it again to leave it.`);
  },
};

/** Leaves the stance held, saying why when there is a reason. */
export function endStance(kit: EffectKit, p: PlayerState, why?: string): void {
  const a = p.stance && ABILITIES[p.stance.ability];
  p.stance = undefined;
  if (a) kit.s.notice(p, why ? `${why}: you leave ${a.name}.` : `You leave ${a.name}.`);
}

/** Stances drain Energy each tick and keep their status on; they end at 0 HP or when Energy runs out. */
export function holdStances(kit: EffectKit): void {
  for (const p of kit.s.players.values()) {
    if (!p.stance) continue;
    const a = ABILITIES[p.stance.ability];
    const drain = (a?.energy ?? 0) * TICK_SECONDS;
    if (!a || p.character.hp <= 0) {
      p.stance = undefined;
      continue;
    }
    if (p.character.energy < drain) {
      endStance(kit, p, 'Out of Energy');
      continue;
    }
    p.character.energy -= drain;
    hold(kit, p);
  }
}

/**
 * Keeps the stance's status on. A shield is raised once, when the stance is
 * taken up, and then only kept while it lasts: once broken it stays broken.
 */
function hold(kit: EffectKit, p: PlayerState, first = false): void {
  const a = ABILITIES[p.stance!.ability];
  if (!a?.status) return;
  if (a.status !== 'shielded') return void afflictPlayer(kit.s, p, a.status, HOLD_SECONDS);
  if (first) afflictPlayer(kit.s, p, 'shielded', HOLD_SECONDS, { amount: p.stance!.amount });
  else if (statusOf(p, 'shielded', kit.s.now())) afflictPlayer(kit.s, p, 'shielded', HOLD_SECONDS);
}
