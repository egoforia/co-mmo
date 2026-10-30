/** A recorded tick that exceeded the server's per-tick time budget. */
export interface SlowTickRecord {
  id: number;
  at: number;
  host: string;
  region: string;
  cell?: { index: number; count: number };
  totalMs: number;
  phases: Record<string, number>;
  players: number;
  creatures: number;
  activeStatuses: number;
  error?: string;
}
