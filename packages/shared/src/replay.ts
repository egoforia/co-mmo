import type { ClientMessage, PlayerInfo } from './protocol.ts';
import type { RegionDef, NpcPlacement, Side } from './world.ts';
import type { Character, CreatureDef, InventorySlot, Status } from './rpg.ts';
import type { Placed } from './floors.ts';
import type { RoutinePlace } from './routines.ts';
import type { DayPart } from './sky.ts';
import type { GaugeId } from './rpg/gauges.ts';
import type { Thread } from './rpg/abilities.ts';

/** One player's gauge state snapshot for replay serialization. */
export interface GaugeStateSnapshot {
  id: GaugeId;
  pips: number;
  at: number;
  thread?: Thread;
  echoes?: { on: string; amount: number; until: number }[];
}

/** A player's simulation state snapshot at the start of a replay. */
export interface PlayerStateSnapshot {
  info: PlayerInfo;
  character: Character;
  x: number;
  y: number;
  floor?: number;
  inputs?: { seq: number; dx: number; dy: number }[];
  ack?: number;
  lastAttack?: number;
  lastHurt?: number;
  readyAt?: Record<string, number>;
  statuses?: Status[];
  stunImmuneUntil?: number;
  facing?: { dx: number; dy: number };
  stance?: { ability: string; amount: number };
  gauge?: GaugeStateSnapshot;
  fallenUntil?: number;
  phase?: number;
}

/** A creature's simulation state snapshot at the start of a replay. */
export interface CreatureStateSnapshot {
  id: string;
  kind: string;
  def?: CreatureDef;
  hp: number;
  x: number;
  y: number;
  floor: number;
  home: Placed;
  target: { x: number; y: number; floor?: number } | null;
  rest: number;
  aggro: string | null;
  threat: Record<string, number>;
  returning: boolean;
  lastAttack: number;
  respawnAt: number | null;
  fleeing: string | null;
  fleeUntil: number;
  asleep: boolean;
  route?: { x: number; y: number; floor?: number }[];
  leg: number;
  statuses: Status[];
  stunImmuneUntil?: number;
  pace?: number;
}

/** A fallen creature's body holding loot in a region. */
export interface Body {
  id: string;
  kind: string;
  def: CreatureDef;
  x: number;
  y: number;
  floor: number;
  until: number;
  finders: string[];
  loot: InventorySlot[];
}

export type BodySnapshot = Body;

/** An NPC strolling or working in a region. */
export interface Townsperson extends NpcPlacement {
  floor: number;
  home: Placed;
  target: { x: number; y: number; floor?: number } | null;
  rest: number;
  spots: Record<RoutinePlace, Placed>;
  part?: DayPart;
  path: { x: number; y: number; floor?: number }[];
  asleep: boolean;
}

export type TownspersonSnapshot = Townsperson;

/** A player departure from a region during a tick. */
export type Departure =
  | { id: string; side: Side; died?: undefined; cell?: undefined }
  | { id: string; died: true; side?: undefined; cell?: undefined }
  | { id: string; cell: number; side?: undefined; died?: undefined };

/** Header metadata for a recorded region replay trace. */
export interface ReplayHeader {
  version: 1;
  regionId: string;
  regionDef: RegionDef;
  recordedAt: number;
  seed: number;
  startClock: number;
  initialState: {
    players: PlayerStateSnapshot[];
    creatures: CreatureStateSnapshot[];
    bodies: Body[];
    townsfolk: Townsperson[];
  };
}

/** One tick event in a recorded replay trace. */
export interface ReplayTickEvent {
  tick: number;
  clock: number;
  inputs: {
    playerId: string;
    message: ClientMessage;
  }[];
  departures?: Departure[];
  snapshotHash?: string;
}

/** Complete replay trace of a region simulation. */
export interface ReplayTrace {
  header: ReplayHeader;
  ticks: ReplayTickEvent[];
}
