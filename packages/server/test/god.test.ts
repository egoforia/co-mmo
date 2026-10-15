import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { CREATURES, ITEMS, type GodMessage } from '@co-mmo/shared';
import type { ChatModel } from '../src/ai/chat.ts';
import { parseGodReply } from '../src/god.ts';
import { account, api, app, connect, joined, pray, start, stop, wish } from './helpers.ts';

describe('the God', () => {
  it('reads model JSON and falls back to plain speech', () => {
    expect(parseGodReply('Hello there')).toEqual({ say: 'Hello there' });
    const r = parseGodReply('```json\n{"say":"Yes","wish":{"tier":"minor","title":"Hat","summary":"A hat."}}\n```');
    expect(r.wish).toMatchObject({ tier: 'minor', title: 'Hat' });
  });

  it('chats without offering a wish when nothing is asked for', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara', 'owner');
    const c = await joined(ws, p.token);
    const answer = await pray(c, 'Hello, who are you?');
    expect(answer.card).toBeUndefined();
    expect(answer.say).toMatch(/wish/);
  });

  it('grants an item wish into the bag, charges Favor, and paints its art', async () => {
    const { store, ws, artDir, painter } = await start();
    const p = account(store, 'Mara', 'owner');
    const c = await joined(ws, p.token);
    const card = await wish(c, 'I wish for a glowing blue hat');
    expect(card).toMatchObject({ tier: 'minor', cost: 2, instant: true });

    const character = await c.waitFor<any>((m) => m.t === 'character' && m.character.inventory.length > 1);
    const record = store.content[0]!;
    expect(record).toMatchObject({ status: 'granted', tier: 'minor', title: 'Glowing Blue Hat' });
    expect(character.character.favor).toBe(8);
    expect(character.character.inventory.map((s: any) => s.item)).toContain(record.id);
    expect(ITEMS[record.id]?.name).toBe('Glowing Blue Hat');
    await c.waitFor((m) => m.t === 'system' && m.text.includes("Mara's wish"));

    await Promise.all([...app!.wishes.painting]);
    expect((painter as any).calls).toBe(1);
    const png = await sharp(await readFile(join(artDir, `${record.id}.png`))).metadata();
    expect([png.width, png.height]).toEqual([128, 128]);
    expect(store.contentById(record.id)!.art).toMatch(new RegExp(`^/wished-art/${record.id}\\.png`));
    expect(store.spendThisMonth(Date.now()).filter((s) => s.kind === 'image')).toHaveLength(1);

    // God's View keeps exactly what was sent to the image model; players never receive it.
    const sent = store.contentById(record.id)!.artPrompts![record.id]!;
    expect(sent).toMatchObject({ provider: 'fake', model: 'fake-image', prompt: (painter as any).prompts[0], references: [] });
    expect(sent.prompt).toContain('Subject: Glowing Blue Hat (item).');
    const { publicEntry } = await import('../src/wishes.ts');
    expect(publicEntry(store.contentById(record.id)!)).not.toHaveProperty('artPrompts');
  });

  it('spawns wished creatures near the player, and pays the wisher Favor when others defeat them', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara', 'owner');
    const c = await joined(ws, p.token);
    await wish(c, 'Please make a pink slime');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('Look around'));
    const record = store.content[0]!;
    expect(record.placements).toHaveLength(3);
    const region = app!.world.region('sanctum')!;
    const ids = region.creatureIds().filter((id) => region.creature(id)?.kind === record.id);
    expect(ids).toHaveLength(3);
    const snap = await c.waitFor<any>((m) => m.t === 'snapshot' && m.creatures.some((cr: any) => cr.kind === record.id));
    expect(snap.creatures.find((cr: any) => cr.kind === record.id).asset).toBe(`wished-${record.id}`);
  });

  it('places a wished person who talks', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara', 'owner');
    const c = await joined(ws, p.token);
    await wish(c, 'I want a fish trader here');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('Look around'));
    await c.send({ t: 'interact' });
    const talk = await c.waitFor<any>((m) => m.t === 'dialogue');
    expect(talk.npc.name).toBe('Fish Trader');
    expect(talk.text).toContain('Fish Trader');
  });

  it('refuses griefing, and checks Favor before granting', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara', 'owner');
    const c = await joined(ws, p.token);
    const refused = await pray(c, 'I want you to destroy their house');
    expect(refused.card).toBeUndefined();
    expect(store.content).toHaveLength(0);

    app!.world.local('sanctum')!.updateCharacter(p.id, (ch) => (ch.favor = 1));
    await wish(c, 'I wish for a red hat');
    const poor = await c.waitFor<GodMessage>((m) => m.t === 'god');
    expect(poor.say).toMatch(/needs 2 Favor/);
    expect(store.content).toHaveLength(0);
  });

  it('records a major wish for review, and a Steward decides it', async () => {
    const { store, ws, base } = await start();
    const p = account(store, 'Ilya');
    const steward = account(store, 'Mara', 'steward');
    const c = await joined(ws, p.token);
    // The offline God cannot script weather, so this one waits for people to build it.
    const card = await wish(c, 'I wish it would rain on the weather of the world');
    expect(card).toMatchObject({ tier: 'major', instant: false, cost: 0 });
    await c.waitFor((m) => m.t === 'god' && m.say.includes('Stewards'));
    const record = store.content[0]!;
    expect(record.status).toBe('pending');
    await Promise.all([...app!.wishes.drafts]);
    expect(store.contentById(record.id)!.draft).toMatchObject({ state: 'impossible' });

    expect((await api(base, `/api/admin/content/${record.id}/review`, p.token, 'POST', { approve: true })).status).toBe(403);
    expect((await api(base, `/api/admin/content/${record.id}/review`, steward.token, 'POST', { approve: true })).status).toBe(200);
    expect(store.contentById(record.id)!.status).toBe('approved');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('approved'));
  });

  it('rolls a wish back everywhere, including bags', async () => {
    const { store, ws, base } = await start();
    const p = account(store, 'Mara', 'owner');
    const c = await joined(ws, p.token);
    await wish(c, 'I wish for a golden ring');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('bag'));
    const record = store.content[0]!;
    expect((await api(base, `/api/admin/content/${record.id}/rollback`, p.token, 'POST')).status).toBe(200);
    expect(ITEMS[record.id]).toBeUndefined();
    expect(store.contentById(record.id)!.status).toBe('rolled-back');
    const bag = app!.world.region('sanctum')!.character(p.id)!.inventory.map((s) => s.item);
    expect(bag).not.toContain(record.id);
    await c.waitFor((m) => m.t === 'content' && m.entries.some((e) => e.id === record.id && e.status === 'rolled-back'));
  });

  it('brings granted wishes back after a restart and tells joining players about them', async () => {
    const first = await start();
    const p = account(first.store, 'Mara', 'owner');
    const c = await joined(first.ws, p.token);
    await wish(c, 'Please make a purple beetle');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('Look around'));
    const record = first.store.content[0]!;
    c.socket.close();
    await stop();
    delete CREATURES[record.id];

    const again = await start({ store: first.store });
    expect(CREATURES[record.id]?.name).toBe('Purple Beetle');
    const region = app!.world.region('sanctum')!;
    expect(region.creatureIds().filter((id) => region.creature(id)?.kind === record.id)).toHaveLength(3);
    const c2 = connect(again.ws, p.token);
    const content = await c2.waitFor<any>((m) => m.t === 'content' && m.replace);
    expect(content.entries.map((e: any) => e.id)).toContain(record.id);
    expect(content.entries[0].conversation).toBeUndefined();
  });

  it('uses the offline God and stops painting once the budget is spent', async () => {
    const calls: string[] = [];
    const paid: ChatModel = {
      provider: 'gemini',
      model: 'paid',
      async complete() {
        calls.push('paid');
        return { text: '{"say":"paid","wish":null}', inputTokens: 1, outputTokens: 1, usd: 0.01 };
      },
    };
    const { store, ws } = await start({ chat: () => [paid] });
    store.updateSettings({ ...store.settings, budget: { monthlyUsd: 0.005, warnUsd: 0 } });
    const p = account(store, 'Mara', 'owner');
    const c = await joined(ws, p.token);
    expect((await pray(c, 'hello')).say).toBe('paid');
    expect(app!.wishes.budget()).toMatchObject({ over: true, warn: true });
    await wish(c, 'I wish for a red hat');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('bag'));
    expect(calls).toEqual(['paid']);
    expect(app!.wishes.painting.size).toBe(0);
  });
});

describe("God's View API", () => {
  it('keeps players out, Stewards out of owner panels, and lets the Owner switch models', async () => {
    const { store, base } = await start();
    const owner = account(store, 'egoforia', 'owner');
    const steward = account(store, 'Mara', 'steward');
    const player = account(store, 'Ilya');

    expect((await fetch(`${base}/api/admin/overview`)).status).toBe(401);
    expect((await api(base, '/api/admin/overview', player.token)).status).toBe(403);
    const overview = await api(base, '/api/admin/overview', steward.token);
    expect(overview.status).toBe(200);
    expect(overview.body.budget).toBeNull();
    expect(overview.body.regions.map((r: any) => r.id)).toContain('sanctum');
    expect((await api(base, '/api/admin/ai', steward.token)).status).toBe(403);
    expect((await api(base, '/api/admin/budget', steward.token)).status).toBe(403);

    const ai = await api(base, '/api/admin/ai', owner.token);
    expect(ai.body.providers.find((p: any) => p.id === 'gemini')).toMatchObject({ keySet: false, keyName: 'GEMINI_API_KEY' });
    expect(JSON.stringify(ai.body)).not.toMatch(/AIza/);

    const put = await api(base, '/api/admin/ai', owner.token, 'PUT', { god: { provider: 'anthropic', model: 'claude-haiku-5-5' }, fallback: { provider: 'offline' }, image: { provider: 'none' } });
    expect(put.status).toBe(200);
    expect(store.settings.ai.god).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(store.settings.ai.fallback).toEqual({ provider: 'offline', model: 'scripted' });
    expect((await api(base, '/api/admin/ai', owner.token, 'PUT', { god: { provider: 'skynet' } })).status).toBe(400);

    const test = await api(base, '/api/admin/ai/test', owner.token, 'POST', { prompt: 'I wish for a hat' });
    expect(test.status).toBe(200);
    expect(test.body.reply.wish.tier).toBe('minor');

    expect((await api(base, '/api/admin/budget', owner.token, 'PUT', { monthlyUsd: 40, warnUsd: 50 })).status).toBe(400);
    expect((await api(base, '/api/admin/budget', owner.token, 'PUT', { monthlyUsd: 60, warnUsd: 45 })).status).toBe(200);
    expect((await api(base, '/api/admin/budget', owner.token)).body).toMatchObject({ monthlyUsd: 60, warnUsd: 45 });

    const players = await api(base, '/api/admin/players', owner.token);
    expect(players.body.players.map((p: any) => p.name)).toEqual(['egoforia', 'Mara', 'Ilya']);
    expect((await api(base, `/api/admin/players/${player.id}/role`, steward.token, 'POST', { role: 'steward' })).status).toBe(403);
    expect((await api(base, `/api/admin/players/${player.id}/role`, owner.token, 'POST', { role: 'steward' })).status).toBe(200);
    expect(store.accountById(player.id)!.role).toBe('steward');
    expect((await api(base, `/api/admin/players/${owner.id}/role`, owner.token, 'POST', { role: 'player' })).status).toBe(404);
  });
});
