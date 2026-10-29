// Messages exchanged over the game WebSocket. JSON for now; can move to a
// binary encoding later without changing these shapes.

import { isCalling, type CallingId } from './classes.ts';
import type { ContentEntry, WishCard } from './content.ts';
import { isRace, type RaceId } from './races.ts';
import type { TradeOffer } from './kit.ts';
import type { DraftView } from './workshop.ts';
import type { RegionDef } from './world.ts';
import type { SkyConfig, Weather } from './sky.ts';
import { EQUIP_SLOTS, isStat, type Character, type EquipSlot, type InventorySlot, type Stats } from './rpg.ts';
import type { DamageType } from './weapons.ts';
import type { StatusId, StatusView } from './rpg/statuses.ts';

/**
 * Say: players nearby. Region: everyone in your region. Party: your party.
 * Whisper: one player. World: everyone online.
 */
export type ChatChannel = 'say' | 'region' | 'party' | 'whisper' | 'world';

export const CHAT_CHANNELS: readonly ChatChannel[] = ['say', 'region', 'party', 'whisper', 'world'];

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
  /** Whisper: the name of the player to whisper to. */
  to?: string;
}

/** Asks the game server to answer at once, to time the round trip (the performance overlay). */
export interface PingMessage {
  t: 'ping';
  n: number;
}

/** Strike the nearest creature in reach. */
export interface AttackMessage {
  t: 'attack';
  /** The creature the player chose; the nearest in reach when missing or out of reach. */
  target?: string;
}

/** While Fallen: stop waiting for a friend and wake at the shrine now. */
export interface WakeMessage {
  t: 'wake';
}

/** Talk to the nearest NPC in reach, or search the nearest body, or act on the land. */
export interface InteractMessage {
  t: 'interact';
}

/**
 * The loot window of a fallen creature: take the thing at `index` (named by
 * `item`, so a stale index never takes something else), take everything, or
 * close the window. Whatever is left stays on the body for anyone to take.
 */
export interface LootActionMessage {
  t: 'loot';
  action: 'take' | 'all' | 'close';
  body: string;
  index?: number;
  item?: string;
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

/** Teleport to a coordinate, floor, or different region/biome. */
export interface TeleportMessage {
  t: 'teleport';
  /** Target region/biome name or id; omitted means current region. */
  region?: string;
  /** Target X coordinate. */
  x?: number;
  /** Target Y coordinate. */
  y?: number;
  /** Target floor (0 for ground, positive for storeys, negative for catacombs). */
  floor?: number;
}

/**
 * The Wish Workshop: start a draft in a subcategory, change its fields, ask
 * the God about it or have the God fill in the rest, carry a Talk wish into
 * it (shape), send it to become a wish card, or drop it.
 */
export interface DraftMessage {
  t: 'draft';
  action: 'start' | 'edit' | 'ask' | 'fill' | 'shape' | 'sample' | 'send' | 'drop';
  category?: string;
  sub?: string;
  fields?: Record<string, unknown>;
  /** Fields the player wrote themselves, which the God must not change. */
  locked?: string[];
  /** What the player says to the God (ask). */
  say?: string;
  /** Start from the talk in the Talk tab: the God fills the new draft in from it. */
  carry?: boolean;
}

/** Tell the Stewards about a wished thing or a player that should not be here. */
export interface ReportMessage {
  t: 'report';
  kind: 'content' | 'player';
  /** A content entry id, or a player's name. */
  target: string;
  reason: string;
}

/** Wear an item from the bag, or take off what is worn in a slot. */
export interface EquipMessage {
  t: 'equip';
  item?: string;
  /** Unequip: the slot to empty. */
  slot?: EquipSlot;
}

/** A character from before Callings answers the "Choose your people and Calling" screen. */
export interface ChooseCallingMessage {
  t: 'chooseCalling';
  race: RaceId;
  calling: CallingId;
}

/** Place one free attribute point (docs/attributes.md, How attributes grow). */
export interface SpendPointMessage {
  t: 'spendPoint';
  stat: keyof Stats;
}

/** Use a learned ability on `target`: a creature id for attacks, a player id for heals and buffs; the server falls back when it is out of range. */
export interface AbilityMessage {
  t: 'ability';
  ability: string;
  target?: string;
}

/** Make a recipe from materials in the bag. */
export interface CraftMessage {
  t: 'craft';
  recipe: string;
}

/** Buy, sell or learn at the NPC you are talking to. */
export interface ShopMessage {
  t: 'shop';
  action: 'buy' | 'sell' | 'learn';
  npc: string;
  /** Buy and sell: the item; learn: the ability. */
  id: string;
  qty?: number;
}

/**
 * Trading with another player nearby: ask them by name, answer, change what
 * you offer (which clears both confirmations), confirm, or call it off.
 */
export interface TradeActionMessage {
  t: 'trade';
  action: 'request' | 'accept' | 'decline' | 'offer' | 'confirm' | 'cancel';
  name?: string;
  offer?: TradeOffer;
}

/** Party actions: invite someone by name, answer an invite, or leave. */
export interface PartyActionMessage {
  t: 'party';
  action: 'invite' | 'accept' | 'decline' | 'leave';
  /** Invite: the player's name. */
  name?: string;
}

export type ClientMessage =
  | LootActionMessage
  | DraftMessage
  | EquipMessage
  | SpendPointMessage
  | ChooseCallingMessage
  | AbilityMessage
  | CraftMessage
  | ShopMessage
  | TradeActionMessage
  | PartyActionMessage
  | InputMessage
  | ChatSendMessage
  | AttackMessage
  | WakeMessage
  | InteractMessage
  | UseItemMessage
  | AcceptQuestMessage
  | PrayMessage
  | WishAnswerMessage
  | ReportMessage
  | TeleportMessage
  | PingMessage;

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
  /** How to lay it out: the same on both sides, and it may be a wished region. */
  def: RegionDef;
}

/**
 * Sent on joining or entering a region, and again when the region changes
 * around the player (a new region was wished beyond one of its edges).
 */
export interface WelcomeMessage {
  t: 'welcome';
  you: PlayerInfo;
  region: RegionInfo;
  /** The regions around it on the world grid, corners too, drawn beside it as one map. */
  neighbours: RegionDef[];
  /** The last input the server applied; later ones the client predicted are replayed from here. */
  ack: number;
  x: number;
  y: number;
  /** The floor they are on (floors.ts), when not the ground. */
  floor?: number;
  tickRate: number;
  character: Character;
  /** The sky: how it turns, the server's clock to count the hour from, and this land's weather now. */
  sky: SkyView;
}

/** What a player's screen needs to show the hour and the weather. */
export interface SkyView {
  config: SkyConfig;
  /** The server's clock (epoch ms) when this was sent. */
  now: number;
  weather: Weather;
}

/** The weather over the player's land changed. */
export interface SkyMessage {
  t: 'sky';
  weather: Weather;
}

/** What a creature is doing, when it is more than going about its business. */
export type CreatureMood = 'asleep' | 'fleeing';

export interface EntityState {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  /** The floor it is on (floors.ts), when not the ground. */
  floor?: number;
  /** Health as a fraction of the maximum, 0 to 1. */
  health: number;
  /** The item shown in their right hand (see heldItem), when they wear one. */
  held?: string;
  /** The item shown in their left hand (see offHandItem), when they wear one. */
  offHeld?: string;
  /** Lying Fallen at 0 HP, waiting for a friend to raise them or to wake at the shrine. */
  fallen?: true;
  /** Their running statuses (rpg/statuses.ts), when they have any. */
  statuses?: StatusId[];
}

export interface CreatureState {
  id: string;
  kind: string;
  asset: string;
  name: string;
  x: number;
  y: number;
  /** The floor it is on (floors.ts), when not the ground. */
  floor?: number;
  health: number;
  mood?: CreatureMood;
  /** Its running statuses (rpg/statuses.ts), when it has any. */
  statuses?: StatusId[];
}

/** A defeated creature's body, lying where it fell until it fades. */
export interface BodyState {
  id: string;
  kind: string;
  asset: string;
  name: string;
  x: number;
  y: number;
  /** The floor it is on (floors.ts), when not the ground. */
  floor?: number;
  /** Something is still on it to take (anyone may). */
  loot: boolean;
}

/** A person of the town (an NPC), where they are strolling now. */
export interface NpcState {
  id: string;
  name: string;
  asset: string;
  x: number;
  y: number;
  /** The floor it is on (floors.ts), when not the ground. */
  floor?: number;
  /** Asleep for the night (or the day, for those who keep other hours). */
  asleep?: boolean;
}

export interface SnapshotMessage {
  t: 'snapshot';
  tick: number;
  /** Last input sequence number the server applied for this player. */
  ack: number;
  x: number;
  y: number;
  /** The floor they are on (floors.ts), when not the ground; everyone below is on it too. */
  floor?: number;
  hp: number;
  energy: number;
  /** While you lie Fallen: whole seconds left before you wake at the shrine. */
  fallen?: number;
  /** Your running statuses and the seconds each has left, when you have any. */
  statuses?: StatusView[];
  /** Other players inside the view radius. */
  players: EntityState[];
  /** Creatures inside the view radius. */
  creatures: CreatureState[];
  /** Bodies of defeated creatures inside the view radius. */
  bodies: BodyState[];
  /** NPCs inside the view radius. */
  npcs: NpcState[];
  online: number;
}

export interface ChatMessage {
  t: 'chat';
  channel: ChatChannel;
  from: { id: string; name: string };
  /** Whisper: who it was sent to (the sender sees their own whisper too). */
  to?: { id: string; name: string };
  text: string;
  at: number;
}

export interface PartyMember {
  id: string;
  name: string;
  online: boolean;
  /** Region name while online. */
  region?: string;
}

/** Your party as it is now; null when you are in none. */
export interface PartyMessage {
  t: 'party';
  party: { leader: string; members: PartyMember[] } | null;
}

/** Someone asked you to join their party. */
export interface PartyInviteMessage {
  t: 'party-invite';
  from: { id: string; name: string };
}

/** What happened in the world since you last played, sent on joining. */
export interface AwayMessage {
  t: 'away';
  since: number;
  items: { at: number; text: string }[];
  /** Lines left out to keep the feed short. */
  more: number;
}

export interface SystemMessage {
  t: 'system';
  text: string;
  at: number;
}

/** What the performance overlay shows of the server (`GET /api/admin/perf`, Stewards and the Owner): the one running your region, and the whole world. */
export interface PerfView {
  /** Where you are: the region (or the part of a split region) and the server that runs it. */
  here?: {
    region: string;
    part?: number;
    parts?: number;
    players: number;
    creatures: number;
    server: string;
    tickMs: number;
    worstTickMs: number;
    ticksPerSecond: number;
    lagMs: number;
    worstLagMs: number;
    memoryMb: number;
    heapMb: number;
  };
  /** Players online, and how many servers share the regions. */
  online: number;
  servers: number;
  /** Ticks a second when a server keeps up. */
  tickRate: number;
}

/** The answer to a ping, carrying back its number. */
export interface PongMessage {
  t: 'pong';
  n: number;
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
  /** The ability that struck, when it was one (bolts fly across the screen). */
  ability?: string;
  /** Physical (softened by Armor) or arcane (softened by Ward); physical when missing. */
  damage?: DamageType;
  /** A plain attack fired from a distance (bow, wand...), not struck in reach. */
  ranged?: boolean;
}

/**
 * Sent instead of joining to a character from before Callings: they choose
 * a people and Calling first (docs/classes.md, Migration).
 */
export interface CallingNeededMessage {
  t: 'callingNeeded';
  level: number;
}

/** The player's own character changed (XP, items, quests, level...). */
export interface CharacterMessage {
  t: 'character';
  character: Character;
}

/**
 * Walks or other pictures (a painted normal map) were painted or painted
 * again while you play: fetch the art list again and swap them in, so
 * walkers on screen step with them.
 */
export interface ArtMessage {
  t: 'art';
  /** The walk strips and pictures that changed, by art key. */
  walks: string[];
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
  /** The NPC keeps a shop or teaches: the prices come from SHOPS. */
  shop?: boolean;
}

/** A fallen creature's loot, as its window shows it. */
export interface LootView {
  /** The body's id. */
  id: string;
  /** The creature's name and picture. */
  name: string;
  asset: string;
  /** What is still on it, in order. */
  items: InventorySlot[];
}

/**
 * Opens or refreshes the loot window (someone took something), or closes it
 * (null: you walked away, or the body faded).
 */
export interface LootMessage {
  t: 'loot';
  loot: LootView | null;
}

/** A trade as one side sees it; null when it closed. */
export interface TradeView {
  with: { id: string; name: string };
  mine: TradeOffer;
  theirs: TradeOffer;
  /** Who has confirmed the current offers. */
  myConfirm: boolean;
  theirConfirm: boolean;
}

export interface TradeMessage {
  t: 'trade';
  trade: TradeView | null;
}

/** An ability you used is resting for this long. */
export interface CooldownMessage {
  t: 'cooldown';
  ability: string;
  seconds: number;
}

/** Someone nearby asked to trade with you. */
export interface TradeRequestMessage {
  t: 'trade-request';
  from: { id: string; name: string };
}

/** The player's Workshop draft and its preview, or null when there is none. */
export interface DraftUpdateMessage {
  t: 'draft';
  view: DraftView | null;
  /** The God changed the draft: the form shows its new values. */
  god?: boolean;
  /** "Shape this wish" needs a kind of wish picked first; the God then fills it in from the talk. */
  pick?: boolean;
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
  | SkyMessage
  | LootMessage
  | DraftUpdateMessage
  | CooldownMessage
  | TradeMessage
  | TradeRequestMessage
  | PartyMessage
  | PartyInviteMessage
  | AwayMessage
  | WelcomeMessage
  | GodMessage
  | ContentMessage
  | HitMessage
  | CharacterMessage
  | CallingNeededMessage
  | NoticeMessage
  | ArtMessage
  | DialogueMessage
  | SnapshotMessage
  | ChatMessage
  | SystemMessage
  | PongMessage
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
    return CHAT_CHANNELS.includes(m.channel as ChatChannel) && typeof m.text === 'string' &&
      (m.to === undefined || (typeof m.to === 'string' && m.to.length <= 64));
  }
  if (m.t === 'party') {
    return ['invite', 'accept', 'decline', 'leave'].includes(m.action as string) &&
      (m.name === undefined || (typeof m.name === 'string' && m.name.length <= 64));
  }
  if (m.t === 'attack') return m.target === undefined || isId(m.target);
  if (m.t === 'interact' || m.t === 'wake') return true;
  if (m.t === 'ping') return Number.isSafeInteger(m.n);
  if (m.t === 'loot') {
    return ['take', 'all', 'close'].includes(m.action as string) && isId(m.body) &&
      (m.index === undefined || (Number.isInteger(m.index) && (m.index as number) >= 0 && (m.index as number) < 100)) &&
      (m.item === undefined || isId(m.item));
  }
  if (m.t === 'use') return typeof m.item === 'string' && m.item.length <= 64;
  if (m.t === 'accept') return typeof m.quest === 'string' && m.quest.length <= 64;
  if (m.t === 'pray') return typeof m.text === 'string';
  if (m.t === 'report') {
    return (m.kind === 'content' || m.kind === 'player') && typeof m.target === 'string' && m.target.length <= 64 && typeof m.reason === 'string';
  }
  if (m.t === 'wish') return typeof m.card === 'string' && m.card.length <= 64 && typeof m.confirm === 'boolean';
  if (m.t === 'draft') {
    return ['start', 'edit', 'ask', 'fill', 'shape', 'sample', 'send', 'drop'].includes(m.action as string) &&
      (m.category === undefined || isId(m.category)) && (m.sub === undefined || isId(m.sub)) &&
      (m.say === undefined || (typeof m.say === 'string' && m.say.length <= 400)) &&
      (m.carry === undefined || typeof m.carry === 'boolean') &&
      (m.locked === undefined || (Array.isArray(m.locked) && m.locked.length <= 30 && m.locked.every(isId))) &&
      (m.fields === undefined || (typeof m.fields === 'object' && m.fields !== null && JSON.stringify(m.fields).length <= 8000));
  }
  if (m.t === 'equip') {
    return (typeof m.item === 'string' && m.item.length <= 64) || EQUIP_SLOTS.includes(m.slot as EquipSlot);
  }
  if (m.t === 'spendPoint') return isStat(m.stat);
  if (m.t === 'chooseCalling') return isRace(m.race) && isCalling(m.calling);
  if (m.t === 'ability') return isId(m.ability) && (m.target === undefined || isId(m.target));
  if (m.t === 'craft') return isId(m.recipe);
  if (m.t === 'shop') {
    return ['buy', 'sell', 'learn'].includes(m.action as string) && isId(m.npc) && isId(m.id) &&
      (m.qty === undefined || (Number.isInteger(m.qty) && (m.qty as number) > 0 && (m.qty as number) <= 99));
  }
  if (m.t === 'trade') {
    return ['request', 'accept', 'decline', 'offer', 'confirm', 'cancel'].includes(m.action as string) &&
      (m.name === undefined || (typeof m.name === 'string' && m.name.length <= 64)) &&
      (m.offer === undefined || (typeof m.offer === 'object' && m.offer !== null));
  }
  if (m.t === 'teleport') {
    return (
      (m.region === undefined || (typeof m.region === 'string' && m.region.length <= 64)) &&
      (m.x === undefined || (typeof m.x === 'number' && Number.isFinite(m.x))) &&
      (m.y === undefined || (typeof m.y === 'number' && Number.isFinite(m.y))) &&
      (m.floor === undefined || (typeof m.floor === 'number' && Number.isFinite(m.floor)))
    );
  }
  return false;
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64;
}

function isAxis(v: unknown): v is number {
  return v === -1 || v === 0 || v === 1;
}
