import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { applyContent, TICK_SECONDS, type ServerMessage } from '@co-mmo/shared';
import { answer, type Bus } from './bus.ts';
import { Region, type Cell, type Connection, type Leaving } from './region.ts';
import { GATEWAY, carryData, carryFrom, serverChannel, type LeavingData, type Outgoing, type Placement, type RegionBeat, type ServerLoad, type ToGateway, type ToServer, type WorldState } from './region-link.ts';
import { LoadMeter } from './load-meter.ts';

/** How often a region server tells the gateway it is alive and how busy it is. */
export const BEAT_MS = 2000;

export interface RegionServerOptions {
  bus: Bus;
  /** Fixed in tests; otherwise made up at start. */
  id?: string;
  now?: () => number;
  random?: () => number;
  /** Runs the ticks itself (off in tests that tick by hand). */
  autoTick?: boolean;
  beatMs?: number;
}

/**
 * A region server: runs the simulation of the regions the gateway gives it
 * (design doc, Scaling without a cap). It keeps no sockets and no storage;
 * players' messages go back through the gateway, and anything that touches
 * the rest of the world (World chat, parties, rules, Creator XP) is passed
 * to the gateway to decide.
 */
export class RegionServer {
  readonly id: string;
  private readonly bus: Bus;
  private readonly regions = new Map<string, Region>();
  private world: WorldState = { defs: [], online: 0, parties: {} };
  /** Messages for players, sent in one go per region after each tick or batch of requests. */
  private readonly outbox = new Map<string, Outgoing[]>();
  private flushing = false;
  private readonly now: () => number;
  private readonly random: () => number;
  private tickTimer?: ReturnType<typeof setInterval>;
  private beatTimer?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => Promise<void>;
  private readonly meter: LoadMeter;

  constructor(private readonly options: RegionServerOptions) {
    this.bus = options.bus;
    this.id = options.id ?? `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.meter = new LoadMeter(this.now);
  }

  /** Starts listening, says hello, and starts ticking. */
  async start(): Promise<void> {
    this.unsubscribe = await this.bus.subscribe(serverChannel(this.id), (m) => this.receive(m as ToServer));
    this.toGateway({ t: 'hello', server: this.id, load: this.load() });
    this.beatTimer = setInterval(() => this.beat(), this.options.beatMs ?? BEAT_MS);
    this.beatTimer.unref?.();
    if (this.options.autoTick !== false) this.tickTimer = setInterval(() => this.tick(), TICK_SECONDS * 1000);
  }

  /** Says goodbye, so the gateway takes the regions back at once rather than waiting to miss beats. */
  async stop(): Promise<void> {
    clearInterval(this.tickTimer);
    clearInterval(this.beatTimer);
    this.toGateway({ t: 'bye', server: this.id });
    await this.unsubscribe?.();
  }

  /** Regions hosted here, for tests and tools. */
  hosted(): string[] {
    return [...this.regions.keys()];
  }

  region(id: string): Region | undefined {
    return this.regions.get(id);
  }

  /** One tick of every region here; departures and messages go to the gateway. */
  tick(): void {
    this.meter.tick(() => this.tickRegions());
    this.flush();
  }

  private tickRegions(): void {
    const strain = this.meter.strain;
    for (const region of this.regions.values()) {
      region.strain = strain;
      try {
        const departures = region.tick();
        if (departures.length) {
          this.toGateway({
            t: 'departures', server: this.id, region: region.key,
            list: departures.map((d) => ({ ...d, ...(region.position(d.id) ?? { x: 0, y: 0 }) })),
          });
        }
        if (region.cell) this.toGateway({ t: 'edge', server: this.id, region: region.key, ghosts: region.edge() });
      } catch (err) {
        this.failed(err);
      }
    }
  }

  private receive(m: ToServer): void {
    try {
      this.handle(m);
    } catch (err) {
      this.failed(err);
      if ('ask' in m && m.ask !== undefined) answer(this.bus, m, undefined, (err as Error).message);
    }
    this.flushSoon();
  }

  private handle(m: ToServer): void {
    if (m.t === 'reset') {
      for (const id of [...this.regions.keys()]) this.regions.delete(id);
      this.toGateway({ t: 'hello', server: this.id, load: this.load() });
      return;
    }
    if (m.t === 'world') {
      this.world = m.state;
      return;
    }
    if (m.t === 'content') {
      for (const entry of m.entries) applyContent(entry);
      return;
    }
    if (m.t === 'answer') return;
    if (m.t === 'host') {
      const region = this.makeRegion(m.region, m.cell);
      for (const p of m.placements) place(region, p);
      this.regions.set(region.key, region);
      return;
    }
    const region = this.regions.get(m.region);
    if (!region) {
      if ('ask' in m && m.ask !== undefined) answer(this.bus, m, undefined, `Region ${m.region} is not here.`);
      return;
    }
    switch (m.t) {
      case 'drop': {
        const leaving = region.playerIds().map((id) => region.remove(id, '')).filter((l): l is Leaving => Boolean(l)).map(leavingData);
        this.regions.delete(m.region);
        answer(this.bus, m, leaving);
        return;
      }
      case 'join':
        region.join(m.info, this.relay(m.region, m.info.id), m.at, m.character, m.announce, m.carry && carryFrom(m.carry), m.handoff);
        return;
      case 'remove': {
        const left = region.remove(m.id, m.announce);
        answer(this.bus, m, left ? leavingData(left) : null);
        return;
      }
      case 'input':
        region.handle(m.id, m.m);
        return;
      case 'change':
        answer(this.bus, m, region.change(m.id, m.op));
        return;
      case 'nearby':
        answer(this.bus, m, region.nearby(m.id));
        return;
      case 'tell':
        region.tell(m.id, m.text);
        return;
      case 'announce':
        region.announce(m.text);
        return;
      case 'send':
        region.send(m.id, m.m);
        return;
      case 'broadcast':
        // Wish news carries the content every server must know.
        if (m.m.t === 'content') for (const entry of m.m.entries) applyContent(entry);
        region.broadcast(m.m);
        return;
      case 'place':
        place(region, m.placement);
        return;
      case 'unplace':
        region.removeWish(m.id);
        return;
      case 'exits':
        region.setExits(m.exits);
        return;
      case 'welcome-all':
        region.welcomeAll();
        return;
      case 'ghosts':
        region.seeAcross(m.from, m.ghosts);
        return;
    }
  }

  private makeRegion(def: WorldState['defs'][number], cell?: Cell): Region {
    const id = cell?.key ?? def.id;
    const region: Region = new Region(def, {
      worldChat: (m) => this.hook(id, { hook: 'worldChat', m }),
      online: () => this.world.online,
      creator: (thing, player, credit) => this.hook(id, { hook: 'creator', thing, player, credit }),
      event: (type, player, data) => this.hook(id, { hook: 'event', type, player, data }),
      // Party and whisper lines cross regions: the gateway delivers them, and says so if it cannot.
      route: (m, to) => this.hook(id, { hook: 'route', m, ...(to !== undefined ? { to } : {}) }),
      party: (player) => this.world.parties[player] ?? [player],
      journal: (text, player) => this.hook(id, { hook: 'journal', text, player }),
      // A cell's Region channel reaches the cells beside it through the gateway.
      ...(cell ? { regionChat: (m: ServerMessage) => this.hook(id, { hook: 'regionChat', m }) } : {}),
      neighbours: () => this.world.defs.filter((d) => d.id !== def.id && Math.max(Math.abs(d.at.x - region.def.at.x), Math.abs(d.at.y - region.def.at.y)) === 1),
    }, this.now, this.random, cell);
    return region;
  }

  private hook(region: string, hook: Record<string, unknown>): void {
    // Messages the region sent its players first, so they arrive in order.
    this.flush();
    this.toGateway({ t: 'hook', server: this.id, region, ...hook } as ToGateway);
  }

  /** A player's connection here: what the region sends them goes to the gateway, which holds their socket. */
  private relay(region: string, player: string): Connection {
    const out = (item: Outgoing) => {
      let items = this.outbox.get(region);
      if (!items) this.outbox.set(region, (items = []));
      items.push(item);
    };
    return {
      send: (m: ServerMessage) => out({ to: player, m }),
      close: (reason: string) => out({ close: player, reason }),
    };
  }

  private flushSoon(): void {
    if (this.flushing) return;
    this.flushing = true;
    setImmediate(() => {
      this.flushing = false;
      this.flush();
    });
  }

  private flush(): void {
    for (const [region, items] of this.outbox) {
      if (items.length) this.toGateway({ t: 'out', server: this.id, region, items });
    }
    this.outbox.clear();
  }

  private beat(): void {
    const regions: RegionBeat[] = [...this.regions.values()].map((r) => ({
      id: r.key,
      players: r.online,
      creatures: r.creatureIds().map((id) => ({ id, ...r.creature(id)! })),
    }));
    this.toGateway({ t: 'beat', server: this.id, load: this.load(), regions });
  }

  private load(): ServerLoad {
    return this.meter.load();
  }

  private failed(err: unknown): void {
    this.meter.failed(err, 'Region server error');
  }

  private toGateway(message: ToGateway): void {
    this.bus.publish(GATEWAY, message);
  }
}

/** Places a wished thing in a region. */
export function place(region: Pick<Region, 'addCreatures' | 'addNpc'>, p: Placement): void {
  if (p.kind === 'creatures') region.addCreatures(p.id, p.spots);
  else region.addNpc(p.npc);
}

function leavingData(left: Leaving): LeavingData {
  return { info: left.info, character: left.character, x: left.x, y: left.y, carry: carryData(left.carry) };
}
