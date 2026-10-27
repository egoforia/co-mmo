import { FALLEN_MS, maxHp } from '@co-mmo/shared';
import type { PlayerState, RegionState } from './state.ts';

/** What a player reads when they fall (docs/callings-build-plan.md, step 8). */
export const FALLEN_WORDS = 'You have fallen. A friend may still ring you back, or you can wake at the shrine.';

/**
 * Players at 0 HP lie Fallen where they fell for up to FALLEN_MS
 * (docs/classes.md, The Fallen). Creatures leave them be, since they only
 * hunt players with health. A friend may raise them in place; otherwise
 * they wake at the shrine when the time runs out or they choose to.
 */
export class Fallen {
  constructor(private readonly s: RegionState) {}

  /** True while a player lies Fallen. */
  is(p: PlayerState): boolean {
    return p.fallenUntil !== undefined;
  }

  /**
   * Marks newly fallen players and lists those who should now wake at the
   * shrine. Anyone back above 0 HP by other means stands up again.
   */
  tick(now: number): string[] {
    const waking: string[] = [];
    for (const p of this.s.players.values()) {
      if (p.character.hp > 0) {
        p.fallenUntil = undefined;
        continue;
      }
      if (p.fallenUntil === undefined) {
        p.fallenUntil = now + FALLEN_MS;
        this.s.notice(p, FALLEN_WORDS);
        this.s.broadcastNear(p, { t: 'system', text: `${p.info.name} has fallen.`, at: now });
      }
      if (now >= p.fallenUntil) waking.push(p.info.id);
    }
    return waking;
  }

  /** The "Wake at the shrine" button: wake at the next tick instead of waiting. */
  wake(p: PlayerState): void {
    if (p.fallenUntil !== undefined) p.fallenUntil = Math.min(p.fallenUntil, this.s.now());
  }

  /**
   * Raises a Fallen player where they lie with `share` of their health
   * (Peal of Waking 25%, Great Bell of Waking 50%). Unlike waking at the
   * shrine, being raised leaves no Weakened. Returns false if they were not Fallen.
   */
  raise(p: PlayerState, share: number, by?: PlayerState): boolean {
    if (p.fallenUntil === undefined) return false;
    const max = maxHp(p.character);
    p.character.hp = Math.max(1, Math.min(max, Math.round(max * share)));
    p.fallenUntil = undefined;
    p.lastHurt = this.s.now();
    p.dirty = true;
    this.s.notice(p, by ? `${by.info.name} rang you back. You rise where you fell.` : 'You rise where you fell.');
    if (by) this.s.notice(by, `You raised ${p.info.name}.`);
    this.s.broadcastNear(p, { t: 'system', text: `${p.info.name} rose again.`, at: this.s.now() });
    return true;
  }

  /** Whole seconds left before a Fallen player wakes at the shrine. */
  secondsLeft(p: PlayerState, now: number): number | undefined {
    return p.fallenUntil === undefined ? undefined : Math.max(0, Math.ceil((p.fallenUntil - now) / 1000));
  }
}
