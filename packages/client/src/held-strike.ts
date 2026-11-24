// Holding Space keeps striking at the pace the server allows, timed by the
// game's own clock. The keyboard's own repeat starts only after about half a
// second and then comes every 30 ms or so, so swings landed late and
// unevenly. A press just before the last swing ends still counts: it swings
// the moment the cooldown is over, as fighting games keep a press.

/** How long before a swing is ready a press is kept for it, ms. */
export const PRESS_KEPT_MS = 150;

/** What a held strike needs: the cooldown now, the swing itself, and a clock and timers (fakes in tests). */
export interface StrikeClock {
  cooldownMs: () => number;
  swing: () => void;
  now?: () => number;
  later?: (run: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
}

/** Swings while a key is held: at once when ready, then each time the cooldown ends. */
export class HeldStrike {
  private holding = false;
  private timer: unknown;
  private last = -Infinity;
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
    this.holding = true;
    if (this.timer === undefined) this.step();
  }

  /** The key came up, or the window lost focus: a swing due within PRESS_KEPT_MS still comes, then no more. */
  release(): void {
    this.holding = false;
    if (this.timer !== undefined && this.untilReady() > PRESS_KEPT_MS) this.stop();
  }

  private untilReady(): number {
    return this.last + this.clock.cooldownMs() - this.now();
  }

  private stop(): void {
    this.cancel(this.timer);
    this.timer = undefined;
  }

  private step = (): void => {
    this.timer = undefined;
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
