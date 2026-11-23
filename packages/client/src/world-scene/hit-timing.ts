// When a strike is shown (docs/combat.md, Seeing a strike land).
//
// The server settles every strike the moment it happens, but others are
// drawn a little in the past (SnapshotClock), so a strike shown the moment
// its word arrives landed before its striker was seen to get there. A
// strike is held back until its striker is drawn at the moment it struck:
// creatures beside us hardly at all, as they are drawn near the present
// (near-present.ts), others a little longer, and never more than a quarter
// second, so a fight never feels slow. Our own strikes show at once. Only
// what is shown waits; the server has already settled it.

/** A strike is held back at most this long, ms. */
export const MOST_HELD_MS = 250;

/**
 * How long to hold back a strike, ms: the time between the moment it
 * struck (`struckAt`, server time) and the moment its striker is drawn at
 * (`drawnAt`); none for our own, or a striker not in view.
 */
export function holdFor(struckAt: number, drawnAt: number | undefined): number {
  if (drawnAt === undefined) return 0;
  return Math.max(0, Math.min(MOST_HELD_MS, struckAt - drawnAt));
}

/** Strikes on us held back and not yet shown: the health they take is not taken off what we show until they land. */
export class HeldHurt {
  private held = 0;

  /** A strike on us for `amount` is held back. */
  hold(amount: number): void {
    this.held += amount;
  }

  /** It landed. */
  land(amount: number): void {
    this.held = Math.max(0, this.held - amount);
  }

  /** Health taken by strikes not shown yet. */
  get amount(): number {
    return this.held;
  }
}
