// What a gathering spot looks like to one player (gathering.ts). A spot is
// Ready until they gather from it, then Picked (bare) for the first part of
// its regrow time, then Growing until it is Ready again. Each player has
// their own timers, kept on their character so a restart or a move between
// region servers keeps them, and nobody else's view of the spot changes.
// A state shows its own picture (`spot-<kind>-picked`, `spot-<kind>-growing`)
// once painted; until then the spot keeps its Ready picture, since nothing is
// drawn in code. A wish may add states by adding to SPOT_STATES.

import { REGROW_MS, SPOTS } from './gathering.ts';
import type { Character } from './rpg.ts';

/** How a spot stands for one player. */
export type SpotState = 'ready' | 'picked' | 'growing';

/** The states in order, each from the share of the regrow time still to go at which it starts. */
export const SPOT_STATES: { id: SpotState; name: string; left: number }[] = [
  { id: 'picked', name: 'Picked', left: 1 },
  { id: 'growing', name: 'Growing', left: 0.5 },
];

/** A spot's timer key on a character: spot ids are only unique within a land. */
export function regrowKey(region: string, spot: string): string {
  return `${region}:${spot}`;
}

/** When the spot grows back for this character, if it has not yet. */
export function readyAt(c: Pick<Character, 'regrow'>, region: string, spot: string, now: number): number | undefined {
  const at = c.regrow?.[regrowKey(region, spot)];
  return at !== undefined && at > now ? at : undefined;
}

/** The state a spot shows at `now` when it grows back at `ready` (none: Ready). */
export function spotState(ready: number | undefined, now: number, regrowMs = REGROW_MS): SpotState {
  if (ready === undefined || now >= ready) return 'ready';
  const left = (ready - now) / regrowMs;
  let state: SpotState = SPOT_STATES[0]!.id;
  for (const s of SPOT_STATES) if (left <= s.left) state = s.id;
  return state;
}

/** The picture for a spot in a state: its own for Ready, `<art>-<state>` for the others. */
export function spotStateArt(kind: string, state: SpotState): string | undefined {
  const art = SPOTS[kind]?.art;
  return art && state !== 'ready' ? `${art}-${state}` : art;
}

/** Notes that the spot grows back at `at`, letting go of timers that have passed. */
export function setRegrow(c: Pick<Character, 'regrow'>, region: string, spot: string, at: number, now: number): void {
  const kept = Object.entries(c.regrow ?? {}).filter(([, t]) => t > now);
  c.regrow = Object.fromEntries([...kept, [regrowKey(region, spot), at]]);
}

/** "Grows back in about 3 minutes", or "Ready to gather". */
export function growsBackWords(ready: number | undefined, now: number): string {
  if (ready === undefined || now >= ready) return 'Ready to gather';
  const minutes = Math.ceil((ready - now) / 60_000);
  return `Grows back in about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}
