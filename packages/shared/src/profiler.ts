/**
 * CPU and memory profiling types across the simulation fleet.
 */

export interface CpuProfileRequest {
  host: string;
  durationSeconds?: number;
  kind?: 'cpu' | 'heap';
}

export interface ProfileInfo {
  id: string;
  host: string;
  kind: 'cpu' | 'heap';
  startedAt: number;
  sizeBytes: number;
}

export interface ProfileRetentionPolicy {
  dir: string;
  maxFiles: number;
  pruneHours: number;
}

export interface ActiveProfileRecording {
  id: string;
  host: string;
  kind: 'cpu' | 'heap';
  startedAt: number;
  durationSeconds: number;
  remainingSeconds: number;
}

export interface ProfileStatusResponse {
  recording: boolean;
  profile?: ActiveProfileRecording;
}
