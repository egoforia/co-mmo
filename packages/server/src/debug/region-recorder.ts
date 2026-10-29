import { createHash } from 'node:crypto';
import type { ClientMessage, Departure, ReplayHeader, ReplayTickEvent, ReplayTrace } from '@co-mmo/shared';
import { mulberry32 } from './prng.ts';
import type { Region, RegionRecorderInterface } from '../region.ts';

/** Default recording duration in ticks (30 seconds at 20 ticks/sec). */
export const DEFAULT_RECORD_TICKS = 600;

/** Computes a deterministic SHA-256 snapshot hash of a region's simulation state. */
export function computeSnapshotHash(region: Region): string {
  const hash = createHash('sha256');

  // Players sorted by ID
  const players = region.allPlayers().sort((a, b) => a.info.id.localeCompare(b.info.id));
  for (const p of players) {
    hash.update(`P:${p.info.id}:${p.x.toFixed(3)}:${p.y.toFixed(3)}:${p.floor}:${p.character.hp.toFixed(1)}:${p.character.energy.toFixed(1)}:${p.ack};`);
  }

  // Creatures sorted by ID
  const creatures = region.allCreatures().sort((a, b) => a.id.localeCompare(b.id));
  for (const c of creatures) {
    const threatEntries = Object.entries(c.threat).sort(([k1], [k2]) => k1.localeCompare(k2));
    const threatStr = threatEntries.map(([k, v]) => `${k}=${v.toFixed(1)}`).join(',');
    hash.update(`C:${c.id}:${c.x.toFixed(3)}:${c.y.toFixed(3)}:${c.floor}:${c.hp.toFixed(1)}:${c.aggro ?? ''}:[${threatStr}]:${c.respawnAt ?? ''};`);
  }

  // Bodies sorted by ID
  const bodies = region.allBodies().sort((a, b) => a.id.localeCompare(b.id));
  for (const b of bodies) {
    hash.update(`B:${b.id}:${b.x.toFixed(3)}:${b.y.toFixed(3)}:${b.floor}:${b.until}:${b.loot.length};`);
  }

  return hash.digest('hex').slice(0, 16);
}

export interface RegionRecorderOptions {
  seed?: number;
  clock?: number;
  maxTicks?: number;
}

/**
 * Records player inputs and ticks in a region into a ReplayTrace.
 * Strips private chat messages and attaches deterministic PRNG for exact replay.
 */
export class RegionRecorder implements RegionRecorderInterface {
  private readonly header: ReplayHeader;
  private readonly ticks: ReplayTickEvent[] = [];
  private currentInputs: { playerId: string; message: ClientMessage }[] = [];
  private active = true;
  readonly maxTicks: number;

  constructor(
    readonly region: Region,
    options: RegionRecorderOptions = {},
  ) {
    this.maxTicks = options.maxTicks ?? DEFAULT_RECORD_TICKS;
    const seed = options.seed ?? ((Math.random() * 0x7fffffff) >>> 0);
    const startClock = options.clock ?? region.currentTime();

    // Attach Mulberry32 PRNG to the region so simulation uses this deterministic sequence
    region.setRandom(mulberry32(seed));

    this.header = {
      version: 1,
      regionId: region.def.id,
      regionDef: JSON.parse(JSON.stringify(region.def)),
      recordedAt: Date.now(),
      seed,
      startClock,
      initialState: region.captureInitialState(),
    };

    region.setRecorder(this);
  }

  recordInput(playerId: string, message: ClientMessage): void {
    if (!this.active) return;
    let safeMessage = message;
    if (message.t === 'chat') {
      // Privacy: Strip chat text to avoid storing private chat messages in traces
      safeMessage = { ...message, text: '' };
    }
    this.currentInputs.push({ playerId, message: safeMessage });
  }

  recordTick(tick: number, clock: number, departures: Departure[]): void {
    if (!this.active) return;

    const snapshotHash = computeSnapshotHash(this.region);
    const event: ReplayTickEvent = {
      tick,
      clock,
      inputs: [...this.currentInputs],
      ...(departures.length > 0 ? { departures: [...departures] } : {}),
      snapshotHash,
    };

    this.ticks.push(event);
    this.currentInputs = [];

    if (this.ticks.length >= this.maxTicks) {
      this.stop();
    }
  }

  stop(): ReplayTrace {
    if (this.active) {
      this.active = false;
      this.region.setRecorder(undefined);
    }
    return this.getTrace();
  }

  getTrace(): ReplayTrace {
    return {
      header: this.header,
      ticks: this.ticks,
    };
  }

  isActive(): boolean {
    return this.active;
  }

  ticksRecorded(): number {
    return this.ticks.length;
  }

  remainingSeconds(): number {
    const remainingTicks = Math.max(0, this.maxTicks - this.ticks.length);
    return Math.ceil(remainingTicks / 20);
  }

  status(): { active: boolean; ticksRecorded: number; maxTicks: number; secondsRemaining: number } {
    return {
      active: this.active,
      ticksRecorded: this.ticks.length,
      maxTicks: this.maxTicks,
      secondsRemaining: this.remainingSeconds(),
    };
  }
}

/** Active recorders keyed by region ID. */
const activeRecorders = new Map<string, RegionRecorder>();

export function startRegionRecording(region: Region, options?: { durationSeconds?: number; seed?: number }): RegionRecorder {
  const existing = activeRecorders.get(region.def.id);
  if (existing) {
    existing.stop();
    activeRecorders.delete(region.def.id);
  }
  const maxTicks = (options?.durationSeconds ?? 30) * 20;
  const recorder = new RegionRecorder(region, { maxTicks, seed: options?.seed });
  activeRecorders.set(region.def.id, recorder);
  return recorder;
}

export function stopRegionRecording(regionId: string): ReplayTrace | undefined {
  const recorder = activeRecorders.get(regionId);
  if (!recorder) return undefined;
  activeRecorders.delete(regionId);
  return recorder.stop();
}

export function getActiveRecording(regionId: string): RegionRecorder | undefined {
  return activeRecorders.get(regionId);
}
