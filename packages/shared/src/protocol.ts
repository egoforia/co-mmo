// Messages exchanged over the game WebSocket. JSON for now; can move to a
// binary encoding later without changing these shapes.

export type ChatChannel = 'say' | 'world';

export interface InputMessage {
  t: 'input';
  /** Increasing sequence number, echoed back as `ack` in snapshots. */
  seq: number;
  /** Direction intent, each -1, 0 or 1. */
  dx: number;
  dy: number;
}

export interface ChatSendMessage {
  t: 'chat';
  channel: ChatChannel;
  text: string;
}

export type ClientMessage = InputMessage | ChatSendMessage;

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  role: Role;
}

export type Role = 'player' | 'steward' | 'owner';

/** Clients rebuild the map from the shared region definition with this id. */
export interface RegionInfo {
  id: string;
  name: string;
}

export interface WelcomeMessage {
  t: 'welcome';
  you: PlayerInfo;
  region: RegionInfo;
  x: number;
  y: number;
  tickRate: number;
}

export interface EntityState {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
}

export interface CreatureState {
  id: string;
  asset: string;
  name: string;
  x: number;
  y: number;
}

export interface SnapshotMessage {
  t: 'snapshot';
  tick: number;
  /** Last input sequence number the server applied for this player. */
  ack: number;
  x: number;
  y: number;
  /** Other players inside the view radius. */
  players: EntityState[];
  /** Creatures inside the view radius. */
  creatures: CreatureState[];
  online: number;
}

export interface ChatMessage {
  t: 'chat';
  channel: ChatChannel;
  from: { id: string; name: string };
  text: string;
  at: number;
}

export interface SystemMessage {
  t: 'system';
  text: string;
  at: number;
}

export interface ErrorMessage {
  t: 'error';
  code: string;
  message: string;
}

export type ServerMessage =
  | WelcomeMessage
  | SnapshotMessage
  | ChatMessage
  | SystemMessage
  | ErrorMessage;

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  if (m.t === 'input') {
    return (
      Number.isInteger(m.seq) &&
      isAxis(m.dx) &&
      isAxis(m.dy)
    );
  }
  if (m.t === 'chat') {
    return (m.channel === 'say' || m.channel === 'world') && typeof m.text === 'string';
  }
  return false;
}

function isAxis(v: unknown): v is number {
  return v === -1 || v === 0 || v === 1;
}
