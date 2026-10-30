import type { CombatHitTrace } from '@co-mmo/shared';

/** Maximum events retained in memory by default. */
export const COMBAT_LOG_CAPACITY = 500;
/** Maximum duration combat logging stays active before automatically turning off (5 minutes). */
export const COMBAT_LOG_MAX_DURATION_MS = 5 * 60 * 1000;

export interface CombatLoggerOptions {
  capacity?: number;
  now?: () => number;
}

export interface CombatLoggerToggle {
  region?: string;
  entity?: string;
  maxEvents?: number;
  maxDurationMs?: number;
}

/**
 * In-memory ring buffer recorder for combat hit receipts (Tool 5).
 * Zero overhead when inactive (single boolean check).
 * When enabled, automatically turns off after 500 events or 5 minutes.
 */
export class CombatLogger {
  readonly capacity: number;
  private readonly now: () => number;
  private readonly buffer: CombatHitTrace[] = [];
  active = false;
  regionFilter?: string;
  entityFilter?: string;
  activeUntil?: number;
  maxEvents?: number;
  private recordedInSession = 0;

  constructor(options?: CombatLoggerOptions) {
    this.capacity = options?.capacity ?? COMBAT_LOG_CAPACITY;
    this.now = options?.now ?? Date.now;
  }

  /**
   * Activates combat logging with optional region/entity filter and limits.
   * Capped at max 500 events or 5 minutes by default.
   */
  enable(opts?: CombatLoggerToggle): void {
    this.active = true;
    this.regionFilter = opts?.region;
    this.entityFilter = opts?.entity;
    this.recordedInSession = 0;
    this.maxEvents = opts?.maxEvents ?? COMBAT_LOG_CAPACITY;
    const duration = Math.min(opts?.maxDurationMs ?? COMBAT_LOG_MAX_DURATION_MS, COMBAT_LOG_MAX_DURATION_MS);
    this.activeUntil = this.now() + duration;
  }

  /** Deactivates combat logging. */
  disable(): void {
    this.active = false;
    this.activeUntil = undefined;
    this.maxEvents = undefined;
    this.regionFilter = undefined;
    this.entityFilter = undefined;
  }

  /** Empties recorded combat events. */
  clear(): void {
    this.buffer.length = 0;
    this.recordedInSession = 0;
  }

  /**
   * Records a combat hit receipt.
   * Automatically disables logging if duration expires or event limit is reached.
   */
  record(trace: CombatHitTrace): void {
    if (!this.active) return;

    const currentTime = this.now();
    if (this.activeUntil && currentTime >= this.activeUntil) {
      this.disable();
      return;
    }

    if (this.regionFilter && trace.region !== this.regionFilter) return;
    if (this.entityFilter && trace.attacker.id !== this.entityFilter && trace.target.id !== this.entityFilter) return;

    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(trace);
    this.recordedInSession++;

    if (this.maxEvents && this.recordedInSession >= this.maxEvents) {
      this.disable();
    }
  }

  /** Retrieves recent events, optionally filtered by region or entity. */
  events(filter?: { region?: string; entity?: string }): CombatHitTrace[] {
    let list = this.buffer;
    if (filter?.region) list = list.filter((t) => t.region === filter.region);
    if (filter?.entity) list = list.filter((t) => t.attacker.id === filter.entity || t.target.id === filter.entity);
    return [...list];
  }

  /** Exports all recorded events as a formatted JSON string. */
  exportJson(filter?: { region?: string; entity?: string }): string {
    return JSON.stringify(this.events(filter), null, 2);
  }

  /** Current logger status. */
  status(): {
    active: boolean;
    count: number;
    capacity: number;
    region?: string;
    entity?: string;
    secondsLeft?: number;
  } {
    const active = this.active && (!this.activeUntil || this.now() < this.activeUntil);
    const secondsLeft = this.activeUntil ? Math.max(0, Math.round((this.activeUntil - this.now()) / 1000)) : undefined;
    return {
      active,
      count: this.buffer.length,
      capacity: this.capacity,
      ...(this.regionFilter ? { region: this.regionFilter } : {}),
      ...(this.entityFilter ? { entity: this.entityFilter } : {}),
      ...(secondsLeft !== undefined ? { secondsLeft } : {}),
    };
  }
}

/** Global shared instance for single-process server mode. */
export const combatLogger = new CombatLogger();
