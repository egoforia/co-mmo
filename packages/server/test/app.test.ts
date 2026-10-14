import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { ServerMessage } from '@co-mmo/shared';
import { createApp, type App } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { OfflineGod } from '../src/god.ts';

let app: App | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function start(heartbeatMs?: number) {
  const store = Store.memory();
  app = createApp({
    store,
    publicUrl: 'http://game.test',
    heartbeatMs,
    wishes: { env: {}, anchorDir: '/nonexistent', artDir: '/nonexistent', chatModel: () => [new OfflineGod()] },
  });
  await new Promise<void>((resolve) => app!.server.listen(0, resolve));
  const port = (app.server.address() as AddressInfo).port;
  return { store, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
}

async function post(url: string, body: unknown, token?: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function connect(url: string, token: string) {
  const socket = new WebSocket(url);
  const messages: ServerMessage[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', token })));
  const waitFor = async (pred: (m: ServerMessage) => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = messages.find(pred);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for message');
  };
  return { socket, messages, waitFor };
}

describe('invites and sign-in', () => {
  it('makes the bootstrap invite user the Owner, who can invite players', async () => {
    const { store, base } = await start();
    const ownerInvite = store.createInvite(null, 'owner');

    expect(await (await fetch(`${base}/api/invites/${ownerInvite.code}`)).json()).toMatchObject({ valid: true, role: 'owner' });

    const noAdult = await post(`${base}/api/accept`, { code: ownerInvite.code, name: 'egoforia' });
    expect(noAdult.status).toBe(400);
    expect(noAdult.body.error).toBe('adult_required');

    const owner = await post(`${base}/api/accept`, { code: ownerInvite.code, name: 'egoforia', adult: true });
    expect(owner.status).toBe(200);
    expect(owner.body.player.role).toBe('owner');

    const reused = await post(`${base}/api/accept`, { code: ownerInvite.code, name: 'Other', adult: true });
    expect(reused.body.error).toBe('invite_invalid');

    const invite = await post(`${base}/api/invites`, {}, owner.body.token);
    expect(invite.body.url).toMatch(/^http:\/\/game\.test\/\?invite=/);

    const dupe = await post(`${base}/api/accept`, { code: invite.body.code, name: 'EGOFORIA', adult: true });
    expect(dupe.body.error).toBe('name_taken');

    const mara = await post(`${base}/api/accept`, { code: invite.body.code, name: 'Mara', adult: true });
    expect(mara.body.player).toMatchObject({ name: 'Mara', role: 'player' });

    expect((await post(`${base}/api/invites`, {})).status).toBe(401);
  });
});

describe('game connection', () => {
  it('lets two players see each other move and chat', async () => {
    const { store, base, ws } = await start();
    const a = store.acceptInvite(store.createInvite(null).code, 'Mara', 'sanctum');
    const b = store.acceptInvite(store.createInvite(null).code, 'Ilya', 'sanctum');

    const ca = connect(ws, a.token);
    await ca.waitFor((m) => m.t === 'welcome');
    const cb = connect(ws, b.token);
    await cb.waitFor((m) => m.t === 'welcome');

    for (let seq = 1; seq <= 5; seq++) ca.socket.send(JSON.stringify({ t: 'input', seq, dx: 1, dy: 0 }));
    const seen = await cb.waitFor(
      (m) => m.t === 'snapshot' && m.players.some((p) => p.name === 'Mara' && p.x > app!.world.home.map.spawn.x + 0.5),
    );
    expect(seen).toBeTruthy();

    ca.socket.send(JSON.stringify({ t: 'chat', channel: 'say', text: 'hello Ilya' }));
    await cb.waitFor((m) => m.t === 'chat' && m.text === 'hello Ilya');

    ca.socket.close();
    await cb.waitFor((m) => m.t === 'system' && m.text === 'Mara left.');
    expect(store.accountById(a.account.id)!.x).toBeGreaterThan(app!.world.home.map.spawn.x);
    cb.socket.close();
  });

  it('rejects a bad token', async () => {
    const { ws } = await start();
    const c = connect(ws, 'nope');
    const closed = await new Promise<number>((resolve) => c.socket.on('close', (code) => resolve(code)));
    expect(closed).toBe(4001);
  });

  it('keeps answering clients connected and drops silent ones', async () => {
    const { store, ws } = await start(50);
    const invite = store.createInvite(null, 'player');
    const a = store.acceptInvite(invite.code, 'Mara', 'sanctum');
    const live = connect(ws, a.token);
    await live.waitFor((m) => m.t === 'welcome');
    const silent = new WebSocket(ws, { autoPong: false });
    const dropped = await new Promise<number>((resolve) => silent.on('close', (code) => resolve(code)));
    expect(dropped).toBe(1006);
    expect(live.socket.readyState).toBe(WebSocket.OPEN);
    live.socket.close();
  });
});
