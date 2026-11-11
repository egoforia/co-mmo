import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';
import { applyContent, DEFAULT_SKY, TICK_SECONDS, type ClientMessage, type ServerMessage, type SlowTickRecord } from '@co-mmo/shared';
import { answer, type Bus } from './bus.ts';
import { Region, type Cell, type Connection, type Departure, type Leaving } from './region.ts';
import { GATEWAY, carryData, carryFrom, serverChannel, type DepartureData, type LeavingData, type Outgoing, type Placement, type RegionBeat, type ServerLoad, type ToGateway, type ToServer, type WorldState } from './region-link.ts';
import { LoadMeter } from './load-meter.ts';
import { getProfilerConfig, recordProfileLocally } from './debug/profiler-session.ts';
import { aggregatePhaseTimings } from './region/profiler.ts';
import { empty } from './region/beyond.ts';

/** How often a region server tells the gateway it is alive and how busy it is. */
export const BEAT_MS = 2000;
/** How long a player let go of is remembered, ms, so inputs still on their way are sent on after them. */
const RELEASED_MS = 5000;

export interface RegionServerOptions {
  bus: Bus;
  /** Fixed in tests; otherwise made up at start. */
  id?: string;
  now?: () => number;
  random?: () => number;
  /** Runs the ticks itself (off in tests that tick by hand). */
  autoTick?: boolean;
  beatMs?: number;
  env?: Record<string, string | undefined>;
  slowTickThresholdMs?: number;
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
  /** Regions here whose last border had something in it. */
  private readonly bordered = new Set<string>();
  /**
   * The quicker path (NET_FAST_PATH, on unless `off`): snapshots go to the
   * gateway already written as text, and players walking off an edge or
   * falling are let go at once, passed on with the departure.
   */
  private readonly fast: boolean;
  /** Players let go of lately, by region and id: when. */
  private readonly released = new Map<string, number>();

  constructor(private readonly options: RegionServerOptions) {
    this.bus = options.bus;
    this.id = options.id ?? `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.fast = (options.env ?? process.env).NET_FAST_PATH?.trim().toLowerCase() !== 'off';
    this.meter = new LoadMeter(this.now, {
      slowTickThresholdMs: options.slowTickThresholdMs,
      phaseBreakdown: () => {
        const sources = [...this.regions.values()].map((r) => ({
          id: r.key,
          timings: r.profiler.timings(),
        }));
        return aggregatePhaseTimings(sources);
      },
      onSlowTick: (totalMs, tickErr) => {
        let slowestRegion: Region | undefined;
        let maxRegionMs = -1;
        let totalPlayers = 0;
        let totalCreatures = 0;
        let totalActiveStatuses = 0;
        const currentPhases: Record<string, number> = {};

        for (const r of this.regions.values()) {
          const c = r.counts();
          totalPlayers += c.players;
          totalCreatures += c.creatures;
          totalActiveStatuses += c.activeStatuses;

          const unitPhases = r.profiler.currentPhases();
          let unitTotal = 0;
          for (const [p, ms] of Object.entries(unitPhases)) {
            currentPhases[p] = Math.round(((currentPhases[p] ?? 0) + ms) * 100) / 100;
            unitTotal += ms;
          }
          if (unitTotal > maxRegionMs) {
            maxRegionMs = unitTotal;
            slowestRegion = r;
          }
        }

        const record: SlowTickRecord = {
          id: 0,
          at: this.now(),
          host: this.id,
          region: slowestRegion ? slowestRegion.key : this.id,
          ...(slowestRegion?.cell ? { cell: { index: slowestRegion.cell.index, count: slowestRegion.cell.count } } : {}),
          totalMs: Math.round(totalMs * 10) / 10,
          phases: currentPhases,
          players: slowestRegion ? slowestRegion.counts().players : totalPlayers,
          creatures: slowestRegion ? slowestRegion.counts().creatures : totalCreatures,
          activeStatuses: slowestRegion ? slowestRegion.counts().activeStatuses : totalActiveStatuses,
          ...(tickErr ? { error: (tickErr as Error).message ?? String(tickErr) } : {}),
        };

        this.toGateway({ t: 'slow-tick', server: this.id, record });
      },
    });
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
    this.meter.close();
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
    const old = this.now() - RELEASED_MS;
    for (const [key, at] of this.released) if (at < old) this.released.delete(key);
  }

  private tickRegions(): void {
    const strain = this.meter.strain;
    for (const region of this.regions.values()) {
      region.strain = strain;
      try {
        const departures = region.tick();
        if (departures.length) this.toGateway({ t: 'departures', server: this.id, region: region.key, list: departures.map((d) => this.depart(region, d)) });
        if (region.cell) this.toGateway({ t: 'edge', server: this.id, region: region.key, ghosts: region.edge() });
        this.border(region);
      } catch (err) {
        this.failed(err);
      }
    }
  }

  /**
   * A player leaving a region here. On the quicker path one walking off an
   * edge or falling is let go at once and passed on with the departure, so
   * the gateway moves them without asking back: one message, not three.
   * Crossing into the next cell stays the split region's business.
   */
  private depart(region: Region, d: Departure): DepartureData {
    const at = region.position(d.id) ?? { x: 0, y: 0 };
    if (!this.fast || d.cell !== undefined) return { ...d, x: at.x, y: at.y };
    const left = region.remove(d.id, '');
    if (!left) return { ...d, x: at.x, y: at.y };
    this.released.set(`${region.key} ${d.id}`, this.now());
    return { ...d, x: at.x, y: at.y, left: leavingData(left) };
  }

  /** Steps for a player here, or, for one just let go of, sent on after them through the gateway. */
  private input(region: string, id: string, m: ClientMessage): void {
    const r = this.regions.get(region);
    if (r?.has(id)) return r.handle(id, m);
    if (this.released.has(`${region} ${id}`)) this.toGateway({ t: 'bounce', server: this.id, region, id, m });
  }

  /** Shows the regions around this one what stands near its edges, while anyone is there to see (region/beyond.ts). */
  private border(region: Region): void {
    if (!this.world.borders?.includes(region.def.id)) {
      this.bordered.delete(region.key);
      return;
    }
    const ghosts = region.border();
    // Nothing near the edges is said once, so the neighbours forget what was.
    if (empty(ghosts) && !this.bordered.has(region.key)) return;
    if (empty(ghosts)) this.bordered.delete(region.key);
    else this.bordered.add(region.key);
    this.toGateway({ t: 'border', server: this.id, region: region.key, ghosts });
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
    if (m.t === 'start-profile') {
      void this.recordProfile(m.profileId, m.durationSeconds, m.kind);
      return;
    }
    if (m.t === 'content') {
      for (const entry of m.entries) applyContent(entry);
      return;
    }
    if (m.t === 'answer') return;
    if (m.t === 'inputs') {
      for (const [region, id, input] of m.list) this.input(region, id, input);
      return;
    }
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
        this.input(m.region, m.id, m.m);
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
      case 'beyond':
        region.seeBeyond(m.from, m.ghosts);
        return;
      case 'inspect': {
        const inspection = region.inspect(m.kind, m.id);
        answer(this.bus, m, inspection ?? null);
        return;
      }
      case 'watch-entity':
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
      sky: () => this.world.sky ?? DEFAULT_SKY,
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
      // A snapshot is written here, once, and passed on by the gateway as it is.
      send: (m: ServerMessage) => out(this.fast && m.t === 'snapshot'
        ? { to: player, text: JSON.stringify(m), tick: m.tick, s: { x: m.x, y: m.y, ack: m.ack, hp: m.hp, energy: m.energy } }
        : { to: player, m }),
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

  private async recordProfile(profileId: string, durationSeconds: number, kind: 'cpu' | 'heap'): Promise<void> {
    try {
      const config = getProfilerConfig(this.options.env);
      const ext = kind === 'cpu' ? 'cpuprofile' : 'heapsnapshot';
      const filePath = path.join(config.dir, `${profileId}.${ext}`);
      const { data } = await recordProfileLocally(filePath, kind, durationSeconds, config);
      this.toGateway({ t: 'profile-done', profileId, data });
    } catch (err) {
      this.toGateway({ t: 'profile-done', profileId, error: (err as Error).message });
    }
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
