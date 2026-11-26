// Holding Space keeps striking at the pace the server allows, timed by the
// game's own clock. The keyboard's own repeat starts only after about half a
// second and then comes every 30 ms or so, so swings landed late and
// unevenly. A press just before the last swing ends still counts: it swings
// the moment the cooldown is over, as fighting games keep a press.
//
// A skill readied with Ctrl or Shift and its key (readied-skill.ts) goes in
// place of the next swing: held, Space waits for it to be ready, casts it,
// then carries on striking. It is never swapped for a strike.

/** How long before a swing is ready a press is kept for it, ms. */
export const PRESS_KEPT_MS = 150;

/**
 * After a cast, how long Space must stay down before strikes carry on, ms:
 * longer than a tap, so tapping Space with a skill readied casts only it.
 */
export const HELD_AFTER_CAST_MS = 250;

/** A readied skill: how long it still rests, and casting it (false when it cannot be cast now, e.g. no Energy). */
export interface SkillCast {
  restMs: number;
  cast: () => boolean;
}

/** What a held strike needs: the cooldown now, the swing itself, and a clock and timers (fakes in tests). */
export interface StrikeClock {
  cooldownMs: () => number;
  swing: () => void;
  /** The readied skill to cast in place of the next swing, if any. */
  skill?: () => SkillCast | undefined;
  /** Space came up with the readied skill still resting longer than PRESS_KEPT_MS: nothing was cast. */
  tooEarly?: (restMs: number) => void;
  now?: () => number;
  later?: (run: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
}

/** Swings while a key is held: at once when ready, then each time the cooldown ends. */
export class HeldStrike {
  private holding = false;
  private timer: unknown;
  private last = -Infinity;
  /** A readied skill could not be cast: wait for Space to come up before trying again, so key repeats do not ask over and over. */
  private stalled = false;
  /** The pending timer is the first strike after a cast: a tap of Space meant the skill, so letting go drops it. */
  private afterCast = false;
  private readonly now: () => number;
  private readonly later: (run: () => void, ms: number) => unknown;
  private readonly cancel: (timer: unknown) => void;

  constructor(private readonly clock: StrikeClock) {
    this.now = clock.now ?? (() => performance.now());
    this.later = clock.later ?? ((run, ms) => setTimeout(run, ms));
    this.cancel = clock.cancel ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  /** The key went down; its repeats change nothing. */
  press(): void {
    if (this.stalled) return;
    this.holding = true;
    if (this.timer === undefined) this.step();
  }

  /** The key came up, or the window lost focus: a swing due within PRESS_KEPT_MS still comes, then no more. */
  release(): void {
    this.holding = false;
    this.stalled = false;
    if (this.timer === undefined) return;
    if (this.afterCast) {
      this.stop();
      return;
    }
    const skill = this.clock.skill?.();
    const wait = skill ? skill.restMs : this.untilReady();
    if (wait <= PRESS_KEPT_MS) return;
    this.stop();
    if (skill) this.clock.tooEarly?.(wait);
  }

  private untilReady(): number {
    return this.last + this.clock.cooldownMs() - this.now();
  }

  private stop(): void {
    this.cancel(this.timer);
    this.timer = undefined;
    this.afterCast = false;
  }

  private step = (): void => {
    this.timer = undefined;
    this.afterCast = false;
    const skill = this.clock.skill?.();
    if (skill) {
      if (skill.restMs > 0) {
        this.timer = this.later(this.step, skill.restMs);
        return;
      }
      if (!skill.cast()) {
        this.stalled = this.holding;
        return;
      }
      // Cast: held on past a tap, Space strikes again once the swing has rested.
      if (this.holding) {
        this.timer = this.later(this.step, Math.max(HELD_AFTER_CAST_MS, this.untilReady()));
        this.afterCast = true;
      }
      return;
    }
    const wait = this.untilReady();
    if (wait > 0) {
      this.timer = this.later(this.step, wait);
      return;
    }
    this.last = this.now();
    this.clock.swing();
    if (this.holding) this.timer = this.later(this.step, this.clock.cooldownMs());
  };
}
