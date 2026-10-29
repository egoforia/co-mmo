/**
 * Profiling types for tick phases, CPU profiling, and memory snapshots.
 */

/** Per-phase timing in ms over the recent window. */
export interface PhaseTiming {
  avgMs: number;
  worstMs: number;
}

/** Phase timings keyed by phase name. */
export type PhaseTimings = Record<string, PhaseTiming>;

/** Full timing breakdown for a host. */
export interface HostTickBreakdown {
  phases: PhaseTimings;
  slowestRegion?: {
    id: string;
    phase: string;
    ms: number;
  };
}

/** Plain, friendly labels for tick phases shown in God's View. */
export const PHASE_LABELS: Record<string, string> = {
  inputs: 'Inputs & movement',
  sky: 'Sky & weather',
  combat: 'Combat & effects',
  minds_think: 'Creature brains',
  bodies: 'Loot & fading bodies',
  minds_live: 'Townsfolk routines',
  fallen: 'Fallen revival',
  snapshots: 'Player snapshots',
  rules: 'Sandbox rules',
};

/** Request to start recording a CPU profile or take a heap snapshot. */
export interface CpuProfileRequest {
  host: string;
  durationSeconds?: number;
  kind?: 'cpu' | 'heap';
}

/** Saved profile or heap snapshot file metadata. */
export interface ProfileInfo {
  id: string;
  host: string;
  kind: 'cpu' | 'heap';
  startedAt: number;
  sizeBytes: number;
}

/** Active profile retention policy configured on the gateway. */
export interface ProfileRetentionPolicy {
  dir: string;
  maxFiles: number;
  pruneHours: number;
}

/** Currently running profile recording status. */
export interface ActiveProfileRecording {
  id: string;
  host: string;
  kind: 'cpu' | 'heap';
  startedAt: number;
  durationSeconds: number;
  remainingSeconds: number;
}

/** Status response for active recordings. */
export interface ProfileStatusResponse {
  recording: boolean;
  profile?: ActiveProfileRecording;
}
