import { afterEach, describe, expect, it } from 'vitest';
import { newCharacter, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { MemoryBus } from '../src/bus.ts';
import type { Connection } from '../src/region.ts';
import { RegionServer } from '../src/region-server.ts';
import { RegionServers } from '../src/region-servers.ts';
import { World } from '../src/world.ts';
import { account, api, app, joined, start, wish } from './helpers.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[]; closed: string | null } = {
    messages,
    closed: null,
    send: (m) => messages.push(m),
    close(reason) {
      this.closed = reason;
    },
  };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });

/** Lets messages on the bus (delivered a moment later, as over Redis) arrive and be answered. */
async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

async function until(test: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const running: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) await r.stop();
});

/** A gateway's world with its coordinator, on a bus in this process. */
async function gateway(options: { deadMs?: number } = {}) {
  const bus = new MemoryBus();
  const world = new World(() => Date.now(), () => 0.5);
  const servers = new RegionServers(bus, world, { content: () => [], ...options });
  world.hosting = servers;
  await servers.start();
  running.push({ stop: () => servers.close() });
  const server = async (id: string, beatMs?: number) => {
    const s = new RegionServer({ bus, id, autoTick: false, random: () => 0.5, ...(beatMs ? { beatMs } : {}) });
    await s.start();
    running.push(s);
    await settle();
    return s;
  };
  return { bus, world, servers, server };
}

describe('regions on region servers', () => {
  it('runs every region here until a region server starts, then moves them to it', async () => {
    const { world, server } = await gateway();
    expect([...world.regions.values()].every((r) => r.host === 'gateway')).toBe(true);
    const a = await server('a');
    await until(() => [...world.regions.values()].every((r) => r.host === 'a'));
    expect(a.hosted().sort()).toEqual(['desert', 'sanctum', 'shore', 'woods']);
    // A second server takes its share of the regions nobody is in.
    const b = await server('b');
    await until(() => b.hosted().length === 2);
    expect(a.hosted()).toHaveLength(2);
  });

  it('plays a region on a region server: welcome, steps and snapshots come back through the gateway', async () => {
    const { world, server } = await gateway();
    const a = await server('a');
    await until(() => world.home.host === 'a');
    const conn = fakeConn();
    world.join(info('m', 'Mara'), conn, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    await settle();
    expect(conn.messages.find((m) => m.t === 'welcome')).toMatchObject({ region: { id: 'sanctum' } });
    const start = world.home.position('m')!;
    for (let seq = 1; seq <= 5; seq++) world.handle('m', { t: 'input', seq, dx: 0, dy: 1 });
    await settle();
    for (let i = 0; i < 3; i++) a.tick();
    await settle();
    expect(conn.messages.some((m) => m.t === 'snapshot')).toBe(true);
    // The gateway knows where the player is from what they were sent.
    expect(a.region('sanctum')!.position('m')!.y).toBeGreaterThan(start.y);
    expect(world.home.position('m')).toEqual(a.region('sanctum')!.position('m'));
    expect(world.places().find((p) => p.id === 'm')).toMatchObject({ regionId: 'sanctum' });
  });

  it('walks a player from a region on one server into a region on another', async () => {
    const { world, servers, server } = await gateway();
    const a = await server('a');
    await until(() => world.home.host === 'a');
    const b = await server('b');
    await servers.move('sanctum', 'a');
    await servers.move('woods', 'b');
    expect(world.region('woods')!.host).toBe('b');

    const west = world.home.map.entries.west!;
    const conn = fakeConn();
    const watcher = fakeConn();
    world.join(info('m', 'Mara'), conn, { regionId: 'sanctum', x: west.x, y: west.y }, newCharacter());
    world.join(info('w', 'Watcher'), watcher, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    await settle();
    for (let seq = 1; seq <= 40 && world.regionOf('m')!.def.id === 'sanctum'; seq++) {
      world.handle('m', { t: 'input', seq, dx: -1, dy: 0 });
      a.tick();
      await settle();
    }
    expect(world.regionOf('m')!.def.id).toBe('woods');
    await settle();
    expect(b.region('woods')!.has('m')).toBe(true);
    expect(a.region('sanctum')!.has('m')).toBe(false);
    expect(conn.messages.filter((m) => m.t === 'welcome').at(-1)).toMatchObject({ region: { id: 'woods' } });
    expect(watcher.messages.some((m) => m.t === 'system' && m.text === 'Mara set off for Whispering Woods.')).toBe(true);
  });

  it('sends World chat from one server to players on another', async () => {
    const { world, servers, server } = await gateway();
    await server('a');
    await until(() => world.home.host === 'a');
    await server('b');
    await servers.move('sanctum', 'a');
    await servers.move('desert', 'b');
    const mara = fakeConn();
    const tom = fakeConn();
    world.join(info('m', 'Mara'), mara, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    world.join(info('t', 'Tom'), tom, { regionId: 'desert', x: null, y: null }, newCharacter());
    await settle();
    world.handle('m', { t: 'chat', channel: 'world', text: 'hello, desert' });
    world.handle('m', { t: 'chat', channel: 'whisper', text: 'psst', to: 'Tom' });
    await settle();
    expect(tom.messages.some((m) => m.t === 'chat' && m.channel === 'world' && m.text === 'hello, desert')).toBe(true);
    expect(tom.messages.some((m) => m.t === 'chat' && m.channel === 'whisper' && m.text === 'psst')).toBe(true);
  });

  it('moves the regions of a server that stops, with their players, keeping what they carry', async () => {
    const { world, server } = await gateway();
    const a = await server('a');
    await until(() => world.home.host === 'a');
    const conn = fakeConn();
    const character = newCharacter();
    character.gold = 42;
    world.join(info('m', 'Mara'), conn, { regionId: 'woods', x: null, y: null }, character);
    await settle();
    await a.stop();
    running.splice(running.indexOf(a), 1);
    await until(() => world.region('woods')!.host === 'gateway');
    expect(world.regionOf('m')!.def.id).toBe('woods');
    expect(world.local('woods')!.character('m')!.gold).toBe(42);
  });

  it('gives up on a server that falls silent, and sets its regions up again from what players were last sent', async () => {
    const { world, server } = await gateway({ deadMs: 50 });
    await server('quiet', 60_000);
    await until(() => world.home.host === 'quiet');
    const conn = fakeConn();
    world.join(info('m', 'Mara'), conn, { regionId: 'sanctum', x: 30, y: 30 }, newCharacter());
    await settle();
    await until(() => world.home.host === 'gateway', 4000);
    expect(world.local('sanctum')!.position('m')).toEqual({ x: 30, y: 30 });
    // The player is welcomed into the region set up again here.
    expect(conn.messages.filter((m) => m.t === 'welcome').length).toBeGreaterThanOrEqual(2);
  });

  it('asks a server that the gateway does not know to start again', async () => {
    const bus = new MemoryBus();
    const stale = new RegionServer({ bus, id: 'stale', autoTick: false });
    await stale.start();
    running.push(stale);
    await settle();
    // A gateway starting after the server: the server's next beat is answered with a reset, and it says hello.
    const world = new World();
    const servers = new RegionServers(bus, world, { content: () => [] });
    world.hosting = servers;
    await servers.start();
    running.push({ stop: () => servers.close() });
    (stale as unknown as { beat(): void }).beat();
    await until(() => world.home.host === 'stale');
  });
});

describe('the game on region servers', () => {
  it('grants a wished creature into a region running on a region server, and spends the Favor there', async () => {
    const bus = new MemoryBus();
    const regionServer = new RegionServer({ bus, id: 'r1' });
    const { store, ws } = await start({ regionBus: bus });
    await regionServer.start();
    running.push(regionServer);
    await until(() => app!.world.home.host === 'r1');
    const p = account(store, 'Mara', 'owner');
    const c = await joined(ws, p.token);
    const favor = app!.world.home.character(p.id)!.favor;
    const card = await wish(c, 'Please make a pink slime');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('Look around'));
    const record = store.content[0]!;
    await until(() => regionServer.region('sanctum')!.creatureIds().filter((id) => regionServer.region('sanctum')!.creature(id)?.kind === record.id).length === 3);
    await c.waitFor<any>((m) => m.t === 'snapshot' && m.creatures.some((cr: any) => cr.kind === record.id));
    await until(() => app!.world.home.character(p.id)!.favor === favor - card.cost);
    expect(regionServer.region('sanctum')!.character(p.id)!.favor).toBe(favor - card.cost);
  });
});

describe("God's View Server health", () => {
  it('shows every host and its regions to the Owner, and moves and restarts regions', async () => {
    const bus = new MemoryBus();
    const regionServer = new RegionServer({ bus, id: 'r1' });
    const { store, ws, base } = await start({ regionBus: bus });
    await regionServer.start();
    running.push(regionServer);
    await until(() => app!.world.home.host === 'r1');
    const owner = account(store, 'egoforia', 'owner');
    const steward = account(store, 'Mara', 'steward');
    const c = await joined(ws, owner.token);
    expect((await api(base, '/api/admin/servers', steward.token)).status).toBe(403);

    const health = await api(base, '/api/admin/servers', owner.token);
    expect(health.body).toMatchObject({ regionServers: true, store: expect.any(String) });
    const [gateway, r1] = health.body.hosts;
    expect(gateway).toMatchObject({ id: 'gateway', kind: 'gateway', regions: [] });
    expect(gateway.load).toMatchObject({ tickMs: expect.any(Number), memoryMb: expect.any(Number), errors: 0, pid: process.pid });
    expect(r1).toMatchObject({ id: 'r1', kind: 'region-server', players: 1 });
    expect(r1.regions.map((r: any) => r.id).sort()).toEqual(['desert', 'sanctum', 'shore', 'woods']);

    // Restart where it runs: the player is welcomed again where they stood.
    const before = app!.world.home.position(owner.id)!;
    const restart = await api(base, '/api/admin/servers/move', owner.token, 'POST', { region: 'sanctum' });
    expect(restart.body).toMatchObject({ host: 'r1', message: 'Restarted the Sanctum.' });
    await c.waitFor((m) => m.t === 'welcome');
    expect(app!.world.home.position(owner.id)).toEqual(before);

    // Move to the game server, then refuse a server that is not running.
    expect((await api(base, '/api/admin/servers/move', owner.token, 'POST', { region: 'sanctum', to: 'gateway' })).body).toMatchObject({ host: 'gateway' });
    expect(app!.world.home.host).toBe('gateway');
    expect((await api(base, '/api/admin/servers/move', owner.token, 'POST', { region: 'sanctum', to: 'nowhere' })).status).toBe(400);
    expect((await api(base, '/api/admin/servers/move', owner.token, 'POST', { region: 'atlantis' })).status).toBe(404);
  });

  it('restarts a region when every region runs in the game server', async () => {
    const { store, ws, base } = await start();
    const owner = account(store, 'egoforia', 'owner');
    await joined(ws, owner.token);
    const health = await api(base, '/api/admin/servers', owner.token);
    expect(health.body.regionServers).toBe(false);
    expect(health.body.hosts).toHaveLength(1);
    const old = app!.world.home;
    expect((await api(base, '/api/admin/servers/move', owner.token, 'POST', { region: 'sanctum' })).status).toBe(200);
    expect(app!.world.home).not.toBe(old);
    expect(app!.world.home.has(owner.id)).toBe(true);
    expect((await api(base, '/api/admin/servers/move', owner.token, 'POST', { region: 'sanctum', to: 'r1' })).status).toBe(400);
  });
});
