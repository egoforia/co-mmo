import { afterEach, describe, expect, it } from 'vitest';
import { newCharacter, regionDef, type PlayerInfo, type ServerMessage, type SnapshotMessage } from '@co-mmo/shared';
import { MemoryBus } from '../src/bus.ts';
import type { Connection } from '../src/region.ts';
import { across } from '../src/region/beyond.ts';
import { RegionServer } from '../src/region-server.ts';
import { RegionServers } from '../src/region-servers.ts';
import { World } from '../src/world.ts';

// Seeing across region edges (region/beyond.ts): players near an edge see
// who stands just over it, where they stand, wherever either region runs.

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const lastSnapshot = (c: { messages: ServerMessage[] }) => c.messages.filter((m): m is SnapshotMessage => m.t === 'snapshot').at(-1);

/** Mara on the Woods' side of its road into the Sanctum, and a watcher on the Sanctum's side, three tiles apart. */
function nearTheEdge(world: World) {
  const sanctum = world.home;
  const woods = world.region('woods')!;
  const west = sanctum.map.entries.west!;
  const east = woods.map.entries.east!;
  const mara = fakeConn();
  const watcher = fakeConn();
  world.join(info('m', 'Mara'), mara, { regionId: 'woods', x: east.x - 1, y: east.y }, newCharacter());
  world.join(info('w', 'Watcher'), watcher, { regionId: 'sanctum', x: west.x + 1, y: west.y }, newCharacter());
  return { sanctum, woods, mara, watcher, at: { x: east.x - 1 - woods.map.width, y: east.y } };
}

describe('seeing across region edges', () => {
  it('shows a player in the next region where they stand, counted from our own corner', () => {
    const world = new World();
    const { mara, watcher, at } = nearTheEdge(world);
    world.tick();
    world.tick();
    const seen = lastSnapshot(watcher)!.players.find((p) => p.id === 'm');
    expect(seen).toMatchObject({ name: 'Mara', x: at.x, y: at.y });
    // And the other way: Mara sees the watcher past her east edge.
    const back = lastSnapshot(mara)!.players.find((p) => p.id === 'w');
    expect(back!.x).toBeGreaterThan(world.region('woods')!.map.width);
  });

  it('keeps someone who walks over the edge on screen, under the same name, every snapshot', () => {
    const world = new World();
    const { watcher } = nearTheEdge(world);
    world.tick();
    // Mara walks east, out of the Woods and into the Sanctum.
    for (let seq = 1; seq <= 20; seq++) {
      world.handle('m', { t: 'input', seq, dx: 1, dy: 0 });
      world.tick();
      const snap = lastSnapshot(watcher)!;
      expect(snap.players.filter((p) => p.id === 'm')).toHaveLength(1);
    }
    expect(world.regionOf('m')!.def.id).toBe('sanctum');
  });

  it('shows nothing over the edge with NET_SEE_ACROSS=off', () => {
    const world = new World();
    world.seeAcross = false;
    const { watcher } = nearTheEdge(world);
    world.tick();
    world.tick();
    expect(lastSnapshot(watcher)!.players.some((p) => p.id === 'm')).toBe(false);
  });

  it('shows nobody far from the edge, and sends no edges while nobody is near them', () => {
    const world = new World();
    const watcher = fakeConn();
    world.join(info('w'), watcher, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    world.join(info('m'), fakeConn(), { regionId: 'woods', x: null, y: null }, newCharacter());
    world.tick();
    world.tick();
    expect(lastSnapshot(watcher)!.players).toEqual([]);
    // Only regions beside someone show their edges: the Sanctum and the Woods have each other.
    expect(world.state().borders!.sort()).toEqual(['desert', 'frostpeak', 'mushroom-hollow', 'sanctum', 'shore', 'woods']);
    world.leave('w');
    // The Woods' neighbours, corners too (the Desert and Frostpeak touch it at a corner).
    expect(world.state().borders!.sort()).toEqual(['desert', 'frostpeak', 'mushroom-hollow', 'sanctum']);
  });

  it('moves what a region shows onto its neighbour\'s corner, naming bodies and wished creatures after their region', () => {
    const woods = regionDef('woods')!;
    const sanctum = regionDef('sanctum')!;
    const g = across({
      players: [{ id: 'm', name: 'Mara', color: 0, x: 250, y: 30, health: 1 }, { id: 'far', name: 'Far', color: 0, x: 100, y: 30, health: 1 }],
      creatures: [
        { id: 'woods-wolf-1', kind: 'wolf', asset: 'wolf', name: 'Wolf', x: 251, y: 31, health: 1 },
        { id: 'boar-0', kind: 'boar', asset: 'boar', name: 'Boar', x: 252, y: 32, health: 1 },
      ],
      bodies: [{ id: 'body-1', kind: 'wolf', asset: 'wolf', name: 'Wolf', x: 253, y: 33, loot: false }],
      npcs: [],
    }, woods, sanctum, 256);
    expect(g.players.map((p) => [p.id, p.x])).toEqual([['m', -6]]);
    expect(g.creatures.map((c) => c.id)).toEqual(['woods-wolf-1', 'woods:boar-0']);
    expect(g.bodies[0]).toMatchObject({ id: 'woods:body-1', x: -3, y: 33 });
  });
});

describe('seeing across region edges on region servers', () => {
  const running: { stop(): Promise<void> }[] = [];
  afterEach(async () => {
    for (const r of running.splice(0)) await r.stop();
  });
  const settle = async (rounds = 8) => {
    for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
  };

  it('shows a player in a region on another server', async () => {
    const bus = new MemoryBus();
    const world = new World(() => Date.now(), () => 0.5);
    const servers = new RegionServers(bus, world, { content: () => [] });
    world.hosting = servers;
    await servers.start();
    running.push({ stop: () => servers.close() });
    const a = new RegionServer({ bus, id: 'a', autoTick: false, random: () => 0.5 });
    await a.start();
    running.push(a);
    const end = Date.now() + 3000;
    while (world.home.host !== 'a' && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
    const b = new RegionServer({ bus, id: 'b', autoTick: false, random: () => 0.5 });
    await b.start();
    running.push(b);
    await settle();
    await servers.move('sanctum', 'a');
    await servers.move('woods', 'b');

    const { watcher, at } = nearTheEdge(world);
    await settle();
    for (let i = 0; i < 3; i++) {
      b.tick();
      await settle();
      a.tick();
      await settle();
    }
    expect(lastSnapshot(watcher)!.players.find((p) => p.id === 'm')).toMatchObject({ x: at.x, y: at.y });
  });
});
