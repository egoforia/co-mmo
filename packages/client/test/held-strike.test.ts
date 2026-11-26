import { describe, expect, it } from 'vitest';
import { HELD_AFTER_CAST_MS, HeldStrike, PRESS_KEPT_MS } from '../src/held-strike.ts';

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

/** A held strike with a readied skill on the same fake clock; `rest` is when the skill is ready, `energy` whether it can be cast. */
function withSkill(opts: { cooldown?: number; rest?: number; energy?: boolean } = {}) {
  let now = 0;
  const swings: number[] = [];
  const casts: number[] = [];
  const early: number[] = [];
  let readied = true;
  let due: { at: number; run: () => void } | undefined;
  const s = new HeldStrike({
    cooldownMs: () => opts.cooldown ?? 800,
    swing: () => swings.push(now),
    skill: () =>
      readied
        ? {
            restMs: Math.max(0, (opts.rest ?? 0) - now),
            cast: () => {
              if (opts.energy === false) return false;
              readied = false;
              casts.push(now);
              return true;
            },
          }
        : undefined,
    tooEarly: (ms) => early.push(ms),
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
  return { s, swings, casts, early, run, ready: () => (readied = true) };
}

describe('a readied skill and Space', () => {
  it('casts the skill instead of the strike, then Space strikes again', () => {
    const { s, swings, casts, run } = withSkill();
    s.press();
    s.release();
    run(1000);
    s.press();
    s.release();
    run(1000);
    expect(casts).toEqual([0]);
    expect(swings).toEqual([1000]);
  });

  it('a tap that stays down a moment still casts only the skill', () => {
    const { s, swings, casts, run } = withSkill();
    s.press();
    run(HELD_AFTER_CAST_MS - 100);
    s.release();
    run(2000);
    expect(casts).toEqual([0]);
    expect(swings).toEqual([]);
  });

  it('held: casts the skill first, then carries on striking at the strike pace', () => {
    const { s, swings, casts, run } = withSkill();
    s.press();
    run(1700);
    s.release();
    run(2000);
    expect(casts).toEqual([0]);
    expect(swings).toEqual([HELD_AFTER_CAST_MS, HELD_AFTER_CAST_MS + 800, HELD_AFTER_CAST_MS + 1600]);
  });

  it('held: waits for a resting skill and casts it the moment it is ready, never striking in its place', () => {
    const { s, swings, casts, run } = withSkill({ rest: 600 });
    s.press();
    run(1000);
    s.release();
    run(2000);
    expect(casts).toEqual([600]);
    expect(swings).toEqual([600 + HELD_AFTER_CAST_MS]);
  });

  it('a tap within PRESS_KEPT_MS of the skill being ready still casts it', () => {
    const { s, casts, early, run } = withSkill({ rest: PRESS_KEPT_MS - 50 });
    s.press();
    s.release();
    run(1000);
    expect(casts).toEqual([PRESS_KEPT_MS - 50]);
    expect(early).toEqual([]);
  });

  it('a tap long before the skill is ready casts nothing and says how long is left', () => {
    const { s, swings, casts, early, run } = withSkill({ rest: 400 });
    s.press();
    s.release();
    run(2000);
    expect(casts).toEqual([]);
    expect(swings).toEqual([]);
    expect(early).toEqual([400]);
  });

  it('a skill that cannot be cast stays readied and is not asked again until Space comes up', () => {
    const { s, swings, casts, run } = withSkill({ energy: false });
    s.press();
    s.press();
    s.press();
    run(2000);
    s.release();
    expect(casts).toEqual([]);
    expect(swings).toEqual([]);
  });
});
