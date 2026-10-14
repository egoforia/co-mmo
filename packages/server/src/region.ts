import {
  MAX_CHAT_LENGTH,
  SAY_RADIUS,
  TICK_RATE,
  VIEW_RADIUS,
  collides,
  generateSanctum,
  step,
  type ChatChannel,
  type ClientMessage,
  type EntityState,
  type PlayerInfo,
  type RegionInfo,
  type RegionMap,
  type ServerMessage,
} from '@co-mmo/shared';

/** Inputs a player may queue; extra inputs are dropped (anti speed-hack). */
const MAX_QUEUED_INPUTS = 10;
/** Inputs applied per player per tick; lets a lagging client catch up a little. */
const MAX_INPUTS_PER_TICK = 2;
/** Chat flood limit: at most this many messages per window. */
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5000;

export interface Connection {
  send(message: ServerMessage): void;
  close(reason: string): void;
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

/**
 * One region of the world, simulated authoritatively. A region knows nothing
 * about sockets or storage: it talks to players through `Connection`, so it
 * can run in tests, and later in its own process per region.
 */
export class Region {
  readonly map: RegionMap;
  private readonly players = new Map<string, PlayerState>();
  private tickCount = 0;

  constructor(readonly info: Omit<RegionInfo, 'width' | 'height'>, private readonly now: () => number = Date.now) {
    this.map = generateSanctum(info.seed);
  }

  get regionInfo(): RegionInfo {
    return { ...this.info, width: this.map.width, height: this.map.height };
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

  position(id: string): { x: number; y: number } | undefined {
    const p = this.players.get(id);
    return p && { x: p.x, y: p.y };
  }

  /**
   * Adds a player at their saved position, or at the spawn point when the
   * saved spot is missing or no longer walkable (a wish may have changed it).
   */
  join(info: PlayerInfo, conn: Connection, saved: { x: number | null; y: number | null }): void {
    const existing = this.players.get(info.id);
    if (existing) {
      existing.conn.close('Signed in from another window.');
      this.players.delete(info.id);
    }
    let { x, y } = this.map.spawn;
    if (saved.x !== null && saved.y !== null && !collides(this.map, saved.x, saved.y)) {
      x = saved.x;
      y = saved.y;
    }
    this.players.set(info.id, { info, conn, x, y, inputs: [], ack: 0, chatTimes: [] });
    conn.send({ t: 'welcome', you: info, region: this.regionInfo, x, y, tickRate: TICK_RATE });
    this.broadcastSystem(`${info.name} entered ${this.info.name}.`);
  }

  leave(id: string): { x: number; y: number } | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    this.players.delete(id);
    this.broadcastSystem(`${p.info.name} left.`);
    return { x: p.x, y: p.y };
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

  /** Advances the simulation one tick and sends each player a snapshot. */
  tick(): void {
    this.tickCount++;
    for (const p of this.players.values()) {
      const batch = p.inputs.splice(0, MAX_INPUTS_PER_TICK);
      for (const input of batch) {
        const next = step(this.map, p, input.dx, input.dy);
        p.x = next.x;
        p.y = next.y;
        p.ack = input.seq;
      }
    }
    const all = [...this.players.values()];
    for (const p of all) {
      const visible: EntityState[] = [];
      for (const other of all) {
        if (other === p) continue;
        if (Math.abs(other.x - p.x) > VIEW_RADIUS || Math.abs(other.y - p.y) > VIEW_RADIUS) continue;
        visible.push({ id: other.info.id, name: other.info.name, color: other.info.color, x: round(other.x), y: round(other.y) });
      }
      p.conn.send({
        t: 'snapshot',
        tick: this.tickCount,
        ack: p.ack,
        x: p.x,
        y: p.y,
        players: visible,
        online: all.length,
      });
    }
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
    const message: ServerMessage = {
      t: 'chat',
      channel,
      from: { id: from.info.id, name: from.info.name },
      text,
      at: now,
    };
    for (const p of this.players.values()) {
      if (channel === 'say' && Math.hypot(p.x - from.x, p.y - from.y) > SAY_RADIUS) continue;
      p.conn.send(message);
    }
  }

  private broadcastSystem(text: string): void {
    const message: ServerMessage = { t: 'system', text, at: this.now() };
    for (const p of this.players.values()) p.conn.send(message);
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
