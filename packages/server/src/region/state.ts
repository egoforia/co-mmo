import {
  wisherOf,
  VIEW_RADIUS,
  Tile,
  type Character,
  type CreatorCredit,
  type CreatureDef,
  type InventorySlot,
  type PlayerInfo,
  type RegionMap,
  type ServerMessage,
  type Status,
} from '@co-mmo/shared';
import type { Connection, RegionHooks } from '../region.ts';
import type { Creature } from '../creature-brain.ts';
import type { GaugeState } from './gauges.ts';
import type { Townsperson } from '../townsfolk.ts';
import { nearestTile } from '../walkers.ts';

export type { Creature } from '../creature-brain.ts';
export type { Townsperson } from '../townsfolk.ts';

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
  /** The floor they are on (floors.ts): 0 the ground. */
  floor: number;
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
  /** While Fallen at 0 HP (region/fallen.ts): when they wake at the shrine, epoch ms. */
  fallenUntil?: number;
  /** Running statuses (region/statuses.ts) and when a new stun can take again. */
  statuses: Status[];
  stunImmuneUntil?: number;
  /** The way they last walked, one step long: blinks and cones go this way when no creature is chosen. */
  facing?: { dx: number; dy: number };
  /** The stance they hold (effects/stance.ts), until used again or out of Energy. */
  stance?: { ability: string; amount: number };
  /** Their Calling's signature gauge (region/gauges.ts), once they have one. */
  gauge?: GaugeState;
}

/** A trap a player set (effects/trap.ts): it springs on the first creature to step close. */
export interface Trap {
  owner: string;
  ability: string;
  x: number;
  y: number;
  floor: number;
  radius: number;
  amount: number;
  /** Epoch ms when it crumbles unsprung. */
  until: number;
}

/** A summoned helper (effects/summon.ts): it stays by its owner and strikes what is near. */
export interface Helper {
  owner: string;
  ability: string;
  amount: number;
  radius: number;
  until: number;
  /** Epoch ms of its next strike. */
  nextAt: number;
}

/** A defeated creature's body: what it dropped waits there for anyone to take. */
export interface Body {
  id: string;
  kind: string;
  def: CreatureDef;
  x: number;
  y: number;
  floor: number;
  /** Epoch ms when it fades away. */
  until: number;
  /** Who won it: the one who struck the last blow and party members who shared the fight. They hear what others take. */
  finders: string[];
  loot: InventorySlot[];
}

/** The people, creatures, NPCs and bodies in one region (or cell), and how to reach its players. */
export class RegionState {
  readonly players = new Map<string, PlayerState>();
  creatures: Creature[] = [];
  /** Bodies of defeated creatures, until they fade. */
  bodies: Body[] = [];
  bodyCount = 0;
  /** Traps set and helpers summoned by players here. */
  traps: Trap[] = [];
  helpers: Helper[] = [];
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

  /** The nearest tile of these kinds within a radius, on a floor (see nearestTile). */
  nearestTile(x: number, y: number, kinds: Tile[], radius: number, floor = 0): { tile: Tile; x: number; y: number } | undefined {
    return nearestTile(this.map, x, y, kinds, radius, floor);
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
