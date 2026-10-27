import { describe, expect, it } from 'vitest';
import { CALLING_IDS, RACE_IDS, gainXp, startCharacter, xpToNext, type CharacterMessage, type NoticeMessage, type WelcomeMessage } from '@co-mmo/shared';
import { account, app, connect, joined, start } from './helpers.ts';

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('choosing a people and Calling', () => {
  it('makes a character of every people and every Calling at sign-up', async () => {
    const { base, store, ws } = await start();
    let n = 0;
    let first = '';
    for (const race of RACE_IDS) {
      for (const calling of CALLING_IDS) {
        const name = `Hero${n++}`;
        const res = await post(base, '/api/accept', { code: store.createInvite(null).code, name, adult: true, race, calling });
        expect(res.status).toBe(200);
        first ||= res.body.token;
        expect(store.accounts.find((a) => a.name === name)!.character).toMatchObject({ race, calling, level: 1, freePoints: 0 });
      }
    }
    // They play as what they chose.
    const welcome = await connect(ws, first).waitFor<WelcomeMessage>((m) => m.t === 'welcome');
    expect(welcome.character).toMatchObject({ race: 'ursine', calling: 'warden' });
  }, 30_000);

  it('refuses a missing or unknown people or Calling and keeps the invite', async () => {
    const { base, store } = await start();
    const code = store.createInvite(null).code;
    const noRace = await post(base, '/api/accept', { code, name: 'Mara', adult: true, calling: 'warden' });
    expect(noRace).toMatchObject({ status: 400, body: { error: 'race_invalid' } });
    const badCalling = await post(base, '/api/accept', { code, name: 'Mara', adult: true, race: 'lutran', calling: 'necromancer' });
    expect(badCalling).toMatchObject({ status: 400, body: { error: 'calling_invalid' } });
    expect(store.findInvite(code)!.usedBy).toBeNull();
  });

  it('paints the look as one of the people', async () => {
    const { base, store } = await start();
    await post(base, '/api/accept', { code: store.createInvite(null).code, name: 'Mara', adult: true, race: 'cervid', calling: 'bellkeeper', look: 'A moss-green cloak and a silver bell' });
    await Promise.all([...app!.wishes.painting]);
    const look = store.content.find((c) => c.definition?.kind === 'player')!;
    expect(look.definition).toMatchObject({ race: 'cervid', look: { body: expect.stringMatching(/Cervid adventurer, deerfolk/) } });
  });

  it('lets the server place free points and refuses when there are none', async () => {
    const { store, ws } = await start();
    const mara = account(store, 'Mara');
    const c = startCharacter('ursine', 'warden');
    store.accountById(mara.id)!.character = c;
    const player = await joined(ws, mara.token);
    await player.send({ t: 'spendPoint', stat: 'wit' });
    const refused = await player.waitFor<NoticeMessage>((m) => m.t === 'notice');
    expect(refused.text).toMatch(/no free points/);

    const ilya = account(store, 'Ilya');
    const levelled = startCharacter('lutran', 'wishweaver');
    gainXp(levelled, xpToNext(1));
    store.accountById(ilya.id)!.character = levelled;
    const other = await joined(ws, ilya.token);
    await other.send({ t: 'spendPoint', stat: 'vigor' });
    const placed = await other.waitFor<CharacterMessage>((m) => m.t === 'character' && m.character.freePoints === 0);
    expect(placed.character.stats.vigor).toBe(4);
  });
});
