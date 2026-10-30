import type { ContentEntry, RegionDef } from '@co-mmo/shared';
import { Requests, type Bus } from './bus.ts';
import { GATEWAY, serverChannel, type Placement, type RegionHandle, type ServerLoad, type ToGateway, type ToServer, type WorldState } from './region-link.ts';
import type { SlowTickBuffer } from './debug/slow-tick-buffer.ts';
import type { Cell, Ghosts } from './region.ts';
import { RemoteRegion } from './remote-region.ts';
import type { Hosting, World } from './world.ts';

/** A region server that has not been heard from for this long is taken to be gone. */
export const DEAD_MS = 7000;

/** A region server as the gateway knows it. */
export interface ServerInfo {
  id: string;
  load: ServerLoad;
  /** When it was last heard from. */
  seen: number;
}

/** One host's state for God's View: the gateway itself, or a region server. */
export interface HostStatus {
  id: string;
  kind: 'gateway' | 'region-server';
  /** What runs there: whole regions, or cells of split ones (`part` of `parts`). */
  regions: { id: string; region: string; name: string; players: number; creatures: number; part?: number; parts?: number }[];
  players: number;
  load: ServerLoad;
  /** When it was last heard from. */
  seen: number;
}

/** Every host and the regions it runs: the gateway, then each region server. */
export function hostStatus(world: World, gateway: ServerLoad, servers: ServerInfo[] = [], now = Date.now()): HostStatus[] {
  const byHost = new Map<string, RegionHandle[]>();
  for (const unit of world.units()) byHost.set(unit.host, [...(byHost.get(unit.host) ?? []), unit]);
  const describe = (id: string) => {
    const units = byHost.get(id) ?? [];
    return {
      regions: units.map((r) => ({
        id: r.key, region: r.def.id, name: r.def.name, players: r.online, creatures: r.creatureIds().length,
        ...(r.cell ? { part: r.cell.index + 1, parts: r.cell.count } : {}),
      })),
      players: units.reduce((n, r) => n + r.online, 0),
    };
  };
  return [
    { id: 'gateway', kind: 'gateway', ...describe('gateway'), load: gateway, seen: now },
    ...servers.map((s): HostStatus => ({ id: s.id, kind: 'region-server', ...describe(s.id), load: s.load, seen: s.seen })),
  ];
}

export interface RegionServersOptions {
  now?: () => number;
  /** Every wish players see, for a region server that has just started. */
  content: () => ContentEntry[];
  /** How long a silent server is waited for; DEAD_MS unless a test says otherwise. */
  deadMs?: number;
  /** Buffer to record slow-tick events received from region servers. */
  slowTicks?: SlowTickBuffer;
}

/**
 * The coordinator (design doc, Scaling without a cap): keeps track of the
 * region servers, gives each region to one, and moves regions back here or
 * to another server when one goes away. Regions run here while no region
 * server is up, so the game never depends on one.
 */
export class RegionServers implements Hosting {
  private readonly servers = new Map<string, ServerInfo>();
  private readonly requests: Requests;
  private readonly now: () => number;
  private unsubscribe?: () => Promise<void>;
  private watchTimer?: ReturnType<typeof setInterval>;
  /** Where the next region set up should go, when the Owner asked for a particular host. */
  private wanted?: string;
  private stateQueued = false;
  /** Cells just given to each server, not yet among the world's regions, so the cells of one region spread out. */
  private readonly given = new Map<string, number>();
  /** Callback when a remote region server finishes recording a profile. */
  onProfileDone?: (m: { profileId: string; error?: string; data?: string }) => void;

  constructor(private readonly bus: Bus, private readonly world: World, private readonly options: RegionServersOptions) {
    this.requests = new Requests(bus, GATEWAY);
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    this.unsubscribe = await this.bus.subscribe(GATEWAY, (m) => this.receive(m as ToGateway));
    this.watchTimer = setInterval(() => this.watch(), 1000);
    this.watchTimer.unref?.();
  }

  async close(): Promise<void> {
    clearInterval(this.watchTimer);
    await this.unsubscribe?.();
    this.requests.failAll('The game server is shutting down.');
  }

  /** Region servers up now. */
  list(): ServerInfo[] {
    return [...this.servers.values()];
  }

  /** Starts recording a CPU profile or heap snapshot on a remote region server. */
  startProfile(server: string, profileId: string, durationSeconds: number, kind: 'cpu' | 'heap'): void {
    this.command(server, { t: 'start-profile', profileId, durationSeconds, kind });
  }

  /** Every host and what it runs, for God's View's Server health tab. */
  status(gateway: ServerLoad): HostStatus[] {
    return hostStatus(this.world, gateway, this.list(), this.now());
  }

  /**
   * Moves a region to another host ('gateway' or a region server's id), or
   * sets it up again where it is (a restart). Players inside are put back
   * where they stood.
   */
  async move(regionId: string, to: string): Promise<void> {
    if (to !== 'gateway' && !this.servers.has(to)) throw new Error('That region server is not running.');
    if (!this.world.region(regionId)) throw new Error('There is no such region.');
    this.wanted = to;
    try {
      await this.world.moveRegion(regionId);
    } finally {
      this.wanted = undefined;
    }
  }

  // --- Hosting ------------------------------------------------------------------

  host(def: RegionDef, placements: Placement[], _world: World, cell?: Cell): RegionHandle | undefined {
    const server = this.pick();
    if (!server) return undefined;
    if (!this.given.size) setImmediate(() => this.given.clear());
    this.given.set(server, (this.given.get(server) ?? 0) + 1);
    this.command(server, { t: 'host', region: def, placements, ...(cell ? { cell } : {}) });
    return new RemoteRegion(def, server, this.bus, this.requests, cell);
  }

  changed(): void {
    // Many changes come together (a player joins: where they are, their party); one message carries them all.
    if (this.stateQueued) return;
    this.stateQueued = true;
    setImmediate(() => {
      this.stateQueued = false;
      this.toAll({ t: 'world', state: this.world.state() });
    });
  }

  content(entries: ContentEntry[]): void {
    this.toAll({ t: 'content', entries });
  }

  /** The host for a new region: the one the Owner asked for, else the region server running fewest, else here. */
  private pick(): string | undefined {
    if (this.wanted) return this.wanted === 'gateway' ? undefined : this.wanted;
    const count = new Map<string, number>([...this.servers.keys()].map((id) => [id, this.given.get(id) ?? 0]));
    for (const unit of this.world.units()) if (count.has(unit.host)) count.set(unit.host, count.get(unit.host)! + 1);
    let best: string | undefined;
    for (const [id, n] of count) if (best === undefined || n < count.get(best)!) best = id;
    return best;
  }

  // --- Messages from region servers -------------------------------------------------

  private receive(m: ToGateway): void {
    if (m.t === 'answer') {
      this.requests.answered(m);
      return;
    }
    if (m.t === 'profile-done') {
      this.onProfileDone?.(m);
      return;
    }
    const server = m.server;
    if (m.t === 'hello') return void this.hello(server, m.load);
    if (m.t === 'bye') return void this.lost(server, 'it stopped');
    const known = this.servers.get(server);
    if (!known) {
      // A server from before this gateway started, or one given up for dead: it starts again from nothing.
      this.command(server, { t: 'reset' });
      return;
    }
    known.seen = this.now();
    if (m.t === 'slow-tick') {
      this.options.slowTicks?.push(m.record);
      return;
    }
    if (m.t === 'beat') {
      known.load = m.load;
      for (const beat of m.regions) this.remote(beat.id, server)?.beat(beat);
      return;
    }
    const region = this.remote(m.region, server);
    if (!region) return;
    if (m.t === 'out') return region.deliver(m.items);
    if (m.t === 'edge') return this.world.edge(m.region, m.ghosts as Ghosts);
    if (m.t === 'departures') return this.world.departed(m.region, m.list);
    // Things a region asks of the whole world.
    switch (m.hook) {
      case 'worldChat':
        return this.world.broadcast(m.m);
      case 'creator':
        return this.world.creatorCredit(m.thing, m.player, m.credit);
      case 'event':
        return this.world.onEvent?.(m.type, m.player, m.data);
      case 'route': {
        const why = this.world.route(m.m, m.to);
        if (why) this.world.sendTo(m.m.from.id, { t: 'error', code: 'chat_undelivered', message: why });
        return;
      }
      case 'journal':
        return this.world.onJournal?.(m.text, m.player);
      case 'regionChat':
        return this.world.region(region.def.id)?.broadcast(m.m);
    }
  }

  /** A region (or cell) run by this server, as long as it still runs there. */
  private remote(key: string, server: string): RemoteRegion | undefined {
    const region = this.world.unit(key);
    return region instanceof RemoteRegion && region.host === server ? region : undefined;
  }

  /** A region server started: it learns the world, then takes the regions running here. */
  private async hello(id: string, load: ServerLoad): Promise<void> {
    // The same server saying hello again lost what it ran (it restarted).
    if (this.servers.has(id)) await this.lost(id, 'it restarted');
    this.servers.set(id, { id, load, seen: this.now() });
    console.log(`Region server ${id} joined.`);
    this.command(id, { t: 'world', state: this.world.state() });
    this.command(id, { t: 'content', entries: this.options.content() });
    // Regions running here go out to the region servers.
    for (const region of [...this.world.regions.values()]) {
      const here = (region.cells ?? [region]).some((u) => u.host === 'gateway');
      if (here && this.servers.has(id)) await this.world.moveRegion(region.def.id);
    }
    await this.balance(id);
  }

  /**
   * Evens out the regions a new server takes from the busiest ones, moving
   * only regions nobody is in, so nobody notices.
   */
  private async balance(to: string): Promise<void> {
    const count = (host: string) => [...this.world.regions.values()].filter((r) => r.host === host).length;
    const fair = Math.floor(this.world.regions.size / Math.max(1, this.servers.size));
    for (const region of [...this.world.regions.values()]) {
      if (count(to) >= fair || !this.servers.has(to)) return;
      if (region.cells || region.host === to || region.host === 'gateway' || region.online > 0 || count(region.host) <= fair) continue;
      await this.move(region.def.id, to);
    }
  }

  /** A region server went away: its regions are set up again elsewhere, and their players with them. */
  private async lost(id: string, why: string): Promise<void> {
    if (!this.servers.delete(id)) return;
    console.warn(`Region server ${id} is gone (${why}); its regions move.`);
    for (const region of [...this.world.regions.values()]) {
      if ((region.cells ?? [region]).some((u) => u.host === id)) await this.world.moveRegion(region.def.id, { gone: id });
    }
  }

  /** Gives up on servers that stopped beating. */
  private watch(): void {
    const now = this.now();
    for (const s of this.servers.values()) {
      if (now - s.seen > (this.options.deadMs ?? DEAD_MS)) void this.lost(s.id, 'it stopped answering');
    }
  }

  private command(server: string, message: ToServer): void {
    this.bus.publish(serverChannel(server), message);
  }

  private toAll(message: ToServer): void {
    for (const id of this.servers.keys()) this.command(id, message);
  }
}
