// The signature gauges (docs/classes.md, Signature gauges): each Calling's
// gauge of up to five pips, and the numbers that fill, empty and spend it.
// The server keeps the pips (region/gauges.ts); the client shows them under
// the health bar. Re-exported from rpg.ts.

import { CALLINGS, type CallingId } from '../classes.ts';
import type { AbilityDef, Thread } from './abilities.ts';

/** The five gauges, one per Calling. */
export type GaugeId = 'resolve' | 'momentum' | 'focus' | 'weave' | 'echo';

/** The most pips a gauge holds. */
export const GAUGE_MAX = 5;

/** Energy each new pip gives: Resolve 2, Momentum and Focus 1; Weave and Echo none. */
export const GAUGE_ENERGY: Record<GaugeId, number> = { resolve: 2, momentum: 1, focus: 1, weave: 0, echo: 0 };

/** Resolve starts emptying this long after the Warden's last fight, one pip per RESOLVE_FADE_MS. */
export const RESOLVE_CALM_MS = 5000;
export const RESOLVE_FADE_MS = 2000;

/** Momentum empties after this long without a hit landing. */
export const MOMENTUM_FADE_MS = 6000;

/** Focus grows one pip per this long standing still and unhit. */
export const FOCUS_STEP_MS = 1000;

/** Extra crit chance per Focus pip. */
export const FOCUS_CRIT = 0.05;

/** At this many Weave pips the next spell is Woven, and a Woven spell's amount is multiplied by WOVEN_FACTOR. */
export const WOVEN_AT = 3;
export const WOVEN_FACTOR = 2;

/** How long an Echo stays on an ally, and the share of its heal a Toll repeats. */
export const ECHO_MS = 20_000;
export const ECHO_SHARE = 0.5;

/** A finisher's extra amount per pip it spends, when the skill does not say (Execute's +20%). */
export const FINISHER_PER_PIP = 0.2;

/** The gauge a Calling fills, if it has one. */
export function gaugeOf(calling: CallingId | undefined): GaugeId | undefined {
  return calling ? CALLINGS[calling].gauge.id : undefined;
}

/** The gauge's name as players read it. */
export function gaugeName(id: GaugeId): string {
  return Object.values(CALLINGS).find((c) => c.gauge.id === id)!.gauge.name;
}

/** How much a finisher's amount grows for the pips it spends (Whirl +25%, Bulwark +50% per pip). */
export function finisherFactor(a: Pick<AbilityDef, 'perPip'>, pips: number): number {
  return 1 + (a.perPip ?? FINISHER_PER_PIP) * pips;
}

/** Weave after casting a spell: +1 for a thread different from the last one, nothing for the same thread twice. */
export function weaveAfter(pips: number, last: Thread | undefined, thread: Thread): number {
  return thread === last ? pips : Math.min(GAUGE_MAX, pips + 1);
}
