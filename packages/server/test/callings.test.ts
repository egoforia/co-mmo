import { describe, expect, it } from 'vitest';
import {
  CALLING_IDS,
  RACE_IDS,
  callingStats,
  gainXp,
  newCharacter,
  spendPoint,
  startCharacter,
  xpToNext,
  type CallingNeededMessage,
  type Character,
  type CharacterMessage,
  type DraftUpdateMessage,
  type GodMessage,
  type NoticeMessage,
  type WelcomeMessage,
} from '@co-mmo/shared';
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

const draftView = (c: Awaited<ReturnType<typeof joined>>, pred: (m: DraftUpdateMessage) => boolean = () => true) =>
  c.waitFor<DraftUpdateMessage>((m) => m.t === 'draft' && pred(m as DraftUpdateMessage));

describe('characters from before Callings', () => {
  it('choose a people and Calling before entering, keeping their level and things', async () => {
    const { store, ws } = await start();
    const mara = account(store, 'Mara');
    // Saved before Callings: no freePoints, no calling, five levels of +1 to everything.
    const old = { ...newCharacter(), level: 5, gold: 42, favor: 7, abilities: ['mend'], stats: { might: 7, agility: 7, wit: 7, spirit: 7, vigor: 7 } } as Partial<Character>;
    delete old.freePoints;
    old.inventory = [...old.inventory!, { item: 'tonic', qty: 3 }];
    store.accountById(mara.id)!.character = old as Character;

    const c = connect(ws, mara.token);
    const asked = await c.waitFor<CallingNeededMessage>((m) => m.t === 'callingNeeded');
    expect(asked.level).toBe(5);
    // Nothing else is let through, and they are not in the world yet.
    await c.send({ t: 'spendPoint', stat: 'wit' });
    await new Promise((r) => setTimeout(r, 100));
    expect(c.messages.some((m) => m.t === 'welcome')).toBe(false);

    await c.send({ t: 'chooseCalling', race: 'cervid', calling: 'bellkeeper' });
    const welcome = await c.waitFor<WelcomeMessage>((m) => m.t === 'welcome');
    expect(welcome.character).toMatchObject({ race: 'cervid', calling: 'bellkeeper', level: 5, gold: 42, favor: 7, freePoints: 4, abilities: ['mend'] });
    expect(welcome.character.stats).toEqual(callingStats('cervid', 'bellkeeper', 5));
    expect(welcome.character.inventory).toContainEqual({ item: 'tonic', qty: 3 });
    expect(store.accountById(mara.id)!.character).toMatchObject({ race: 'cervid', calling: 'bellkeeper' });
    c.socket.close();

    // Next time they go straight in.
    await new Promise((r) => setTimeout(r, 100));
    const again = connect(ws, mara.token);
    await again.waitFor((m) => m.t === 'welcome');
    expect(again.messages.some((m) => m.t === 'callingNeeded')).toBe(false);
  });
});

describe('changing people or Calling by wish', () => {
  it('is a Moderate wish from the Workshop that moves the points and repaints the look', async () => {
    const { store, ws } = await start();
    const mara = account(store, 'Mara');
    const c0 = startCharacter('ursine', 'warden');
    gainXp(c0, xpToNext(1) + xpToNext(2));
    spendPoint(c0, 'agility');
    store.accountById(mara.id)!.character = c0;
    const c = await joined(ws, mara.token);
    await draftView(c, (m) => m.view === null);
    const first = app!.wishes.grantLook({ id: mara.id, name: 'Mara' }, 'a moss-green cloak', 'ursine');

    await c.send({ t: 'draft', action: 'start', category: 'living', sub: 'calling', fields: { race: 'lutran', calling: 'ranger' } });
    const view = (await draftView(c, (m) => m.view !== null)).view!;
    expect(view.problems).toEqual([]);
    expect(view.preview.card).toMatchObject({ tier: 'moderate', cost: 6 });
    await c.send({ t: 'draft', action: 'send' });
    const offered = await c.waitFor<GodMessage>((m) => m.t === 'god' && Boolean((m as GodMessage).card));
    await c.send({ t: 'wish', card: offered.card!.id, confirm: true });

    const changed = await c.waitFor<CharacterMessage>((m) => m.t === 'character' && m.character.calling === 'ranger');
    expect(changed.character).toMatchObject({ race: 'lutran', level: 3, freePoints: 2, favor: c0.favor - 6 });
    expect(changed.character.stats).toEqual(callingStats('lutran', 'ranger', 3));
    const look = app!.wishes.lookOf(mara.id)!;
    expect(look.id).not.toBe(first.id);
    expect(look.definition).toMatchObject({ kind: 'player', race: 'lutran', look: { body: expect.stringMatching(/Lutran adventurer/) } });

    // A prayer can never make one: the God's cards go through validateDefinition.
    const made = app!.wishes.cardFor(mara.id, { tier: 'moderate', title: 'Be a duelist', summary: '', definition: { kind: 'calling', calling: 'duelist' } }, 'the Sanctum');
    expect(made).toMatchObject({ card: { tier: 'major' } });
  });

  it('turns down a wish that changes nothing, before any Favor is spent', async () => {
    const { store, ws } = await start();
    const mara = account(store, 'Mara');
    store.accountById(mara.id)!.character = startCharacter('falcon', 'ranger');
    const c = await joined(ws, mara.token);
    await draftView(c, (m) => m.view === null);
    await c.send({ t: 'draft', action: 'start', category: 'living', sub: 'calling', fields: { calling: 'ranger' } });
    await draftView(c, (m) => m.view !== null);
    await c.send({ t: 'draft', action: 'send' });
    const offered = await c.waitFor<GodMessage>((m) => m.t === 'god' && Boolean((m as GodMessage).card));
    await c.send({ t: 'wish', card: offered.card!.id, confirm: true });
    const said = await c.waitFor<GodMessage>((m) => m.t === 'god' && /already a Ranger/.test((m as GodMessage).say));
    expect(said).toBeDefined();
    expect(store.content.some((r) => r.definition?.kind === 'calling')).toBe(false);
  });
});
