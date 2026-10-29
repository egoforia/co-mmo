import type { Character, ClientMessage, SkyConfig, NpcPlacement, PhaseTimings, PlayerInfo, RegionDef, RegionInfo, RegionMap, ServerMessage, SlowTickRecord } from '@co-mmo/shared';
import type { CharacterOp, OpResult } from './character-ops.ts';
import type { Carry, Cell, Connection, Departure, Ghosts, Leaving } from './region.ts';
import type { Tile } from '@co-mmo/shared';

// What the game server (the gateway) and its region servers say to each
// other over the bus. Every region has one host: the gateway itself, or one
// region server. The gateway keeps the sockets, the store and the God; a
// region server runs the simulation of the regions it hosts and sends each
// player's messages back through the gateway.

/** The bus channel the gateway listens on. */
export const GATEWAY = 'gateway';
/** The bus channel a region server listens on. */
export const serverChannel = (id: string): string => `region-server:${id}`;

/**
 * A region as the world sees it, wherever it runs. Reads about players come
 * from the region itself or, for a region on another server, from what its
 * players were last sent (positions a tick old at most). Changes to a remote
 * region arrive there a moment later.
 */
export interface RegionHandle {
  readonly def: RegionDef;
  /** Its name between servers: the region's id, or a cell's key. */
  readonly key: string;
  readonly map: RegionMap;
  readonly info: RegionInfo;
  /** Where it runs: 'gateway', or a region server's id. */
  readonly host: string;
  readonly online: number;
  playerIds(): string[];
  has(id: string): boolean;
  nameOf(id: string): string | undefined;
  position(id: string): { x: number; y: number; floor?: number } | undefined;
  character(id: string): Character | undefined;
  creatureIds(): string[];
  creature(id: string): { kind: string; x: number; y: number; hp: number; alive: boolean } | undefined;
  findSpots(x: number, y: number, count: number, min?: number, max?: number): { x: number; y: number }[];
  nearTile(id: string, tile: Tile, radius: number): boolean;
  /** Short lines about what is near a player, for the God's context. */
  nearby(id: string): string[] | Promise<string[]>;
  change(id: string, op: CharacterOp): OpResult | Promise<OpResult>;
  tell(id: string, text: string): void;
  announce(text: string): void;
  send(id: string, message: ServerMessage): void;
  broadcast(message: ServerMessage): void;
  addCreatures(kind: string, spots: { x: number; y: number; n?: number }[]): void;
  addNpc(npc: NpcPlacement): void;
  removeWish(id: string): void;
  setExits(exits: RegionDef['exits']): void;
  welcomeAll(): void;
  /** `handoff`: the player walked in from the next cell of the same land, so they are not welcomed again. */
  join(info: PlayerInfo, conn: Connection, at: { x: number | null; y: number | null; floor?: number }, character: Character, announce?: string, carry?: Carry, handoff?: boolean): void;
  /** Takes a player out; a region on another server answers a moment later. */
  remove(id: string, announce?: string): Leaving | undefined | Promise<Leaving | undefined>;
  handle(id: string, message: ClientMessage): void;
  /** Runs one tick here; a region on another server ticks there and reports departures itself. */
  tick(): Departure[];
  /** Set when this is one cell of a split region. */
  readonly cell?: Cell;
  /** A split region's cells, each running its own strip. */
  readonly cells?: RegionHandle[];
  /** A cell: what the cell at `from` shows near the border. */
  seeAcross?(from: number, ghosts: Ghosts): void;
}

/** A Carry as it travels between servers (a Map does not survive JSON). */
export interface CarryData {
  ack: number;
  inputs: Carry['inputs'];
  lastAttack: number;
  lastHurt: number;
  readyAt: [string, number][];
  floor?: number;
  fallenUntil?: number;
}

export function carryData(carry: Carry): CarryData {
  return { ...carry, readyAt: [...carry.readyAt] };
}

export function carryFrom(data: CarryData): Carry {
  return { ...data, readyAt: new Map(data.readyAt) };
}

/** A player leaving a region on a region server: everything but the connection, which stays on the gateway. */
export interface LeavingData {
  info: PlayerInfo;
  character: Character;
  x: number;
  y: number;
  carry: CarryData;
}

/** A wished thing placed in a region, kept so the region can be set up again on another server. */
export type Placement =
  | { kind: 'creatures'; id: string; spots: { x: number; y: number }[] }
  | { kind: 'npc'; npc: NpcPlacement };

/** What every region server needs to know about the whole world. */
export interface WorldState {
  defs: RegionDef[];
  online: number;
  /** Party members by player, for shared XP. */
  parties: Record<string, string[]>;
  /** How the sky turns, so every server's regions keep the same hours and weather. */
  sky?: SkyConfig;
}

/** How busy a region server is, sent every couple of seconds. */
export interface ServerLoad {
  /** Average time one tick of all its regions took lately, ms. */
  tickMs: number;
  /** The slowest tick lately, ms. */
  worstTickMs: number;
  /** Ticks run a second lately; the tick rate when it keeps up. */
  ticksPerSecond: number;
  /** How late the event loop ran timers lately, ms: the usual delay and the worst one in a hundred. */
  lagMs: number;
  worstLagMs: number;
  /** All the process holds, and the part that is JavaScript objects. */
  memoryMb: number;
  heapMb: number;
  errors: number;
  lastError?: string;
  /** Machine and process, so the Owner can find it. */
  host: string;
  pid: number;
  startedAt: number;
  /** Per-phase timing breakdown over recent ticks. */
  phases?: PhaseTimings;
  /** Slowest region and phase on this host, if any. */
  slowestRegion?: {
    id: string;
    phase: string;
    ms: number;
  };
}

/** One hosted region's state in a beat: who is there and its creatures, for God's View. */
export interface RegionBeat {
  id: string;
  players: number;
  creatures: { id: string; kind: string; x: number; y: number; hp: number; alive: boolean }[];
}

/** Messages to a region server. Those with `ask` are answered. */
export type ToServer =
  | { t: 'host'; region: RegionDef; placements: Placement[]; cell?: Cell }
  | { t: 'drop'; region: string; ask?: number; replyTo?: string }
  | { t: 'join'; region: string; info: PlayerInfo; at: { x: number | null; y: number | null; floor?: number }; character: Character; announce?: string; carry?: CarryData; handoff?: boolean }
  | { t: 'remove'; region: string; id: string; announce?: string; ask?: number; replyTo?: string }
  | { t: 'input'; region: string; id: string; m: ClientMessage }
  | { t: 'change'; region: string; id: string; op: CharacterOp; ask?: number; replyTo?: string }
  | { t: 'nearby'; region: string; id: string; ask?: number; replyTo?: string }
  | { t: 'tell'; region: string; id: string; text: string }
  | { t: 'announce'; region: string; text: string }
  | { t: 'send'; region: string; id: string; m: ServerMessage }
  | { t: 'broadcast'; region: string; m: ServerMessage }
  | { t: 'place'; region: string; placement: Placement }
  | { t: 'unplace'; region: string; id: string }
  | { t: 'exits'; region: string; exits: RegionDef['exits'] }
  | { t: 'welcome-all'; region: string }
  | { t: 'ghosts'; region: string; from: number; ghosts: Ghosts }
  | { t: 'world'; state: WorldState }
  | { t: 'content'; entries: import('@co-mmo/shared').ContentEntry[] }
  /** The gateway does not know this server (it restarted, or gave the server up for dead): drop everything and say hello again. */
  | { t: 'reset' }
  | { t: 'answer'; ask: number; value?: unknown; error?: string };

/** One thing for the gateway to pass on to a player. */
export type Outgoing = { to: string; m: ServerMessage } | { close: string; reason: string };

/** Messages to the gateway. */
export type ToGateway =
  | { t: 'hello'; server: string; load: ServerLoad }
  | { t: 'beat'; server: string; load: ServerLoad; regions: RegionBeat[] }
  | { t: 'out'; server: string; region: string; items: Outgoing[] }
  | { t: 'departures'; server: string; region: string; list: (Departure & { x: number; y: number })[] }
  | { t: 'hook'; server: string; region: string; hook: 'worldChat'; m: ServerMessage }
  | { t: 'hook'; server: string; region: string; hook: 'creator'; thing: string; player: string; credit: import('@co-mmo/shared').CreatorCredit }
  | { t: 'hook'; server: string; region: string; hook: 'event'; type: 'use' | 'interact' | 'defeat'; player: string; data: Record<string, string | number> }
  | { t: 'hook'; server: string; region: string; hook: 'route'; m: import('@co-mmo/shared').ChatMessage; to?: string }
  | { t: 'hook'; server: string; region: string; hook: 'journal'; text: string; player: string }
  | { t: 'hook'; server: string; region: string; hook: 'regionChat'; m: ServerMessage }
  /** A cell's border, each tick, for the cells beside it. */
  | { t: 'edge'; server: string; region: string; ghosts: Ghosts }
  /** A tick that exceeded the time budget, captured for investigation. */
  | { t: 'slow-tick'; server: string; record: SlowTickRecord }
  | { t: 'bye'; server: string }
  | { t: 'answer'; ask: number; value?: unknown; error?: string };
