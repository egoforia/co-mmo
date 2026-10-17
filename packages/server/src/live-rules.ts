import { standing } from '@co-mmo/shared';
import type { ContentRecord, Store } from './store.ts';
import { RuleRuntime, worldHost, type RuleStatus } from './rules.ts';
import type { World } from './world.ts';

export interface LiveRulesOptions {
  now?: () => number;
  /** A rule paused itself (too many errors or limit hits). */
  onPause?: (record: ContentRecord, reason: string) => void;
}

/** The scripted rules running in the live world, one sandbox each. */
export class LiveRules {
  private readonly loaded = new Map<string, RuleRuntime>();
  /** Loads in flight, so a rule is never loaded twice. */
  private readonly loading = new Map<string, Promise<void>>();

  constructor(private readonly store: Store, private readonly world: World, private readonly options: LiveRulesOptions = {}) {}

  /** Starts a granted rule. */
  start(record: ContentRecord): Promise<void> {
    const def = record.definition;
    if (def?.kind !== 'rule' || this.loaded.has(record.id)) return Promise.resolve();
    const pending = this.loading.get(record.id);
    if (pending) return pending;
    const job = RuleRuntime.load(record.id, def, {
      host: worldHost(this.world),
      state: { read: (id) => this.store.ruleData(id), write: (id, data) => this.store.setRuleData(id, data) },
      now: this.options.now,
      onPause: (reason) => {
        const current = this.store.updateContent(record.id, { rule: { paused: true, reason } });
        if (current) this.options.onPause?.(current, reason);
      },
    }).then((runtime) => {
      this.loading.delete(record.id);
      // Rolled back or switched off while it loaded.
      const now = this.store.contentById(record.id);
      if (!now || !standing(now)) return runtime.dispose();
      if (record.rule?.paused) runtime.pause(record.rule.reason ?? 'Paused by a Steward.', false);
      this.loaded.set(record.id, runtime);
    }, (err) => {
      this.loading.delete(record.id);
      throw err;
    });
    this.loading.set(record.id, job);
    return job;
  }

  /** A new rule's join event for everyone already online, as if they had just arrived. */
  greet(id: string): void {
    const rule = this.loaded.get(id);
    if (!rule) return;
    for (const region of this.world.regions.values()) for (const player of region.playerIds()) rule.fire('join', player);
  }

  stop(id: string): void {
    this.loaded.get(id)?.dispose();
    this.loaded.delete(id);
  }

  /** An engine event about a player, for every rule that listens. */
  fire(type: string, player: string, data: Record<string, string | number> = {}): void {
    for (const rule of this.loaded.values()) rule.fire(type, player, data);
  }

  /** Fires timers that are due. */
  tick(): void {
    for (const rule of this.loaded.values()) rule.tick();
  }

  status(id: string): (RuleStatus & { events: string[]; timers: number }) | undefined {
    const rule = this.loaded.get(id);
    return rule && { ...rule.status, events: rule.events, timers: rule.pendingTimers };
  }

  /** A Steward pauses or resumes a live rule. */
  setPaused(id: string, paused: boolean, reason = 'Paused by a Steward.'): boolean {
    const rule = this.loaded.get(id);
    if (!rule) return false;
    if (paused) {
      // Not the rule's own doing, so no "paused itself" alert.
      this.store.updateContent(id, { rule: { paused: true, reason } });
      rule.pause(reason, false);
    } else {
      rule.resume();
      this.store.updateContent(id, { rule: { paused: false } });
    }
    return true;
  }

  /** Waits for rules still loading (tests, start-up). */
  async ready(): Promise<void> {
    await Promise.allSettled([...this.loading.values()]);
  }

  dispose(): void {
    for (const id of [...this.loaded.keys()]) this.stop(id);
  }
}
