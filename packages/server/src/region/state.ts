import {
  wisherOf,
  VIEW_RADIUS,
  Tile,
  type Character,
  type CreatorCredit,
  type CreatureDef,
  type InventorySlot,
  type NpcPlacement,
  type PlayerInfo,
  type RegionMap,
  type ServerMessage,
} from '@co-mmo/shared';
import { nearestTile, type Connection, type RegionHooks } from '../region.ts';

// What every system of a region shares: who and what is in it, and how to
// tell players about it. The Region owns one RegionState and hands it to
// each system (combat, creature minds, the kit, quests, bodies, chat).

/** A player in the region, as the simulation holds them. */
export interface PlayerState {
  info: PlayerInfo;
  conn: Connection;
  character: Character;
  x: number;
  y: number;
  inputs: { seq: number; dx: number; dy: number }[];
  ack: number;
  chatTimes: number[];
  lastAttack: number;
  lastHurt: number;
  /** When each ability can be used again, epoch ms. */
  readyAt: Map<string, number>;
  /** Character changed this tick; send it once the tick ends. */
  dirty: boolean;
  /** People and creatures in view at the last snapshot. */
  crowd: number;
  /** Spreads players' snapshots over the ticks when they are not sent every tick. */
  phase: number;
  /** The body whose loot window is open, if any. */
  looting?: string;
}

/** Anything that strolls about a home spot: creatures and NPCs. */
export interface Walker {
  x: number;
  y: number;
  home: { x: number; y: number };
  /** Where it is strolling to. */
  target: { x: number; y: number } | null;
  /** Ticks to rest before choosing the next spot. */
  rest: number;
}

/** A defeated creature's body: what it dropped waits there for anyone to take. */
export interface Body {
  id: string;
  kind: string;
  def: CreatureDef;
  x: number;
  y: number;
  /** Epoch ms when it fades away. */
  until: number;
  /** Who won it: the one who struck the last blow and party members who shared the fight. They hear what others take. */
  finders: string[];
  loot: InventorySlot[];
}

/** An NPC, where they stand now. */
export type Townsperson = NpcPlacement & Walker;

export interface Creature extends Walker {
  id: string;
  kind: string;
  def: CreatureDef;
  hp: number;
  /** The player it is fighting. */
  aggro: string | null;
  returning: boolean;
  lastAttack: number;
  /** Epoch ms when a defeated creature comes back; null while alive. */
  respawnAt: number | null;
}

/** The people, creatures, NPCs and bodies in one region (or cell), and how to reach its players. */
export class RegionState {
  readonly players = new Map<string, PlayerState>();
  creatures: Creature[] = [];
  /** Bodies of defeated creatures, until they fade. */
  bodies: Body[] = [];
  bodyCount = 0;
  /** The map's NPCs (the same objects as `map.npcs`, so it stays current) and those wishes added. */
  townsfolk: Townsperson[] = [];
  tickCount = 0;

  constructor(
    readonly map: RegionMap,
    readonly hooks: RegionHooks,
    readonly now: () => number,
    readonly random: () => number,
  ) {}

  /** Delivers a message to everyone in this region. */
  broadcast(message: ServerMessage): void {
    for (const p of this.players.values()) p.conn.send(message);
  }

  /** Sends one player a message. */
  send(id: string, message: ServerMessage): void {
    this.players.get(id)?.conn.send(message);
  }

  /** A line in one player's log. */
  tell(id: string, text: string): void {
    const p = this.players.get(id);
    if (p) this.notice(p, text);
  }

  /** Someone enjoyed a wished thing; its wisher earns Creator XP (the world decides how much). */
  credit(thing: string, p: PlayerState, credit: CreatorCredit): void {
    if (wisherOf(thing)) this.hooks.creator?.(thing, p.info.id, credit);
  }

  /** Tells the player, the region and the feed about levels gained. */
  levelUps(p: PlayerState, levels: number): void {
    if (!levels) return;
    this.notice(p, `You reached level ${p.character.level}! Every stat rose by ${levels}.`);
    this.broadcastSystem(`${p.info.name} reached level ${p.character.level}.`);
    this.hooks.journal?.(`${p.info.name} reached level ${p.character.level}.`, p.info.id);
  }

  /** The nearest tile of these kinds within a radius (see nearestTile). */
  nearestTile(x: number, y: number, kinds: Tile[], radius: number): { tile: Tile; x: number; y: number } | undefined {
    return nearestTile(this.map, x, y, kinds, radius);
  }

  /** Sends a player's character if it changed. */
  flush(p: PlayerState): void {
    if (!p.dirty) return;
    p.dirty = false;
    p.conn.send({ t: 'character', character: p.character });
  }

  /** A line in one player's log. */
  notice(p: PlayerState, text: string): void {
    p.conn.send({ t: 'notice', text });
  }

  /** Delivers a message to everyone within view of a point. */
  broadcastNear(at: { x: number; y: number }, message: ServerMessage): void {
    for (const p of this.players.values()) {
      if (Math.abs(p.x - at.x) <= VIEW_RADIUS && Math.abs(p.y - at.y) <= VIEW_RADIUS) p.conn.send(message);
    }
  }

  /** A system line for everyone in the region. */
  broadcastSystem(text: string): void {
    this.broadcast({ t: 'system', text, at: this.now() });
  }
}
