/**
 * Entity inspection data structures for live game loop debugging.
 * Allows Stewards and the Owner to inspect real-time state of players and creatures
 * (HP/Energy, threat tables, active statuses, signature gauges, AI brain state, cooldowns).
 */

export interface EntityInspection {
  id: string;
  kind: 'player' | 'creature';
  name: string;
  x: number;
  y: number;
  floor: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  alive: boolean;
  targetId: string | null;
  statuses: {
    id: string;
    secondsLeft: number;
    by?: string;
    amount?: number;
  }[];
  threat?: {
    targetId: string | null;
    tauntedBy: string | null;
    switchThreshold: number;
    entries: { playerId: string; playerName: string; amount: number; isTarget: boolean }[];
  };
  gauge?: {
    calling: string;
    pips: number;
    max: number;
    threads?: { ember: number; tide: number; gale: number };
    woven?: boolean;
  };
  brain?: {
    state: string;
    leashX: number;
    leashY: number;
    pace: number;
    lastAttackSecondsAgo: number;
  };
  cooldowns: { ability: string; name: string; secondsLeft: number }[];
}
