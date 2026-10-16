import type { SpendRecord, Store } from './store.ts';
import { DEFAULT_DAILY_USD } from './settings.ts';

/** Spending against the monthly budget and the daily cap. */
export interface BudgetState {
  spentUsd: number;
  monthlyUsd: number;
  warnUsd: number;
  /** This month's budget is spent: wishes use the offline God and nothing is painted. */
  over: boolean;
  warn: boolean;
  todayUsd: number;
  dailyUsd: number;
  /** Today's cap is reached: painting and sound wait for tomorrow (UTC). */
  overToday: boolean;
  /** Nothing new is painted or made: over the month or today's cap. */
  paused: boolean;
  /** Why it is paused, in plain words. */
  why?: string;
}

/** A paid service as the budget records it: which provider and which of its models. */
export interface Billed {
  provider: string;
  model: string;
}

/**
 * The money side of the game (design doc, Budget): what was spent this month
 * and today against the limits the Owner set in God's View, and the one way
 * spending is written down. Anything that pays for a service asks
 * `state().paused` first and calls `spend` after; nothing else needs to know
 * how limits are counted.
 */
export class Budget {
  private readonly now: () => number;

  constructor(private readonly store: Store, now?: () => number) {
    this.now = now ?? Date.now;
  }

  /** This month's and today's spending against their limits. */
  state(): BudgetState {
    const now = this.now();
    const spentUsd = this.store.spendThisMonth(now).reduce((sum, s) => sum + s.usd, 0);
    const todayUsd = this.store.spendToday(now).reduce((sum, s) => sum + s.usd, 0);
    const { monthlyUsd, warnUsd, dailyUsd = DEFAULT_DAILY_USD } = this.store.settings.budget;
    const over = spentUsd >= monthlyUsd;
    const overToday = todayUsd >= dailyUsd;
    const why = over
      ? "This month's budget is spent."
      : overToday ? "Today's spending cap is reached; what is missing is painted after midnight UTC." : undefined;
    return { spentUsd, monthlyUsd, warnUsd, over, warn: spentUsd >= warnUsd, todayUsd, dailyUsd, overToday, paused: over || overToday, ...(why ? { why } : {}) };
  }

  /** True when nothing new may be paid for (over the month or today's cap). */
  paused(): boolean {
    return this.state().paused;
  }

  /** Writes down what one call to a paid service cost, and for whom (null: the game itself). */
  spend(kind: SpendRecord['kind'], service: Billed, usd: number, playerId: string | null = null, extra: Pick<SpendRecord, 'sample'> = {}): void {
    this.store.recordSpend({ at: this.now(), usd, kind, provider: service.provider, model: service.model, playerId, ...extra });
  }
}
