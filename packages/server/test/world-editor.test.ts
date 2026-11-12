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
    const plant = { region: 'sanctum', live: true, edit: { kind: 'paint', tile: 'tree', tiles: [spot] } };
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

    // In-Studio Region Map Preview & AI Map Architect endpoints:
    const withMap = await api(base, '/api/world-edits?region=sanctum&includeMap=1', steward.token);
    expect(withMap.status).toBe(200);
    expect(withMap.body.map.def.id).toBe('sanctum');
    expect(withMap.body.regions.some((r: { id: string }) => r.id === 'frostpeak')).toBe(true);

    const preview = await api(base, '/api/world-edits/ai-preview', steward.token, 'POST', {
      region: 'sanctum',
      prompt: 'Lay a stone road and place a gathering spot',
    });
    expect(preview.status).toBe(200);
    expect(preview.body.steps.length).toBeGreaterThan(0);

    const validSpot = openGround(app!.world.home.map, [110, 140]);
    const batchApply = await api(base, '/api/world-edits/ai-apply', steward.token, 'POST', {
      region: 'sanctum',
      drafts: [{ kind: 'paint', tile: 'path', tiles: [validSpot] }],
    });
    expect(batchApply.status).toBe(200);
    expect(batchApply.body.applied).toBe(1);
    // A draft: in the editor's map, not yet in the land players walk.
    expect(batchApply.body.edits.at(-1)).toMatchObject({ draft: true });
    expect(tile(batchApply.body.map, validSpot)).toBe(Tile.Path);
    expect(tile(app!.world.home.map, validSpot)).not.toBe(Tile.Path);
    const published = await api(base, '/api/world-edits/publish', steward.token, 'POST', { region: 'sanctum' });
    expect(published.body.edits.some((e: WorldEdit) => e.draft)).toBe(false);
    expect(tile(app!.world.home.map, validSpot)).toBe(Tile.Path);
    expect((await api(base, '/api/world-edits/publish', steward.token, 'POST', { region: 'sanctum' })).body.message).toBe('There are no drafts to publish in this land.');
  });

  it('keeps new edits as drafts until published, seen only in the editor, and throws them away', async () => {
    const { base, store, ws } = await start();
    const owner = account(store, 'Ego', 'owner');
    const watcher = await joined(ws, account(store, 'Pip').token);
    const spot = openGround(app!.world.home.map);
    const drafted = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'sanctum', edit: { kind: 'paint', tile: 'rock', tiles: [spot] } });
    expect(drafted.body.edits[0]).toMatchObject({ kind: 'paint', draft: true });
    expect(tile(drafted.body.map, spot)).toBe(Tile.Rock);
    expect(tile(app!.world.home.map, spot)).toBe(Tile.Ground);
    const listed = await api(base, '/api/world-edits?region=sanctum', owner.token);
    expect(listed.body.edits).toHaveLength(1);

    const thrown = await api(base, '/api/world-edits/discard', owner.token, 'POST', { region: 'sanctum' });
    expect(thrown.body).toMatchObject({ edits: [], undone: 1 });
    const back = await api(base, '/api/world-edits/redo', owner.token, 'POST', { region: 'sanctum' });
    expect(back.body.edits[0]).toMatchObject({ draft: true });
    await api(base, '/api/world-edits/publish', owner.token, 'POST', { region: 'sanctum' });
    expect(tile(app!.world.home.map, spot)).toBe(Tile.Rock);
    // Players were shown the land again only once, when it was published.
    const welcome = await watcher.waitFor<WelcomeMessage>((m) => m.t === 'welcome' && !!m.region.def.edits?.length);
    expect(welcome.region.def.edits).toHaveLength(1);
    expect(welcome.region.def.edits![0]).not.toHaveProperty('draft');
  });

  it('refuses edits that do not fit, in plain words, and never blocks where players arrive', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Ego', 'owner');
    const spawn = app!.world.home.map.spawn;
    const block = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'sanctum', live: true, edit: { kind: 'paint', tile: 'rock', tiles: [[Math.floor(spawn.x), Math.floor(spawn.y)]] } });
    expect(block).toMatchObject({ status: 400, body: { message: expect.stringMatching(/where players arrive/) } });
    const monster = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'sanctum', live: true, edit: { kind: 'spawn', creature: 'no-such-thing', at: [10, 10], count: 2 } });
    expect(monster.body.message).toBe('There is no monster of that kind.');
    expect(store.worldEdits('sanctum').edits).toHaveLength(0);
  });

  it('places a monster spawn whose monsters live and come back there', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Ego', 'owner');
    const spot = openGround(app!.world.region('woods')!.map);
    const before = app!.world.region('woods')!.creatureIds().length;
    const made = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'woods', live: true, edit: { kind: 'spawn', creature: 'thorn-wolf', at: spot, count: 3, name: 'Fake', by: 'Someone else' } });
    expect(made.body.edits[0]).toMatchObject({ name: 'Thorn Wolf', asset: 'woods-thorn-wolf', by: 'Ego' });
    const woods = app!.world.local('woods')!;
    expect(woods.creatureIds().length).toBe(before + 3);
    // Where they live, laid by the edit (live wolves wander off as soon as the land ticks, so their places are read from the land).
    const homes = app!.world.region('woods')!.map.creatures.filter((c) => c.kind === 'thorn-wolf' && Math.hypot(c.x - spot[0] - 0.5, c.y - spot[1] - 0.5) <= 3.6);
    expect(homes.length).toBeGreaterThanOrEqual(3);
  });

  it('makes a spawn\'s live monsters at the level, ways and patrol path the editor gave them', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Ego', 'owner');
    const spot = openGround(app!.world.region('woods')!.map);
    await api(base, '/api/world-edits', owner.token, 'POST', { region: 'woods', live: true, edit: { kind: 'spawn', creature: 'thorn-wolf', at: spot, count: 1, monsterLevel: 9, behavior: 'guard', active: 'always' } });
    const [made] = app!.world.region('woods')!.map.creatures.filter((c) => c.level === 9);
    expect(made).toBeTruthy();
    const live = () => app!.world.local('woods')!.allCreatures().find((c) => c.kind === 'thorn-wolf' && c.def.level === 9);
    expect(live()!.def).toMatchObject({ level: 9, behavior: 'guard', active: 'always' });
    // A patrol path from its home (the first of a spawn stands on its spot, in open ground), walked as drawn.
    const home: [number, number] = [Math.floor(made!.x), Math.floor(made!.y)];
    expect(home).toEqual(spot);
    const route = [[home[0] + 2, home[1]], [home[0] + 2, home[1] + 2], [home[0], home[1] + 2]];
    const drawn = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'woods', live: true, edit: { kind: 'patrol', at: home, route } });
    expect(drawn.body.message).toBeUndefined();
    expect(live()!.def.behavior).toBe('patrol');
    expect(live()!.route).toEqual(route.map(([x, y]) => ({ x: x! + 0.5, y: y! + 0.5 })));
  });

  it('keeps edits across a restart', async () => {
    const store = Store.memory();
    const first = await start({ store });
    const owner = account(store, 'Ego', 'owner');
    const spot = openGround(app!.world.home.map);
    await api(first.base, '/api/world-edits', owner.token, 'POST', { region: 'sanctum', live: true, edit: { kind: 'paint', tile: 'water', tiles: [spot] } });
    await stop();
    await start({ store });
    expect(app!.world.home.def.edits).toHaveLength(1);
    expect(tile(app!.world.home.map, spot)).toBe(Tile.Water);
  });
  it('shows edits made in the Architectural Testbed, and keeps them across a restart', async () => {
    const store = Store.memory();
    const first = await start({ store });
    const owner = account(store, 'Ego', 'owner');
    const spot: TilePoint = [30, 36];
    expect(tile(app!.world.region('arch-testbed')!.map, spot)).toBe(Tile.Ground);
    const made = await api(first.base, '/api/world-edits', owner.token, 'POST', { region: 'arch-testbed', live: true, edit: { kind: 'paint', tile: 'tree', tiles: [spot] } });
    expect(made.status).toBe(200);
    expect(tile(app!.world.region('arch-testbed')!.map, spot)).toBe(Tile.Tree);
    // Its pavilions are still there under the edit.
    expect(app!.world.region('arch-testbed')!.map.buildings.length).toBeGreaterThan(0);
    await stop();
    await start({ store });
    expect(tile(app!.world.region('arch-testbed')!.map, spot)).toBe(Tile.Tree);
  });
  it('lets a Steward make a workshop land, fill it from a file, and keeps it across a restart', async () => {
    const store = Store.memory();
    const first = await start({ store });
    const steward = account(store, 'Sten', 'steward');
    const player = account(store, 'Pip');
    expect((await api(first.base, '/api/world-edits/lands', player.token, 'POST', { name: 'My Lab', biome: 'sanctum' })).status).toBe(403);
    expect((await api(first.base, '/api/world-edits/lands', steward.token, 'POST', { name: 'x', biome: 'sanctum' })).body.message).toMatch(/name of 2 to 40/);
    const made = await api(first.base, '/api/world-edits/lands', steward.token, 'POST', { name: 'Stair Lab', biome: 'frostpeak' });
    expect(made.body).toEqual({ ok: true, region: 'workshop-stair-lab' });
    expect((await api(first.base, '/api/world-edits/lands', steward.token, 'POST', { name: 'stair lab', biome: 'frostpeak' })).status).toBe(400);
    const lab = () => app!.world.region('workshop-stair-lab')!;
    // Blank, off the grid: no roads, and nothing beside it.
    expect(lab().def).toMatchObject({ workshop: true, layout: 'blank', exits: {} });
    expect(lab().map.buildings).toEqual([]);
    expect(app!.world.neighbours(lab().def)).toEqual([]);
    expect(app!.world.home.def.exits).toEqual({ north: 'frostpeak', west: 'woods', east: 'shore', south: 'desert' });

    // The testbed as a file, laid on the new land: the same buildings, floors and stairs.
    const file = await api(first.base, '/api/world-edits?region=arch-testbed&export=1', steward.token);
    expect(file.body.edits.length).toBeGreaterThan(30);
    expect(file.body.edits[0]).not.toHaveProperty('id');
    const loaded = await api(first.base, '/api/world-edits/import', steward.token, 'POST', { region: 'workshop-stair-lab', live: true, drafts: file.body.edits });
    expect(loaded.body.applied).toBe(file.body.edits.length);
    const testbed = app!.world.region('arch-testbed')!.map;
    const shape = (m: RegionMap) => ({ buildings: m.buildings.map(({ id: _, style, ...b }) => b), storeys: m.storeys.length, stairways: m.stairways.map(({ id: _, ...s }) => s) });
    expect(shape(lab().map)).toEqual(shape(testbed));

    await stop();
    await start({ store });
    expect(lab().def.name).toBe('Stair Lab');
    expect(lab().map.stairways).toHaveLength(testbed.stairways.length);
  });

  it('points at things by name and works on floors above the ground', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Ego', 'owner');
    const gone = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'arch-testbed', live: true, edit: { kind: 'move', from: [30, 30], to: [31, 31], target: 'gen:landmark:99' } });
    expect(gone).toMatchObject({ status: 400, body: { message: 'That is not there any more.' } });
    const upstairs = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'arch-testbed', live: true, edit: { kind: 'spawn', creature: 'walking-mushroom', at: [104, 46], count: 1, level: 1 } });
    expect(upstairs.status).toBe(200);
    expect(upstairs.body.edits[0]).toMatchObject({ kind: 'spawn', level: 1 });
    expect(upstairs.body.unlaid).toEqual([]);
    expect(app!.world.region('arch-testbed')!.map.creatures.some((c) => c.floor === 1)).toBe(true);
    const ground = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'arch-testbed', live: true, edit: { kind: 'road', from: [104, 46], to: [106, 46], level: 1 } });
    expect(ground.body.message).toBe('The Road tool works on the ground floor for now.');
  });

  it('moves a house as one step: undo, redo and take out treat its two edits as one', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Ego', 'owner');
    const land = () => app!.world.region('arch-testbed')!.map;
    const at = (x: number, y: number) => land().buildings.some((b) => b.x === x && b.y === y);
    const move = { region: 'arch-testbed', live: true, edits: [{ kind: 'remove', at: [56, 40], target: 'testbed-02:building:0' }, { kind: 'house', at: [160, 100], floor: [8, 8], style: 'sanctum-inn' }] };
    const moved = await api(base, '/api/world-edits', owner.token, 'POST', move);
    expect(moved.status).toBe(200);
    expect(moved.body.edits).toHaveLength(2);
    expect(moved.body.edits[0].group).toBeTruthy();
    expect(moved.body.edits[1].group).toBe(moved.body.edits[0].group);
    expect([at(56, 40), at(160, 100)]).toEqual([false, true]);

    expect((await api(base, '/api/world-edits/undo', owner.token, 'POST', { region: 'arch-testbed' })).body).toMatchObject({ edits: [], undone: 2 });
    expect([at(56, 40), at(160, 100)]).toEqual([true, false]);
    expect((await api(base, '/api/world-edits/redo', owner.token, 'POST', { region: 'arch-testbed' })).body).toMatchObject({ undone: 0 });
    expect([at(56, 40), at(160, 100)]).toEqual([false, true]);
    expect((await api(base, '/api/world-edits/remove', owner.token, 'POST', { region: 'arch-testbed', id: moved.body.edits[1].id })).body).toMatchObject({ edits: [], undone: 2 });

    // All or none: the second does not fit, so the first is not made either.
    const half = { region: 'arch-testbed', live: true, edits: [{ kind: 'remove', at: [56, 40], target: 'testbed-02:building:0' }, { kind: 'house', at: [40, 40], floor: [8, 8], style: 'sanctum-inn' }] };
    expect((await api(base, '/api/world-edits', owner.token, 'POST', half)).status).toBe(400);
    expect(at(56, 40)).toBe(true);
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
    const result = await editor.add('sanctum', { kind: 'paint', tile: 'rock', tiles: [spot] }, 'Ego', true);
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
