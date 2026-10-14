import {
  MAX_CHAT_LENGTH,
  SAY_RADIUS,
  TICK_RATE,
  TICK_SECONDS,
  VIEW_RADIUS,
  collides,
  generateRegion,
  outsideSide,
  step,
  type ChatChannel,
  type ClientMessage,
  type CreatureState,
  type EntityState,
  type PlayerInfo,
  type RegionDef,
  type RegionInfo,
  type RegionMap,
  type ServerMessage,
  type Side,
} from '@co-mmo/shared';

/** Inputs a player may queue; extra inputs are dropped (anti speed-hack). */
const MAX_QUEUED_INPUTS = 10;
/** Inputs applied per player per tick; lets a lagging client catch up a little. */
const MAX_INPUTS_PER_TICK = 2;
/** Chat flood limit: at most this many messages per window. */
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5000;
/** Creatures stroll at this speed (tiles per second) within this many tiles of home. */
const CREATURE_SPEED = 1.5;
const WANDER_RADIUS = 4;

export interface Connection {
  send(message: ServerMessage): void;
  close(reason: string): void;
}

/** What a region needs from the world around it. */
export interface RegionHooks {
  /** Delivers a World-channel message to every region. */
  worldChat(message: ServerMessage): void;
  /** Players online across the whole world. */
  online(): number;
}

interface PlayerState {
  info: PlayerInfo;
  conn: Connection;
  x: number;
  y: number;
  inputs: { seq: number; dx: number; dy: number }[];
  ack: number;
  chatTimes: number[];
}

interface Creature {
  id: string;
  asset: string;
  name: string;
  x: number;
  y: number;
  home: { x: number; y: number };
  target: { x: number; y: number } | null;
  /** Ticks to rest before choosing the next spot. */
  rest: number;
}

export interface Departure {
  id: string;
  side: Side;
}

/**
 * One region of the world, simulated authoritatively. A region knows nothing
 * about sockets or storage: it talks to players through `Connection`, so it
 * can run in tests, and later in its own process per region.
 */
export class Region {
  readonly map: RegionMap;
  private readonly players = new Map<string, PlayerState>();
  private readonly creatures: Creature[];
  private tickCount = 0;

  private readonly hooks: RegionHooks;

  constructor(
    readonly def: RegionDef,
    hooks?: RegionHooks,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {
    // A region on its own is a world of one.
    this.hooks = hooks ?? { worldChat: (m) => this.broadcast(m), online: () => this.players.size };
    this.map = generateRegion(def);
    this.creatures = this.map.creatures.map((c, i) => ({
      id: `${def.id}-${c.kind}-${i}`,
      asset: c.asset,
      name: c.name,
      x: c.x,
      y: c.y,
      home: { x: c.x, y: c.y },
      target: null,
      rest: Math.floor(this.random() * TICK_RATE * 3),
    }));
  }

  get info(): RegionInfo {
    return { id: this.def.id, name: this.def.name };
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

  /**
   * Adds a player at the given position, or at the spawn point when it is
   * missing or no longer walkable (a wish may have changed the map).
   */
  join(info: PlayerInfo, conn: Connection, at: { x: number | null; y: number | null }, announce?: string): void {
    const existing = this.players.get(info.id);
    if (existing) {
      existing.conn.close('Signed in from another window.');
      this.players.delete(info.id);
    }
    let { x, y } = this.map.spawn;
    if (at.x !== null && at.y !== null && !outsideSide(this.map, at.x, at.y) && !collides(this.map, at.x, at.y)) {
      x = at.x;
      y = at.y;
    }
    this.players.set(info.id, { info, conn, x, y, inputs: [], ack: 0, chatTimes: [] });
    conn.send({ t: 'welcome', you: info, region: this.info, x, y, tickRate: TICK_RATE });
    this.broadcastSystem(announce ?? `${info.name} entered ${this.def.name}.`);
  }

  /** Removes a player, announcing why; returns what the world needs to move them on. */
  remove(id: string, announce?: string): { info: PlayerInfo; conn: Connection; x: number; y: number } | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    this.players.delete(id);
    this.broadcastSystem(announce ?? `${p.info.name} left.`);
    return { info: p.info, conn: p.conn, x: p.x, y: p.y };
  }

  handle(id: string, message: ClientMessage): void {
    const p = this.players.get(id);
    if (!p) return;
    if (message.t === 'input') {
      if (message.seq <= p.ack) return;
      if (p.inputs.length >= MAX_QUEUED_INPUTS) return;
      p.inputs.push({ seq: message.seq, dx: message.dx, dy: message.dy });
    } else if (message.t === 'chat') {
      this.chat(p, message.channel, message.text);
    }
  }

  /** Delivers a message to everyone in this region. */
  broadcast(message: ServerMessage): void {
    for (const p of this.players.values()) p.conn.send(message);
  }

  /**
   * Advances the simulation one tick and sends each player a snapshot.
   * Returns players who walked off an open edge, for the world to move.
   */
  tick(): Departure[] {
    this.tickCount++;
    const departures: Departure[] = [];
    for (const p of this.players.values()) {
      const batch = p.inputs.splice(0, MAX_INPUTS_PER_TICK);
      for (const input of batch) {
        const next = step(this.map, p, input.dx, input.dy);
        p.x = next.x;
        p.y = next.y;
        p.ack = input.seq;
      }
      const side = outsideSide(this.map, p.x, p.y);
      if (side) departures.push({ id: p.info.id, side });
    }
    for (const c of this.creatures) this.wander(c);

    const all = [...this.players.values()];
    const online = this.hooks.online();
    for (const p of all) {
      const near = (x: number, y: number) => Math.abs(x - p.x) <= VIEW_RADIUS && Math.abs(y - p.y) <= VIEW_RADIUS;
      const players: EntityState[] = [];
      for (const other of all) {
        if (other === p || !near(other.x, other.y)) continue;
        players.push({ id: other.info.id, name: other.info.name, color: other.info.color, x: round(other.x), y: round(other.y) });
      }
      const creatures: CreatureState[] = [];
      for (const c of this.creatures) {
        if (near(c.x, c.y)) creatures.push({ id: c.id, asset: c.asset, name: c.name, x: round(c.x), y: round(c.y) });
      }
      p.conn.send({ t: 'snapshot', tick: this.tickCount, ack: p.ack, x: p.x, y: p.y, players, creatures, online });
    }
    return departures;
  }

  /** Creatures stroll between spots near home, resting in between. */
  private wander(c: Creature): void {
    if (!c.target) {
      if (c.rest-- > 0) return;
      for (let tries = 0; tries < 5 && !c.target; tries++) {
        const angle = this.random() * Math.PI * 2;
        const dist = 1 + this.random() * (WANDER_RADIUS - 1);
        const t = { x: c.home.x + Math.cos(angle) * dist, y: c.home.y + Math.sin(angle) * dist };
        if (!outsideSide(this.map, t.x, t.y) && !collides(this.map, t.x, t.y)) c.target = t;
      }
      if (!c.target) c.rest = TICK_RATE;
      return;
    }
    const dx = c.target.x - c.x;
    const dy = c.target.y - c.y;
    const dist = Math.hypot(dx, dy);
    const stepLen = CREATURE_SPEED * TICK_SECONDS;
    if (dist <= stepLen) {
      c.x = c.target.x;
      c.y = c.target.y;
      c.target = null;
      c.rest = Math.floor(TICK_RATE * (1 + this.random() * 3));
      return;
    }
    const nx = c.x + (dx / dist) * stepLen;
    const ny = c.y + (dy / dist) * stepLen;
    if (collides(this.map, nx, ny)) {
      c.target = null;
      c.rest = TICK_RATE;
      return;
    }
    c.x = nx;
    c.y = ny;
  }

  private chat(from: PlayerState, channel: ChatChannel, raw: string): void {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) return;
    const now = this.now();
    from.chatTimes = from.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (from.chatTimes.length >= CHAT_BURST) {
      from.conn.send({ t: 'error', code: 'chat_rate', message: 'You are speaking too fast. Wait a moment.' });
      return;
    }
    from.chatTimes.push(now);
    const message: ServerMessage = { t: 'chat', channel, from: { id: from.info.id, name: from.info.name }, text, at: now };
    if (channel === 'world') {
      this.hooks.worldChat(message);
      return;
    }
    for (const p of this.players.values()) {
      if (Math.hypot(p.x - from.x, p.y - from.y) <= SAY_RADIUS) p.conn.send(message);
    }
  }

  private broadcastSystem(text: string): void {
    this.broadcast({ t: 'system', text, at: this.now() });
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
