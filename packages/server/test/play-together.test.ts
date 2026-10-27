import { describe, expect, it } from 'vitest';
import type { AwayMessage, ContentMessage } from '@co-mmo/shared';
import { account, api, app, fakeMailer, joined, start, wish } from './helpers.ts';

const linkCode = (text: string) => new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get('login')!;

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('joining', () => {
  it('a new player can give an email and describe their look, their first free wish', async () => {
    const mailer = fakeMailer();
    const { base, store } = await start({ mailer });
    const owner = account(store, 'Owner', 'owner');
    const invite = store.createInvite(owner.id);
    const res = await post(base, '/api/accept', { code: invite.code, name: 'Mara', adult: true, email: 'Mara@Example.com', look: 'A tall elf in a green hood with a lantern.', race: 'falcon', calling: 'ranger' });
    expect(res.status).toBe(200);
    expect(res.body.notes[0]).toMatch(/mara@example.com/);

    // The look is a granted wish, free, and painted.
    await Promise.all([...app!.wishes.painting]);
    const look = store.content.find((c) => c.definition?.kind === 'player')!;
    expect(look).toMatchObject({ wisher: { name: 'Mara' }, status: 'granted', favor: 0, title: "Mara's look" });
    expect(look.definition).toMatchObject({ description: 'A tall elf in a green hood with a lantern.', look: { color: '#38b764' } });
    expect(look.art).toMatch(/^\/wished-art\//);
    const info = await api(base, '/api/account', res.body.token);
    expect(info.body.look.description).toBe('A tall elf in a green hood with a lantern.');
    // Only once.
    expect((await api(base, '/api/account/look', res.body.token, 'POST', { look: 'a dragon' })).status).toBe(400);

    // The email is used once confirmed.
    expect(info.body.email).toBeNull();
    expect(mailer.sent[0]!.to).toBe('mara@example.com');
    const confirmed = await post(base, '/api/auth/redeem', { code: linkCode(mailer.sent[0]!.text) });
    expect(confirmed.status).toBe(200);
    expect((await api(base, '/api/account', confirmed.body.token)).body.email).toBe('mara@example.com');
  });

  it('turns down an email another player uses before using up the invite', async () => {
    const { base, store } = await start();
    const mara = account(store, 'Mara');
    store.setEmail(mara.id, 'mara@example.com');
    const invite = store.createInvite(null);
    const res = await post(base, '/api/accept', { code: invite.code, name: 'Ilya', adult: true, email: 'mara@example.com', race: 'scorpid', calling: 'duelist' });
    expect(res.body.error).toBe('email_taken');
    expect(store.findInvite(invite.code)!.usedBy).toBeNull();
  });

  it('a player who already plays can describe their look from Account', async () => {
    const { base, store } = await start();
    const mara = account(store, 'Mara');
    const c = await joined(`${base.replace('http', 'ws')}/ws`, mara.token);
    expect((await api(base, '/api/account/look', mara.token, 'POST', { look: '' })).status).toBe(400);
    expect((await api(base, '/api/account/look', mara.token, 'POST', { look: 'A stout dwarf with a red beard' })).status).toBe(200);
    const content = await c.waitFor<ContentMessage>((m) => m.t === 'content' && m.entries.some((e) => e.definition?.kind === 'player'));
    expect(content.entries[0]!.definition).toMatchObject({ kind: 'player', name: 'Mara' });
  });
});

describe('signing in by email', () => {
  it('emails a one-time link that signs in on another device', async () => {
    const mailer = fakeMailer();
    const { base, store } = await start({ mailer });
    const mara = account(store, 'Mara');
    store.setEmail(mara.id, 'mara@example.com');

    const asked = await post(base, '/api/auth/email', { email: 'MARA@example.com ' });
    expect(asked.body.message).toMatch(/sign-in link is on its way/);
    expect(mailer.sent).toHaveLength(1);
    const code = linkCode(mailer.sent[0]!.text);

    const signedIn = await post(base, '/api/auth/redeem', { code });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.token).not.toBe(mara.token);
    expect((await api(base, '/api/me', signedIn.body.token)).body.player.name).toBe('Mara');
    // The first device stays signed in; the link works once.
    expect((await api(base, '/api/me', mara.token)).status).toBe(200);
    expect((await post(base, '/api/auth/redeem', { code })).status).toBe(400);

    // Signing out ends only that device.
    await api(base, '/api/auth/logout', signedIn.body.token, 'POST');
    expect((await api(base, '/api/me', signedIn.body.token)).status).toBe(401);
    expect((await api(base, '/api/me', mara.token)).status).toBe(200);
  });

  it('says the same for an unknown email, and sends nothing', async () => {
    const mailer = fakeMailer();
    const { base } = await start({ mailer });
    const asked = await post(base, '/api/auth/email', { email: 'nobody@example.com' });
    expect(asked.status).toBe(200);
    expect(asked.body.message).toMatch(/If a player signs in with nobody@example.com/);
    expect(mailer.sent).toHaveLength(0);
    expect((await post(base, '/api/auth/email', { email: 'not an email' })).status).toBe(400);
  });

  it('a link stops working after 15 minutes', async () => {
    const mailer = fakeMailer();
    const clock = { now: Date.now() };
    const { base, store } = await start({ mailer, now: () => clock.now });
    const mara = account(store, 'Mara');
    store.setEmail(mara.id, 'mara@example.com');
    await post(base, '/api/auth/email', { email: 'mara@example.com' });
    clock.now += 16 * 60_000;
    const res = await post(base, '/api/auth/redeem', { code: linkCode(mailer.sent[0]!.text) });
    expect(res.body.message).toMatch(/run out/);
  });
});

describe('signing in with GitHub', () => {
  /** GitHub's side of the sign-in dance, played by a fake. */
  function fakeGitHub(user: { id: number; email: string }) {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('https://github.com/login/oauth/access_token')) return reply({ access_token: 'gh-token' });
      if (url === 'https://api.github.com/user') return reply({ id: user.id, login: 'mara' });
      if (url === 'https://api.github.com/user/emails') return reply([{ email: user.email, primary: true, verified: true }]);
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
  }
  const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' };

  async function roundTrip(base: string, start: string) {
    const state = new URL(start).searchParams.get('state')!;
    const res = await fetch(`${base}/api/auth/github/callback?code=abc&state=${state}`, { redirect: 'manual' });
    return new URL(res.headers.get('location')!);
  }

  it('links GitHub from Account, then signs in with it', async () => {
    const { base, store } = await start({ env, fetch: fakeGitHub({ id: 42, email: 'mara@example.com' }) });
    const mara = account(store, 'Mara');
    expect((await fetch(`${base}/api/auth/options`).then((r) => r.json()))).toMatchObject({ github: true, google: false });

    const link = await api(base, '/api/auth/github/link', mara.token, 'POST');
    expect(link.body.url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    expect(new URL(link.body.url).searchParams.get('redirect_uri')).toBe('http://game.test/api/auth/github/callback');
    const linked = await roundTrip(base, link.body.url);
    expect(linked.searchParams.get('linked')).toBe('github');
    expect(store.accountById(mara.id)!.logins).toEqual([{ provider: 'github', subject: '42' }]);
    // GitHub vouched for the email, so it signs in by email too.
    expect(store.accountById(mara.id)!.email).toBe('mara@example.com');

    const startRes = await fetch(`${base}/api/auth/github/start`, { redirect: 'manual' });
    const back = await roundTrip(base, startRes.headers.get('location')!);
    const signedIn = await post(base, '/api/auth/redeem', { code: back.searchParams.get('login') });
    expect((await api(base, '/api/me', signedIn.body.token)).body.player.name).toBe('Mara');
  });

  it('sends a stranger back with a friendly message', async () => {
    const { base } = await start({ env, fetch: fakeGitHub({ id: 7, email: 'stranger@example.com' }) });
    const startRes = await fetch(`${base}/api/auth/github/start`, { redirect: 'manual' });
    const back = await roundTrip(base, startRes.headers.get('location')!);
    expect(back.searchParams.get('signin_error')).toMatch(/No player uses this GitHub account yet/);
  });

  it('refuses a made-up state', async () => {
    const { base } = await start({ env, fetch: fakeGitHub({ id: 7, email: 'x@example.com' }) });
    const back = await roundTrip(base, 'https://github.com/?state=forged');
    expect(back.searchParams.get('signin_error')).toMatch(/try again/);
  });
});

describe('While you were away', () => {
  it('tells a returning player what others wished and did, but not their own doings', async () => {
    const { base, store } = await start();
    const mara = account(store, 'Mara');
    const ilya = account(store, 'Ilya');
    store.accountById(mara.id)!.lastSeen = Date.now() - 60_000;
    store.addJournal('Ilya reached level 3.', ilya.id);
    store.addJournal('Mara reached level 2.', mara.id);
    const url = `${base.replace('http', 'ws')}/ws`;
    const i = await joined(url, ilya.token);
    await wish(i, 'I wish for a potion of moonlight');
    await i.waitFor((m) => m.t === 'god' && /bag/.test(m.say));

    const m = await joined(url, mara.token);
    const away = await m.waitFor<AwayMessage>((x) => x.t === 'away');
    const lines = away.items.map((x) => x.text);
    expect(lines).toContain('Ilya reached level 3.');
    expect(lines.some((l) => /^Ilya wished for "/.test(l))).toBe(true);
    expect(lines).not.toContain('Mara reached level 2.');
  });

  it('a first visit has no feed', async () => {
    const { base, store } = await start();
    const mara = account(store, 'Mara');
    const m = await joined(`${base.replace('http', 'ws')}/ws`, mara.token);
    await new Promise((r) => setTimeout(r, 100));
    expect(m.messages.some((x) => x.t === 'away')).toBe(false);
  });
});
