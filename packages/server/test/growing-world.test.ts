import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { CREATURES, WISHED_REGIONS, newCharacter, regionFromWish, type WelcomeMessage } from '@co-mmo/shared';
import { account, api, app, joined, pray, start, stop } from './helpers.ts';

/** A player standing in Whispering Woods, at the world's west edge, with Favor to spend. */
async function inTheWoods(favor = 20) {
  const ctx = await start();
  const p = account(ctx.store, 'Mara', 'owner');
  ctx.store.savePosition(p.id, 32, 33, 'woods', { ...newCharacter(), favor });
  const c = await joined(ctx.ws, p.token);
  return { ...ctx, p, c };
}

describe('a growing world', () => {
  it('offers a region beyond the nearest open edge, at a region price', async () => {
    const { c } = await inTheWoods();
    const answer = await pray(c, 'I wish for a snowy land of frost');
    expect(answer.card).toMatchObject({ tier: 'moderate', cost: 12, instant: true });
    expect(answer.card!.where).toMatch(/^Beyond the (north|south|west) edge of Whispering Woods$/);
  });

  it('grows the world: a new region with roads to its neighbours, its creatures and a credit line', async () => {
    const { store, c, p } = await inTheWoods();
    const answer = await pray(c, 'I wish for a snowy land of frost');
    const side = answer.card!.where.split(' ')[2]!;
    await c.send({ t: 'wish', card: answer.card!.id, confirm: true });
    // The woods change around the player: a fresh welcome shows the new neighbour.
    const again = await c.waitFor<WelcomeMessage>((m) => m.t === 'welcome');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('A road now leads'));
    const record = store.content.find((r) => r.definition?.kind === 'region')!;
    expect(record).toMatchObject({ status: 'granted', favor: 12 });
    expect(app!.world.regionOf(p.id)!.character(p.id)!.favor).toBe(8);

    const region = app!.world.region(record.id)!;
    expect(region.def).toMatchObject({ biome: 'frostpeak', name: 'New Frostpeak', at: record.cell });
    expect(region.def.wild?.wisher).toBe('Mara');
    const woods = app!.world.region('woods')!;
    expect(woods.def.exits[side as 'north']).toBe(record.id);
    expect(Object.values(region.def.exits)).toContain('woods');
    expect(again.region.def.exits[side as 'north']).toBe(record.id);
    expect(again.neighbours.map((n) => n.id)).toContain(record.id);
    // Its own creature, as strong as the land is dangerous, roams it.
    const kind = region.def.wild!.creatures[0]!.kind;
    expect(CREATURES[kind]).toMatchObject({ name: 'Frostpeak Wanderer', level: 2 });
    expect(region.creatureIds().length).toBeGreaterThan(0);
    // The road out of the woods is clear all the way to the new edge.
    expect(woods.map.entries[side as 'north']).toBeDefined();
  });

  it('walks a player into the wished region, tells them who wished it, and pays the wisher', async () => {
    const { store, c, ws } = await inTheWoods();
    const answer = await pray(c, 'I wish for a gentle meadow land');
    await c.send({ t: 'wish', card: answer.card!.id, confirm: true });
    await c.waitFor((m) => m.t === 'god' && m.say.includes('A road now leads'));
    const record = store.content.find((r) => r.definition?.kind === 'region')!;
    const side = Object.entries(app!.world.region('woods')!.def.exits).find(([, id]) => id === record.id)![0] as 'north' | 'south' | 'west';

    // Someone else walks over the edge.
    const ilya = account(store, 'Ilya');
    store.savePosition(ilya.id, 32, 33, 'woods', newCharacter());
    const other = await joined(ws, ilya.token);
    const woods = app!.world.region('woods')!;
    const entry = woods.map.entries[side]!;
    const out = { north: [entry.x, 0.2], south: [entry.x, 63.8], west: [0.2, entry.y] }[side];
    woods.placePlayer(ilya.id, out[0]!, out[1]!);
    const step = { north: [0, -1], south: [0, 1], west: [-1, 0] }[side];
    for (let i = 1; i <= 3; i++) await other.send({ t: 'input', seq: i, dx: step[0], dy: step[1] });
    const arrived = await other.waitFor<WelcomeMessage>((m) => m.t === 'welcome' && m.region.id === record.id);
    expect(arrived.region.def.wild?.wisher).toBe('Mara');
    await other.waitFor((m) => m.t === 'notice' && m.text.includes('wished into being by Mara'));
    // Visiting a wished land earns its wisher Creator XP.
    await c.waitFor((m) => m.t === 'character' && m.character.creatorXp > 0);
  });

  it('paints a new biome once: seamless ground and water, trees and a rock, then its creature', async () => {
    const { store, c, artDir, painter, base, p } = await inTheWoods(40);
    const first = await pray(c, 'I wish for a land of fire and ash');
    await c.send({ t: 'wish', card: first.card!.id, confirm: true });
    await c.waitFor((m) => m.t === 'god' && m.say.includes('A road now leads'));
    await Promise.all([...app!.wishes.painting]);
    // Ground, water, two trees, a rock, and the new creature.
    expect((painter as any).calls).toBe(6);
    const record = store.content.find((r) => r.definition?.kind === 'region')!;
    expect(Object.keys(store.contentById(record.id)!.kitArt ?? {}).sort()).toEqual(
      ['ember-wastes-ground', 'ember-wastes-rock', 'ember-wastes-tree-a', 'ember-wastes-tree-b', 'ember-wastes-water'],
    );
    const ground = await sharp(await readFile(join(artDir, 'biomes', 'ember-wastes-ground.png'))).metadata();
    expect([ground.width, ground.height]).toEqual([128, 128]);
    const tree = await sharp(await readFile(join(artDir, 'biomes', 'ember-wastes-tree-a.png'))).metadata();
    expect([tree.width, tree.height]).toEqual([192, 256]);
    const art = await api(base, '/api/art', p.token);
    expect(art.body['ember-wastes-ground']?.file).toMatch(/^\/wished-art\/biomes\/ember-wastes-ground\.png/);
    const served = await fetch(`${base}/wished-art/biomes/ember-wastes-ground.png`);
    expect(served.status).toBe(200);

    // A second region of the same biome reuses the kit: only its creature is painted.
    app!.world.regionOf(p.id)!.placePlayer(p.id, 32, 33);
    const second = await pray(c, 'I wish for another land of fire and ash');
    await c.send({ t: 'wish', card: second.card!.id, confirm: true });
    await c.waitFor((m) => m.t === 'god' && m.say.includes('A road now leads'));
    await Promise.all([...app!.wishes.painting]);
    expect((painter as any).calls).toBe(7);
  });

  it('turns a region wish away where every edge already meets another land', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara', 'owner');
    store.savePosition(p.id, 32, 36, 'sanctum', { ...newCharacter(), favor: 20 });
    const c = await joined(ws, p.token);
    // The Sanctum has a free edge to the north; fill it first.
    app!.world.addRegion({ ...regionFromWish({ id: 'w-north', wisher: { id: 'x', name: 'X' }, cell: { x: 0, y: -1 }, definition: { kind: 'region', name: 'North', description: '', biome: 'verdant-meadows', danger: 1, trees: 1, rocks: 1, water: 1, creatures: [{ existing: 'walking-mushroom', count: 2 }] } })! });
    const answer = await pray(c, 'I wish for a snowy land');
    expect(answer.card).toBeUndefined();
    expect(answer.say).toMatch(/world's edge/);
  });

  it('keeps wished regions over a restart, and a rollback carries players home', async () => {
    const { store, c, p } = await inTheWoods();
    const answer = await pray(c, 'I wish for a swamp land');
    await c.send({ t: 'wish', card: answer.card!.id, confirm: true });
    await c.waitFor((m) => m.t === 'god' && m.say.includes('A road now leads'));
    const record = store.content.find((r) => r.definition?.kind === 'region')!;
    await stop();

    const again = await start({ store });
    expect(app!.world.region(record.id)?.def.biome).toBe('murkmire-swamp');
    expect(Object.values(app!.world.region('woods')!.def.exits)).toContain(record.id);
    store.savePosition(p.id, 32, 33, record.id);
    const back = await joined(again.ws, p.token);
    expect(app!.world.regionOf(p.id)?.def.id).toBe(record.id);

    const undone = await api(again.base, `/api/admin/content/${record.id}/rollback`, p.token, 'POST');
    expect(undone.status).toBe(200);
    expect(app!.world.region(record.id)).toBeUndefined();
    expect(WISHED_REGIONS.has(record.id)).toBe(false);
    expect(Object.values(app!.world.region('woods')!.def.exits)).not.toContain(record.id);
    await back.waitFor((m) => m.t === 'welcome' && (m as WelcomeMessage).region.id === 'sanctum');
    expect(app!.world.regionOf(p.id)?.def.id).toBe('sanctum');
  });
});
