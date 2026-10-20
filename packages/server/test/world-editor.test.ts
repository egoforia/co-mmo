import { afterEach, describe, expect, it } from 'vitest';
import { Tile, newCharacter, type PlayerInfo, type RegionMap, type ServerMessage, type TilePoint, type WelcomeMessage, type WorldEdit } from '@co-mmo/shared';
import { MemoryBus } from '../src/bus.ts';
import type { Connection } from '../src/region.ts';
import { RegionServer } from '../src/region-server.ts';
import { RegionServers } from '../src/region-servers.ts';
import { Store } from '../src/store.ts';
import { World } from '../src/world.ts';
import { WorldEditor } from '../src/world-editor.ts';
import { account, api, app, joined, start, stop } from './helpers.ts';

const tile = (map: RegionMap, [x, y]: TilePoint) => map.tiles[y * map.width + x] as Tile;

/** Open ground near the middle of a land, with room around it. */
function openGround(map: RegionMap, near: TilePoint = [100, 140]): TilePoint {
  for (let r = 0; r < 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const [x, y] = [near[0] + dx, near[1] + dy];
        let clear = true;
        for (let j = -2; j <= 2 && clear; j++) for (let i = -2; i <= 2 && clear; i++) clear = tile(map, [x + i, y + j]) === Tile.Ground;
        if (clear) return [x, y];
      }
    }
  }
  throw new Error('no open ground');
}

describe('the world editor', () => {
  it('lets the Owner and Stewards plant, undo and redo; players may not', async () => {
    const { base, store, ws } = await start();
    const steward = account(store, 'Sten', 'steward');
    const player = account(store, 'Pip');
    const spot = openGround(app!.world.home.map);
    const plant = { region: 'sanctum', edit: { kind: 'paint', tile: 'tree', tiles: [spot] } };
    expect((await api(base, '/api/world-edits', player.token, 'POST', plant)).status).toBe(403);
    expect((await api(base, '/api/world-edits?region=sanctum', player.token)).status).toBe(403);

    const watcher = await joined(ws, player.token);
    const made = await api(base, '/api/world-edits', steward.token, 'POST', plant);
    expect(made.status).toBe(200);
    expect(made.body.edits).toHaveLength(1);
    expect(made.body.edits[0]).toMatchObject({ kind: 'paint', by: 'Sten' });
    expect(tile(app!.world.home.map, spot)).toBe(Tile.Tree);
    // Players in the land are shown it laid out again, the edit on its definition.
    const welcome = await watcher.waitFor<WelcomeMessage>((m) => m.t === 'welcome');
    expect(welcome.region.def.edits).toHaveLength(1);

    const undone = await api(base, '/api/world-edits/undo', steward.token, 'POST', { region: 'sanctum' });
    expect(undone.body).toMatchObject({ edits: [], undone: 1 });
    expect(tile(app!.world.home.map, spot)).toBe(Tile.Ground);
    const redone = await api(base, '/api/world-edits/redo', steward.token, 'POST', { region: 'sanctum' });
    expect(redone.body).toMatchObject({ undone: 0 });
    expect(tile(app!.world.home.map, spot)).toBe(Tile.Tree);
    const nothing = await api(base, '/api/world-edits/redo', steward.token, 'POST', { region: 'sanctum' });
    expect(nothing).toMatchObject({ status: 400, body: { message: 'There is nothing to redo in this land.' } });
    const listed = await api(base, '/api/world-edits?region=sanctum', steward.token);
    expect(listed.body.edits).toHaveLength(1);
  });

  it('refuses edits that do not fit, in plain words, and never blocks where players arrive', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Ego', 'owner');
    const spawn = app!.world.home.map.spawn;
    const block = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'sanctum', edit: { kind: 'paint', tile: 'rock', tiles: [[Math.floor(spawn.x), Math.floor(spawn.y)]] } });
    expect(block).toMatchObject({ status: 400, body: { message: expect.stringMatching(/where players arrive/) } });
    const monster = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'sanctum', edit: { kind: 'spawn', creature: 'no-such-thing', at: [10, 10], count: 2 } });
    expect(monster.body.message).toBe('There is no monster of that kind.');
    expect(store.worldEdits('sanctum').edits).toHaveLength(0);
  });

  it('places a monster spawn whose monsters live and come back there', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Ego', 'owner');
    const spot = openGround(app!.world.region('woods')!.map);
    const before = app!.world.region('woods')!.creatureIds().length;
    const made = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'woods', edit: { kind: 'spawn', creature: 'thorn-wolf', at: spot, count: 3, name: 'Fake', by: 'Someone else' } });
    expect(made.body.edits[0]).toMatchObject({ name: 'Thorn Wolf', asset: 'woods-thorn-wolf', by: 'Ego' });
    const woods = app!.world.local('woods')!;
    expect(woods.creatureIds().length).toBe(before + 3);
    const wolves = woods.creatureIds().map((id) => woods.creature(id)!).filter((c) => Math.hypot(c.x - spot[0] - 0.5, c.y - spot[1] - 0.5) <= 3.6);
    expect(wolves.filter((c) => c.kind === 'thorn-wolf').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps edits across a restart', async () => {
    const store = Store.memory();
    const first = await start({ store });
    const owner = account(store, 'Ego', 'owner');
    const spot = openGround(app!.world.home.map);
    await api(first.base, '/api/world-edits', owner.token, 'POST', { region: 'sanctum', edit: { kind: 'paint', tile: 'water', tiles: [spot] } });
    await stop();
    await start({ store });
    expect(app!.world.home.def.edits).toHaveLength(1);
    expect(tile(app!.world.home.map, spot)).toBe(Tile.Water);
  });
});

describe('the world editor with region servers', () => {
  const running: { stop(): Promise<void> }[] = [];
  afterEach(async () => {
    for (const r of running.splice(0)) await r.stop();
  });

  it('lays an edited land out again on the region server that runs it, and players there see it', async () => {
    const bus = new MemoryBus();
    const store = Store.memory();
    const world = new World(() => Date.now(), () => 0.5, undefined, (id) => store.worldEdits(id).edits);
    const servers = new RegionServers(bus, world, { content: () => [] });
    world.hosting = servers;
    await servers.start();
    running.push({ stop: () => servers.close() });
    const server = new RegionServer({ bus, id: 'a', autoTick: false, random: () => 0.5 });
    await server.start();
    running.push(server);
    await until(() => world.home.host === 'a');

    const messages: ServerMessage[] = [];
    const conn: Connection = { send: (m) => messages.push(m), close: () => undefined };
    const info: PlayerInfo = { id: 'm', name: 'Mara', color: 0xffffff, role: 'player' };
    world.join(info, conn, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    await until(() => messages.some((m) => m.t === 'welcome'));

    const editor = new WorldEditor(store, world);
    const spot = openGround(world.home.map);
    const result = await editor.add('sanctum', { kind: 'paint', tile: 'rock', tiles: [spot] }, 'Ego');
    expect(result.ok).toBe(true);
    await until(() => server.region('sanctum') !== undefined && tile(server.region('sanctum')!.map, spot) === Tile.Rock);
    expect(world.home.host).toBe('a');
    await until(() => messages.some((m) => m.t === 'welcome' && (m.region.def.edits as WorldEdit[] | undefined)?.length === 1));
    expect(server.region('sanctum')!.has('m')).toBe(true);
  });
});

async function until(test: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
