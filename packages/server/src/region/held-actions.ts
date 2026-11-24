// Attacks and skills that arrive a little before they are ready. A browser
// sends the next swing as its own clock says the last one has ended, and a
// home or mobile line delivers messages unevenly: one can land a few
// milliseconds early. Dropping it lost a third of held swings on Wi-Fi, after
// the browser had already shown them. Kept instead, it is done the moment it
// is ready (by a timer, or the next tick if that comes first), and an attack
// counts from when it was ready, so a held key keeps the Calling's full pace.

import type { PlayerState, RegionState } from './state.ts';

/** How early, ms, an attack or skill may arrive and still be kept: about a home or mobile line's wobble. */
export const EARLY_MS = 150;

/** An attack or skill kept until it is ready. */
export interface HeldAction {
  /** When it is ready, epoch ms. */
  at: number;
  target?: string;
  /** The skill, for a held skill. */
  ability?: string;
}

/** What to keep for an action asked for at `now` that is ready at `ready`: undefined when it is too early to keep. */
export function keepEarly(now: number, ready: number, target?: string, ability?: string): HeldAction | undefined {
  if (ready - now > EARLY_MS) return undefined;
  return { at: ready, ...(target !== undefined ? { target } : {}), ...(ability ? { ability } : {}) };
}

/** What does a held action: the combat module's attack and skill. */
export interface Doer {
  attack(p: PlayerState, targetId?: string, at?: number): void;
  useAbility(p: PlayerState, id: string, targetId?: string): void;
}

/** Does a player's kept attack and skill whose time has come (1 ms early is in time, as timers can be). */
export function doHeldOf(p: PlayerState, now: number, doer: Doer): void {
  const attack = p.heldAttack;
  if (attack && now >= attack.at - 1) {
    p.heldAttack = undefined;
    doer.attack(p, attack.target, attack.at);
  }
  const skill = p.heldAbility;
  if (skill?.ability && now >= skill.at - 1) {
    p.heldAbility = undefined;
    doer.useAbility(p, skill.ability, skill.target);
  }
}

/** Each tick: does every kept attack and skill whose time has come, in case its timer was late. */
export function doHeld(players: Iterable<PlayerState>, now: number, doer: Doer): void {
  for (const p of players) doHeldOf(p, now, doer);
}

/**
 * For an attack or skill asked for at `at` that is ready at `ready`: true when
 * it must wait. One a little early is kept in `slot` (a later one too early
 * leaves it be) and done when ready by a timer, so it is not left for the next
 * tick up to 50 ms later; a region on a test clock that has not moved does
 * nothing then, and its tick does it instead.
 */
export function holdEarly(
  s: Pick<RegionState, 'now' | 'players'>, doer: Doer, p: PlayerState, slot: 'heldAttack' | 'heldAbility',
  at: number, ready: number, target?: string, ability?: string,
): boolean {
  if (at >= ready - 1) return false;
  const kept = keepEarly(at, ready, target, ability);
  if (!kept) return true;
  p[slot] = kept;
  const timer = setTimeout(() => {
    if (s.players.get(p.info.id) === p) doHeldOf(p, s.now(), doer);
  }, Math.max(0, ready - s.now()));
  timer.unref?.();
  return true;
}
