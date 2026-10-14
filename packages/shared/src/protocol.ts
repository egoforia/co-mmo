// Messages exchanged over the game WebSocket. JSON for now; can move to a
// binary encoding later without changing these shapes.

import type { ContentEntry, WishCard } from './content.ts';
import type { Character } from './rpg.ts';

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

/** Strike the nearest creature in reach. */
export interface AttackMessage {
  t: 'attack';
}

/** Talk to the nearest NPC in reach. */
export interface InteractMessage {
  t: 'interact';
}

export interface UseItemMessage {
  t: 'use';
  item: string;
}

export interface AcceptQuestMessage {
  t: 'accept';
  quest: string;
}

/** Speak to the God, from anywhere. */
export interface PrayMessage {
  t: 'pray';
  text: string;
}

/** Confirm or turn down the wish card the God offered. */
export interface WishAnswerMessage {
  t: 'wish';
  card: string;
  confirm: boolean;
}

export type ClientMessage =
  | InputMessage
  | ChatSendMessage
  | AttackMessage
  | InteractMessage
  | UseItemMessage
  | AcceptQuestMessage
  | PrayMessage
  | WishAnswerMessage;

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
  character: Character;
}

export interface EntityState {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  /** Health as a fraction of the maximum, 0 to 1. */
  health: number;
}

export interface CreatureState {
  id: string;
  kind: string;
  asset: string;
  name: string;
  x: number;
  y: number;
  health: number;
}

export interface SnapshotMessage {
  t: 'snapshot';
  tick: number;
  /** Last input sequence number the server applied for this player. */
  ack: number;
  x: number;
  y: number;
  hp: number;
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

/** Someone or something took damage; drives hit flashes and numbers. */
export interface HitMessage {
  t: 'hit';
  /** Who struck: a player or creature id. */
  by: string;
  target: string;
  amount: number;
  /** The target was defeated by this hit. */
  defeated: boolean;
}

/** The player's own character changed (XP, items, quests, level...). */
export interface CharacterMessage {
  t: 'character';
  character: Character;
}

/** Something happened to you worth a line in the log ("+7 XP"). */
export interface NoticeMessage {
  t: 'notice';
  text: string;
}

export interface DialogueMessage {
  t: 'dialogue';
  npc: { id: string; name: string; asset: string };
  text: string;
  /** A quest the NPC is offering, to accept or decline. */
  offer?: { quest: string; title: string; reward: string };
}

/** The God speaks, and may offer a wish card. */
export interface GodMessage {
  t: 'god';
  say: string;
  card?: WishCard;
}

/**
 * Wished content. `replace` carries the whole log (on joining); otherwise
 * these entries are new or changed.
 */
export interface ContentMessage {
  t: 'content';
  entries: ContentEntry[];
  replace: boolean;
}

export type ServerMessage =
  | WelcomeMessage
  | GodMessage
  | ContentMessage
  | HitMessage
  | CharacterMessage
  | NoticeMessage
  | DialogueMessage
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
  if (m.t === 'attack' || m.t === 'interact') return true;
  if (m.t === 'use') return typeof m.item === 'string' && m.item.length <= 64;
  if (m.t === 'accept') return typeof m.quest === 'string' && m.quest.length <= 64;
  if (m.t === 'pray') return typeof m.text === 'string';
  if (m.t === 'wish') return typeof m.card === 'string' && m.card.length <= 64 && typeof m.confirm === 'boolean';
  return false;
}

function isAxis(v: unknown): v is number {
  return v === -1 || v === 0 || v === 1;
}
