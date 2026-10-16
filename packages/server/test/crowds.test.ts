import { afterEach, describe, expect, it } from 'vitest';
import { collides, newCharacter, regionDef, type PlayerInfo, type RegionMap, type ServerMessage } from '@co-mmo/shared';
import { MemoryBus } from '../src/bus.ts';
import { Region, snapshotEvery, type Connection } from '../src/region.ts';
import { RegionServer } from '../src/region-server.ts';
import { RegionServers } from '../src/region-servers.ts';
import type { SplitRegion } from '../src/split-region.ts';
import { World } from '../src/world.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });
const snapshots = (c: { messages: ServerMessage[] }) => c.messages.filter((m) => m.t === 'snapshot').length;

describe('update rates in a crowd', () => {
  it('sends snapshots less often as the crowd in view or the load grows, never slower than every 4 ticks', () => {
    expect(snapshotEvery(5)).toBe(1);
    expect(snapshotEvery(50)).toBe(2);
    expect(snapshotEvery(100)).toBe(3);
    expect(snapshotEvery(500)).toBe(4);
    expect(snapshotEvery(5, 1)).toBe(2);
    expect(snapshotEvery(500, 2)).toBe(4);
  });

  it('a player in a crowd gets fewer snapshots; one alone gets one every tick', () => {
    const region = new Region(regionDef('sanctum')!, undefined, Date.now, () => 0.5);
    const conns = new Map<string, ReturnType<typeof fakeConn>>();
    for (let i = 0; i < 60; i++) {
      const c = fakeConn();
      conns.set(`p${i}`, c);
      region.join(info(`p${i}`), c, { x: null, y: null }, newCharacter(), '');
    }
    for (let i = 0; i < 20; i++) region.tick();
    // 59 others in view: every second tick after the first snapshot counted them.
    const crowded = snapshots(conns.get('p0')!);
    expect(crowded).toBeGreaterThanOrEqual(10);
    expect(crowded).toBeLessThanOrEqual(11);

    const quiet = new Region(regionDef('woods')!, undefined, Date.now, () => 0.5);
    const alone = fakeConn();
    quiet.join(info('a'), alone, { x: null, y: null }, newCharacter(), '');
    quiet.strain = 0;
    for (let i = 0; i < 20; i++) quiet.tick();
    expect(snapshots(alone)).toBe(20);
    // A busy process slows even a quiet region down.
    quiet.strain = 2;
    alone.messages.length = 0;
    for (let i = 0; i < 21; i++) quiet.tick();
    expect(snapshots(alone)).toBe(7);
  });
});

// --- Crowded regions split into cells -----------------------------------------

/** A walkable spot in column x, as near the middle as there is one. */
function spotAt(map: RegionMap, x: number): { x: number; y: number } {
  for (let d = 0; d < map.height / 2; d++) {
    for (const y of [map.height / 2 + d, map.height / 2 - d]) {
      if (!collides(map, x + 0.5, Math.floor(y) + 0.5)) return { x: x + 0.5, y: Math.floor(y) + 0.5 };
    }
  }
  throw new Error(`nowhere to stand at x ${x}`);
}

/** A row where one can walk from column x0 to x1 without bumping into anything. */
function clearRow(map: RegionMap, x0: number, x1: number): number {
  for (let y = 2; y < map.height - 2; y++) {
    let clear = true;
    for (let x = x0; x <= x1 && clear; x += 0.25) clear = !collides(map, x, y + 0.5);
    if (clear) return y + 0.5;
  }
  throw new Error('no clear row');
}

async function settle(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

const second = async (world: World, clock?: { now: number }) => {
  for (let i = 0; i < 20; i++) {
    world.tick();
    if (clock) clock.now += 50;
  }
  await settle();
  await Promise.all([...world.pending]);
};

/** A world whose woods hold seven players spread along it, three to a cell. */
function crowdedWoods() {
  const clock = { now: 1_000_000 };
  const world = new World(() => clock.now, () => 0.5);
  world.cellPlayers = 3;
  const map = world.region('woods')!.map;
  const conns = new Map<string, ReturnType<typeof fakeConn>>();
  const xs = [5, 10, 20, 30, 40, 50, 58];
  xs.forEach((x, i) => {
    const c = fakeConn();
    conns.set(`p${i}`, c);
    world.join(info(`p${i}`), c, { regionId: 'woods', ...spotAt(map, x) }, newCharacter());
  });
  return { clock, world, map, conns };
}

describe('crowded regions', () => {
  it('splits a crowded region into cells, quietly, with everyone where they stood', async () => {
    const { world, conns } = crowdedWoods();
    const before = new Map([...conns.keys()].map((id) => [id, world.region('woods')!.position(id)]));
    for (const c of conns.values()) c.messages.length = 0;
    await second(world);
    const woods = world.region('woods') as SplitRegion;
    expect(woods.cells?.map((c) => c.cell!.index)).toEqual([0, 1, 2]);
    expect(woods.online).toBe(7);
    for (const [id, at] of before) {
      expect(woods.position(id)).toEqual(at);
      const cell = woods.cells.find((c) => c.has(id))!.cell!;
      expect(at!.x >= cell.x0 && at!.x < cell.x1).toBe(true);
    }
    // Nothing on screen changes: no welcome, snapshots go on.
    expect([...conns.values()].some((c) => c.messages.some((m) => m.t === 'welcome'))).toBe(false);
    expect(snapshots(conns.get('p0')!)).toBeGreaterThan(0);
    // Each cell runs only the creatures of its strip; together they are the region's.
    const ids = woods.creatureIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(new World().region('woods')!.creatureIds().length);
  });

  it('shows players across a border, and walks them into the next cell without a welcome', async () => {
    const { world, map, conns } = crowdedWoods();
    await second(world);
    const woods = world.region('woods') as SplitRegion;
    const border = woods.cells[1]!.cell!.x0;
    // Mara stands just left of the border, Tom just right of it.
    expect(world.local('woods')).toBeUndefined();
    const mara = fakeConn();
    const tom = fakeConn();
    const y = clearRow(map, border - 4, border + 4);
    const left = { x: border - 3, y };
    const right = { x: border + 2, y };
    world.join(info('mara'), mara, { regionId: 'woods', ...left }, newCharacter());
    world.join(info('tom'), tom, { regionId: 'woods', ...right }, newCharacter());
    expect(woods.cells[0]!.has('mara')).toBe(true);
    expect(woods.cells[1]!.has('tom')).toBe(true);
    for (let i = 0; i < 3; i++) world.tick();
    const seen = mara.messages.filter((m) => m.t === 'snapshot').at(-1) as Extract<ServerMessage, { t: 'snapshot' }>;
    expect(seen.players.map((p) => p.id)).toContain('tom');

    // Mara walks east over the border.
    mara.messages.length = 0;
    let seq = 0;
    for (let i = 0; i < 60 && !woods.cells[1]!.has('mara'); i++) {
      world.handle('mara', { t: 'input', seq: ++seq, dx: 1, dy: 0 });
      world.tick();
      await settle(2);
    }
    expect(woods.cells[1]!.has('mara')).toBe(true);
    expect(woods.cells[0]!.has('mara')).toBe(false);
    expect(mara.messages.some((m) => m.t === 'welcome')).toBe(false);
    // Her steps carried over: the new cell acknowledges where the old one left off.
    world.handle('mara', { t: 'input', seq: ++seq, dx: 1, dy: 0 });
    world.tick();
    const last = mara.messages.filter((m) => m.t === 'snapshot').at(-1) as Extract<ServerMessage, { t: 'snapshot' }>;
    expect(last.ack).toBe(seq);
    // Region chat reaches every cell.
    world.handle('p0', { t: 'chat', channel: 'region', text: 'hello woods' });
    expect(conns.get('p6')!.messages.some((m) => m.t === 'chat' && m.text === 'hello woods')).toBe(true);
  });

  it('joins a region up again once it has been quieter for a while', async () => {
    const { clock, world } = crowdedWoods();
    await second(world, clock);
    expect(world.region('woods')!.cells).toHaveLength(3);
    for (const id of ['p0', 'p1', 'p2', 'p3', 'p4']) await world.leave(id);
    await second(world, clock);
    expect(world.region('woods')!.cells).toHaveLength(3);
    clock.now += 31_000;
    await second(world, clock);
    const woods = world.region('woods')!;
    expect(woods.cells).toBeUndefined();
    expect(woods.playerIds().sort()).toEqual(['p5', 'p6']);
  });

  it('keeps wished creatures in the cells where they stand, with ids that do not clash', async () => {
    const { world, map } = crowdedWoods();
    const spots = [spotAt(map, 8), spotAt(map, 30), spotAt(map, 52)];
    world.placeCreatures('woods', 'walking-mushroom', spots);
    await second(world);
    const woods = world.region('woods') as SplitRegion;
    const wished = woods.creatureIds().filter((id) => /^walking-mushroom-\d$/.test(id)).sort();
    expect(wished).toEqual(['walking-mushroom-0', 'walking-mushroom-1', 'walking-mushroom-2']);
    expect(woods.cells.map((c) => c.creatureIds().filter((id) => wished.includes(id)).length)).toEqual([1, 1, 1]);
  });
});

describe('crowded regions on region servers', () => {
  const running: { stop(): Promise<void> }[] = [];
  afterEach(async () => {
    for (const r of running.splice(0)) await r.stop();
  });

  it('spreads the cells over the servers, and players cross between them', async () => {
    const bus = new MemoryBus();
    const world = new World(() => Date.now(), () => 0.5);
    world.cellPlayers = 1;
    const servers = new RegionServers(bus, world, { content: () => [] });
    world.hosting = servers;
    await servers.start();
    running.push({ stop: () => servers.close() });
    for (const id of ['a', 'b']) {
      const s = new RegionServer({ bus, id, autoTick: false, random: () => 0.5 });
      await s.start();
      running.push(s);
    }
    const until = async (test: () => boolean) => {
      for (let i = 0; i < 300 && !test(); i++) await new Promise((r) => setTimeout(r, 5));
      expect(test()).toBe(true);
    };
    await until(() => world.units().every((u) => u.host !== 'gateway'));
    const map = world.region('shore')!.map;
    const mara = fakeConn();
    const tom = fakeConn();
    const y = clearRow(map, 26, 36);
    world.join(info('mara'), mara, { regionId: 'shore', x: 29, y }, newCharacter());
    world.join(info('tom'), tom, { regionId: 'shore', x: 34, y }, newCharacter());
    await settle();
    await second(world);
    await until(() => (world.region('shore')!.cells?.length ?? 0) === 2);
    const shore = world.region('shore') as SplitRegion;
    expect(new Set(shore.cells.map((c) => c.host))).toEqual(new Set(['a', 'b']));
    expect(shore.cells[0]!.has('mara')).toBe(true);
    expect(shore.cells[1]!.has('tom')).toBe(true);

    // Each server ticks; the gateway passes each cell's border to the other.
    const [a, b] = running.slice(1) as RegionServer[];
    const tickAll = async () => {
      a!.tick();
      b!.tick();
      await settle();
    };
    for (let i = 0; i < 3; i++) await tickAll();
    const seen = tom.messages.filter((m) => m.t === 'snapshot').at(-1) as Extract<ServerMessage, { t: 'snapshot' }>;
    expect(seen.players.map((p) => p.id)).toContain('mara');

    let seq = 0;
    for (let i = 0; i < 80 && !shore.cells[1]!.has('mara'); i++) {
      world.handle('mara', { t: 'input', seq: ++seq, dx: 1, dy: 0 });
      await tickAll();
    }
    await until(() => shore.cells[1]!.has('mara'));
    expect(mara.messages.filter((m) => m.t === 'welcome')).toHaveLength(1);
  });
});
