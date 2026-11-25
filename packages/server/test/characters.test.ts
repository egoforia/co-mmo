import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage, WelcomeMessage } from '@co-mmo/shared';
import { account, api, app, joined, start } from './helpers.ts';

// Several characters on one account (docs/characters.md): the character
// screen's routes, entering the world as the chosen one, and the role,
// suspension and sign-in that belong to the whole account.

/** Signs in on the game socket as one chosen character. */
function enterAs(ws: string, token: string, character?: string) {
  const socket = new WebSocket(ws);
  const messages: ServerMessage[] = [];
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', token, ...(character ? { character } : {}) })));
  const welcome = async (): Promise<WelcomeMessage> => {
    for (let i = 0; i < 300; i++) {
      const m = messages.find((x) => x.t === 'welcome');
      if (m) return m as WelcomeMessage;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('no welcome');
  };
  return { socket, closed, welcome };
}

const NEW = { race: 'ursine', calling: 'warden' };

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

describe('several characters on one account', () => {
  it('lists, makes and enters the world as each character', async () => {
    const { base, ws, store } = await start();
    const mara = account(store, 'Mara');
    const list = await api(base, '/api/characters', mara.token);
    expect(list.status).toBe(200);
    expect(list.body.characters.map((c: { name: string }) => c.name)).toEqual(['Mara']);
    expect(list.body.max).toBe(5);

    const made = await api(base, '/api/characters', mara.token, 'POST', { name: 'Ilya', ...NEW });
    expect(made.status).toBe(200);
    const after = await api(base, '/api/characters', mara.token);
    expect(after.body.characters.map((c: { name: string }) => c.name)).toEqual(['Mara', 'Ilya']);
    // The new one is played next, as the God's View and Account window see it too.
    expect(after.body.playing).toBe(made.body.id);
    expect((await api(base, '/api/me', mara.token)).body.player.name).toBe('Ilya');
    const ilya = store.accountById(made.body.id)!;
    expect(ilya.character).toMatchObject({ race: 'ursine', calling: 'warden', level: 1 });
    expect(ilya.tokenHash).toBe('');

    expect((await enterAs(ws, mara.token).welcome()).you.name).toBe('Ilya');
    const first = enterAs(ws, mara.token, mara.id);
    expect((await first.welcome()).you).toMatchObject({ id: mara.id, name: 'Mara' });
    expect(store.accountById(mara.id)!.playing).toBeUndefined();
  });

  it('takes the other character out of the world when one enters', async () => {
    const { base, ws, store } = await start();
    const mara = account(store, 'Mara');
    const ilya = (await api(base, '/api/characters', mara.token, 'POST', { name: 'Ilya', ...NEW })).body.id as string;
    const first = enterAs(ws, mara.token, mara.id);
    await first.welcome();
    expect(app!.world.has(mara.id)).toBe(true);
    const second = enterAs(ws, mara.token, ilya);
    await second.welcome();
    expect(await first.closed).toBe(4000);
    await until(() => !app!.world.has(mara.id));
    expect(app!.world.has(ilya)).toBe(true);
  });

  it('never plays a character from another account', async () => {
    const { base, ws, store } = await start();
    const mara = account(store, 'Mara');
    const tomas = account(store, 'Tomas');
    expect((await api(base, `/api/characters/${mara.id}/play`, tomas.token, 'POST')).status).toBe(404);
    expect((await enterAs(ws, tomas.token, mara.id).welcome()).you.name).toBe('Tomas');
    expect((await api(base, `/api/characters/${mara.id}`, tomas.token, 'DELETE', { name: 'Mara' })).status).toBe(404);
  });

  it('keeps to the Owner\'s limit and to free names', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Owner', 'owner');
    const mara = account(store, 'Mara');
    expect((await api(base, '/api/admin/players/limit', mara.token, 'POST', { maxCharacters: 9 })).status).toBe(403);
    expect((await api(base, '/api/admin/players/limit', owner.token, 'POST', { maxCharacters: 2 })).status).toBe(200);
    expect((await api(base, '/api/characters', mara.token, 'POST', { name: 'Owner', ...NEW })).body.error).toBe('name_taken');
    expect((await api(base, '/api/characters', mara.token, 'POST', { name: 'Ilya', ...NEW })).status).toBe(200);
    const third = await api(base, '/api/characters', mara.token, 'POST', { name: 'Petra', ...NEW });
    expect(third.status).toBe(400);
    expect(third.body.message).toContain('2 characters');
  });

  it('deletes a character once its name is typed, and hands the sign-in on', async () => {
    const { base, store } = await start();
    const mara = account(store, 'Mara');
    const ilya = (await api(base, '/api/characters', mara.token, 'POST', { name: 'Ilya', ...NEW })).body.id as string;
    expect((await api(base, `/api/characters/${mara.id}`, mara.token, 'DELETE', { name: 'Ilia' })).status).toBe(400);
    // Deleting the first character: the same sign-in now opens Ilya.
    expect((await api(base, `/api/characters/${mara.id}`, mara.token, 'DELETE', { name: 'mara' })).status).toBe(200);
    expect(store.accountById(mara.id)).toBeUndefined();
    expect(store.accountByToken(mara.token)?.id).toBe(ilya);
    expect(store.accountById(ilya)!.mainId).toBeUndefined();
    const left = await api(base, '/api/characters', mara.token);
    expect(left.body.characters.map((c: { name: string }) => c.name)).toEqual(['Ilya']);
    const last = await api(base, `/api/characters/${ilya}`, mara.token, 'DELETE', { name: 'Ilya' });
    expect(last.status).toBe(400);
    expect(last.body.message).toContain('only character');
  });

  it('gives every character the account\'s role and suspension', async () => {
    const { base, store, ws } = await start();
    const owner = account(store, 'Owner', 'owner');
    const mara = account(store, 'Mara');
    const ilya = (await api(base, '/api/characters', mara.token, 'POST', { name: 'Ilya', ...NEW })).body.id as string;
    expect((await api(base, `/api/admin/players/${ilya}/role`, owner.token, 'POST', { role: 'steward' })).status).toBe(200);
    expect(store.accountById(mara.id)!.role).toBe('steward');
    expect(store.accountById(ilya)!.role).toBe('steward');
    // A character made later starts with the account's role.
    const petra = (await api(base, '/api/characters', mara.token, 'POST', { name: 'Petra', ...NEW })).body.id as string;
    expect(store.accountById(petra)!.role).toBe('steward');
    // Nobody suspends their own account through one of its other characters.
    expect((await api(base, `/api/admin/players/${mara.id}/suspend`, mara.token, 'POST', { suspend: true })).status).toBe(403);

    await joined(ws, mara.token);
    const players = await api(base, '/api/admin/players', owner.token);
    expect(players.body.players.find((p: { id: string }) => p.id === ilya).characterOf).toBe('Mara');
    expect((await api(base, `/api/admin/players/${mara.id}/role`, owner.token, 'POST', { role: 'player' })).status).toBe(200);
    expect((await api(base, `/api/admin/players/${ilya}/suspend`, owner.token, 'POST', { suspend: true, reason: 'rude' })).status).toBe(200);
    expect(store.accountById(mara.id)!.suspended?.reason).toBe('rude');
    expect((await api(base, '/api/characters', mara.token)).status).toBe(403);
  });
});
