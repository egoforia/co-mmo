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
