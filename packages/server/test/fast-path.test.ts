import { afterEach, describe, expect, it } from 'vitest';
import { newCharacter, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { MemoryBus } from '../src/bus.ts';
import type { Connection } from '../src/region.ts';
import { RegionServer } from '../src/region-server.ts';
import { RegionServers } from '../src/region-servers.ts';
import { World } from '../src/world.ts';

// The quicker path through region servers (docs/scale.md): snapshots passed
// on as written, inputs sent together, and a player walking off an edge let
// go at once instead of being asked for.

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });

function fakeConn(withText = false) {
  const messages: ServerMessage[] = [];
  const texts: string[] = [];
  const conn: Connection & { messages: ServerMessage[]; texts: string[] } = {
    messages,
    texts,
    send: (m) => messages.push(m),
    close() {},
    ...(withText ? { sendSnapshot: (text: string) => texts.push(text) } : {}),
  };
  return conn;
}

async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

const running: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) await r.stop();
});

/** A gateway with the Sanctum on server `a` and the Woods on server `b`; `sent` lists every message to a region server. */
async function twoServers(env: Record<string, string> = {}) {
  const bus = new MemoryBus();
  const sent: { t: string; list?: unknown[] }[] = [];
  const publish = bus.publish.bind(bus);
  bus.publish = (channel, message) => {
    if (channel.startsWith('region-server:')) sent.push(message as { t: string });
    publish(channel, message);
  };
  const world = new World(() => Date.now(), () => 0.5);
  const servers = new RegionServers(bus, world, { content: () => [], fastPath: env.NET_FAST_PATH !== 'off' });
  world.hosting = servers;
  await servers.start();
  running.push({ stop: () => servers.close() });
  const make = async (id: string) => {
    const s = new RegionServer({ bus, id, autoTick: false, random: () => 0.5, env });
    await s.start();
    running.push(s);
    await settle();
    return s;
  };
  const a = await make('a');
  const end = Date.now() + 3000;
  while (world.home.host !== 'a' && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
  const b = await make('b');
  await servers.move('sanctum', 'a');
  await servers.move('woods', 'b');
  return { world, a, b, sent };
}

describe('the quicker path through region servers', () => {
  it('passes a snapshot on as the region server wrote it, and still knows where the player is', async () => {
    const { world, a } = await twoServers();
    const conn = fakeConn(true);
    world.join(info('m', 'Mara'), conn, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    await settle();
    world.handle('m', { t: 'input', seq: 1, dx: 0, dy: 1 });
    await settle();
    a.tick();
    await settle();
    expect(conn.texts).toHaveLength(1);
    const snap = JSON.parse(conn.texts[0]!);
    expect(snap).toMatchObject({ t: 'snapshot', ack: 1 });
    expect(world.home.position('m')).toEqual({ x: snap.x, y: snap.y });
    // Everything else still comes as a message.
    expect(conn.messages.some((m) => m.t === 'welcome')).toBe(true);
  });

  it('sends the inputs that came in together as one message', async () => {
    const { world, sent } = await twoServers();
    for (const id of ['m', 'n', 'o']) world.join(info(id), fakeConn(), { regionId: 'sanctum', x: null, y: null }, newCharacter());
    await settle();
    sent.length = 0;
    for (const id of ['m', 'n', 'o']) world.handle(id, { t: 'input', seq: 1, dx: 1, dy: 0 });
    await settle();
    expect(sent.map((m) => m.t)).toEqual(['inputs']);
    expect(sent[0]!.list).toHaveLength(3);
  });

  it('walks a player into a region on another server without asking the old one to let go, and loses no step on the way', async () => {
    const { world, a, b, sent } = await twoServers();
    const west = world.home.map.entries.west!;
    const conn = fakeConn();
    world.join(info('m', 'Mara'), conn, { regionId: 'sanctum', x: west.x, y: west.y }, newCharacter());
    await settle();
    let seq = 1;
    let bounced = false;
    for (; seq <= 40 && world.regionOf('m')!.def.id === 'sanctum'; seq++) {
      world.handle('m', { t: 'input', seq, dx: -1, dy: 0 });
      await settle();
      a.tick();
      if (!a.region('sanctum')!.has('m') && world.regionOf('m')!.def.id === 'sanctum') {
        // A step sent while the crossing is on its way reaches the old server after it let go.
        world.handle('m', { t: 'input', seq: ++seq, dx: -1, dy: 0 });
        bounced = true;
      }
      await settle();
    }
    expect(bounced).toBe(true);
    expect(world.regionOf('m')!.def.id).toBe('woods');
    await settle();
    expect(sent.some((m) => m.t === 'remove')).toBe(false);
    b.tick();
    await settle();
    const woods = b.region('woods')!;
    expect(woods.has('m')).toBe(true);
    expect(a.region('sanctum')!.has('m')).toBe(false);
    // Every step was applied, in the Woods if not before.
    const last = conn.messages.filter((m) => m.t === 'snapshot').at(-1);
    expect(last).toMatchObject({ ack: seq - 1 });
  });

  it('still asks the old server to let go with NET_FAST_PATH=off', async () => {
    const { world, a, sent } = await twoServers({ NET_FAST_PATH: 'off' });
    const west = world.home.map.entries.west!;
    const conn = fakeConn(true);
    world.join(info('m', 'Mara'), conn, { regionId: 'sanctum', x: west.x, y: west.y }, newCharacter());
    await settle();
    for (let seq = 1; seq <= 40 && world.regionOf('m')!.def.id === 'sanctum'; seq++) {
      world.handle('m', { t: 'input', seq, dx: -1, dy: 0 });
      await settle();
      a.tick();
      await settle();
    }
    expect(world.regionOf('m')!.def.id).toBe('woods');
    expect(sent.some((m) => m.t === 'remove')).toBe(true);
    expect(sent.some((m) => m.t === 'inputs')).toBe(false);
    expect(conn.texts).toHaveLength(0);
  });
});
