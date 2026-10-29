import { generateRegion, type Character, type ClientMessage, type EntityInspection, type NpcPlacement, type PlayerInfo, type RegionDef, type RegionInfo, type RegionMap, type ServerMessage, type Tile } from '@co-mmo/shared';
import type { Bus, Requests } from './bus.ts';
import type { CharacterOp, OpResult } from './character-ops.ts';
import { findSpots, nearestTile, type Carry, type Cell, type Connection, type Departure, type Ghosts, type Leaving } from './region.ts';
import { carryData, carryFrom, serverChannel, type LeavingData, type Outgoing, type RegionBeat, type RegionHandle, type ToServer } from './region-link.ts';

interface Mirror {
  info: PlayerInfo;
  conn: Connection;
  x: number;
  y: number;
  character: Character;
  /** The last input the region server applied, so a player moved after a server failed is not sent back. */
  ack: number;
}

/**
 * A region running on a region server, as the gateway sees it. Commands go
 * to the server; what the server sends each player comes back here, on its
 * way to their socket, and keeps a copy of where they are and their
 * character, so the rest of the game can read them without asking.
 */
export class RemoteRegion implements RegionHandle {
  readonly map: RegionMap;
  private readonly players = new Map<string, Mirror>();
  private creatures: RegionBeat['creatures'] = [];

  constructor(readonly def: RegionDef, readonly host: string, private readonly bus: Bus, private readonly requests: Requests, readonly cell?: Cell) {
    // The land is made from the region's seed, the same here as there.
    this.map = generateRegion(def);
  }

  get key(): string {
    return this.cell?.key ?? this.def.id;
  }

  get info(): RegionInfo {
    return { id: this.def.id, name: this.def.name, def: this.def };
  }

  get online(): number {
    return this.players.size;
  }

  playerIds(): string[] {
    return [...this.players.keys()];
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  nameOf(id: string): string | undefined {
    return this.players.get(id)?.info.name;
  }

  position(id: string): { x: number; y: number } | undefined {
    const p = this.players.get(id);
    return p && { x: p.x, y: p.y };
  }

  character(id: string): Character | undefined {
    return this.players.get(id)?.character;
  }

  creatureIds(): string[] {
    return this.creatures.filter((c) => c.alive).map((c) => c.id);
  }

  creature(id: string): { kind: string; x: number; y: number; hp: number; alive: boolean } | undefined {
    const c = this.creatures.find((k) => k.id === id);
    return c && { kind: c.kind, x: c.x, y: c.y, hp: c.hp, alive: c.alive };
  }

  findSpots(x: number, y: number, count: number, min?: number, max?: number): { x: number; y: number }[] {
    return findSpots(this.map, x, y, count, min, max);
  }

  nearTile(id: string, tile: Tile, radius: number): boolean {
    const p = this.players.get(id);
    return Boolean(p && nearestTile(this.map, p.x, p.y, [tile], radius));
  }

  nearby(id: string): Promise<string[]> {
    return this.requests.ask<string[]>(this.channel, { t: 'nearby', region: this.key, id }).catch(() => []);
  }

  change(id: string, op: CharacterOp): Promise<OpResult> {
    return this.requests.ask<OpResult>(this.channel, { t: 'change', region: this.key, id, op }).catch(() => ({ ok: false }));
  }

  tell(id: string, text: string): void {
    this.command({ t: 'tell', region: this.key, id, text });
  }

  announce(text: string): void {
    this.command({ t: 'announce', region: this.key, text });
  }

  send(id: string, message: ServerMessage): void {
    // Straight to the player: nothing the region server needs to see.
    this.players.get(id)?.conn.send(message);
  }

  broadcast(message: ServerMessage): void {
    // Wish news also tells the region server what now exists.
    if (message.t === 'content') this.command({ t: 'broadcast', region: this.key, m: message });
    else for (const p of this.players.values()) p.conn.send(message);
  }

  addCreatures(kind: string, spots: { x: number; y: number; n?: number }[]): void {
    this.command({ t: 'place', region: this.key, placement: { kind: 'creatures', id: kind, spots } });
  }

  addNpc(npc: NpcPlacement): void {
    this.command({ t: 'place', region: this.key, placement: { kind: 'npc', npc } });
  }

  removeWish(id: string): void {
    this.command({ t: 'unplace', region: this.key, id });
  }

  setExits(exits: RegionDef['exits']): void {
    this.def.exits = exits;
    const fresh = generateRegion(this.def);
    this.map.tiles.set(fresh.tiles);
    this.map.entries = fresh.entries;
    this.command({ t: 'exits', region: this.key, exits });
  }

  welcomeAll(): void {
    this.command({ t: 'welcome-all', region: this.key });
  }

  join(info: PlayerInfo, conn: Connection, at: { x: number | null; y: number | null; floor?: number }, character: Character, announce?: string, carry?: Carry, handoff?: boolean): void {
    this.players.set(info.id, { info, conn, x: at.x ?? this.map.spawn.x, y: at.y ?? this.map.spawn.y, character, ack: carry?.ack ?? 0 });
    this.command({ t: 'join', region: this.key, info, at, character, ...(announce !== undefined ? { announce } : {}), ...(carry ? { carry: carryData(carry) } : {}), ...(handoff ? { handoff } : {}) });
  }

  async remove(id: string, announce?: string): Promise<Leaving | undefined> {
    const mirror = this.players.get(id);
    if (!mirror) return undefined;
    // Nothing more for this player passes through here, whatever the server says.
    this.players.delete(id);
    const left = await this.requests.ask<LeavingData | null>(this.channel, { t: 'remove', region: this.key, id, ...(announce !== undefined ? { announce } : {}) })
      .catch(() => null);
    // A server that did not answer is taken to have lost the player where they were last seen.
    if (!left) return { info: mirror.info, conn: mirror.conn, character: mirror.character, x: mirror.x, y: mirror.y, carry: lostCarry(mirror) };
    return { info: left.info, conn: mirror.conn, character: left.character, x: left.x, y: left.y, carry: carryFrom(left.carry) };
  }

  /**
   * Takes everyone out at once, to set the region up somewhere else. A server
   * that is gone cannot answer, so its players are moved from what they were
   * last sent.
   */
  async drop(reachable: boolean): Promise<Leaving[]> {
    const mirrors = new Map(this.players);
    this.players.clear();
    const left = reachable ? await this.requests.ask<LeavingData[]>(this.channel, { t: 'drop', region: this.key }).catch(() => null) : null;
    if (!left) return [...mirrors.values()].map((m) => ({ info: m.info, conn: m.conn, character: m.character, x: m.x, y: m.y, carry: lostCarry(m) }));
    return left.flatMap((l) => {
      const mirror = mirrors.get(l.info.id);
      return mirror ? [{ info: l.info, conn: mirror.conn, character: l.character, x: l.x, y: l.y, carry: carryFrom(l.carry) }] : [];
    });
  }

  handle(id: string, message: ClientMessage): void {
    if (this.players.has(id)) this.command({ t: 'input', region: this.key, id, m: message });
  }

  tick(): Departure[] {
    return [];
  }

  seeAcross(from: number, ghosts: Ghosts): void {
    this.command({ t: 'ghosts', region: this.key, from, ghosts });
  }

  /** Messages from the region server for players here: passed on, and remembered. */
  deliver(items: Outgoing[]): void {
    for (const item of items) {
      if ('close' in item) {
        this.players.get(item.close)?.conn.close(item.reason);
        continue;
      }
      const p = this.players.get(item.to);
      if (!p) continue;
      const m = item.m;
      if (m.t === 'snapshot') {
        p.x = m.x;
        p.y = m.y;
        p.ack = m.ack;
        p.character.hp = m.hp;
        p.character.energy = m.energy;
      } else if (m.t === 'character') {
        p.character = m.character;
      } else if (m.t === 'welcome') {
        p.x = m.x;
        p.y = m.y;
        p.character = m.character;
      }
      p.conn.send(m);
    }
  }

  /** Where a departing player stood when the region server let them go. */
  moved(id: string, x: number, y: number): void {
    const p = this.players.get(id);
    if (p) Object.assign(p, { x, y });
  }

  /** The region server's latest word on its creatures, for God's View. */
  beat(beat: RegionBeat): void {
    this.creatures = beat.creatures;
  }

  /** Asks the remote region server for live inspection of an entity. */
  async inspect(kind: 'player' | 'creature', id: string): Promise<EntityInspection | undefined> {
    const result = await this.requests.ask<EntityInspection | null>(this.channel, {
      t: 'inspect', region: this.key, kind, id,
    });
    return result ?? undefined;
  }

  private get channel(): string {
    return serverChannel(this.host);
  }

  private command(message: ToServer): void {
    this.bus.publish(this.channel, message);
  }
}

/** What carries over for a player whose region server is gone: only the last input it applied. */
function lostCarry(m: Mirror): Carry {
  return { ack: m.ack, inputs: [], lastAttack: 0, lastHurt: 0, readyAt: new Map() };
}
