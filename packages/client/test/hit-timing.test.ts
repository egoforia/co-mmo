import { describe, expect, it } from 'vitest';
import { HeldHurt, MOST_HELD_MS, holdFor } from '../src/world-scene/hit-timing.ts';

// A strike is shown once its striker is drawn where it struck from (hit-timing.ts).

describe('when a strike is shown', () => {
  it('waits until its striker is drawn at the moment it struck, never long', () => {
    expect(holdFor(5000, 4900)).toBe(100);
    expect(holdFor(5000, 4600)).toBe(MOST_HELD_MS);
    // Drawn at or past it (beside us, on the present), and our own strikes: at once.
    expect(holdFor(5000, 5010)).toBe(0);
    expect(holdFor(5000, undefined)).toBe(0);
  });

  it('keeps the health a held strike takes until it lands', () => {
    const held = new HeldHurt();
    held.hold(12);
    held.hold(5);
    expect(held.amount).toBe(17);
    held.land(12);
    expect(held.amount).toBe(5);
    held.land(9);
    expect(held.amount).toBe(0);
  });
});
