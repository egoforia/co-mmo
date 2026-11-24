import { describe, expect, it } from 'vitest';
import { HeldStrike, PRESS_KEPT_MS } from '../src/held-strike.ts';

/** A held strike on a fake clock: run(ms) moves time on and fires what is due. */
function strike(cooldown = 800) {
  let now = 0;
  const swings: number[] = [];
  let due: { at: number; run: () => void } | undefined;
  const s = new HeldStrike({
    cooldownMs: () => cooldown,
    swing: () => swings.push(now),
    now: () => now,
    later: (run, ms) => (due = { at: now + ms, run }),
    cancel: () => (due = undefined),
  });
  const run = (ms: number) => {
    const end = now + ms;
    while (due && due.at <= end) {
      const d = due;
      due = undefined;
      now = d.at;
      d.run();
    }
    now = end;
  };
  return { s, swings, run };
}

describe('holding Space', () => {
  it('swings at once, then each time the cooldown ends, until let go', () => {
    const { s, swings, run } = strike();
    s.press();
    run(2500);
    s.release();
    run(2000);
    expect(swings).toEqual([0, 800, 1600, 2400]);
  });

  it('keeps a press made just before the swing is ready', () => {
    const { s, swings, run } = strike();
    s.press();
    s.release();
    run(800 - PRESS_KEPT_MS + 20);
    s.press();
    s.release();
    run(1000);
    expect(swings).toEqual([0, 800]);
  });

  it('forgets a press made long before the swing is ready', () => {
    const { s, swings, run } = strike();
    s.press();
    s.release();
    run(100);
    s.press();
    s.release();
    run(2000);
    expect(swings).toEqual([0]);
  });
});
